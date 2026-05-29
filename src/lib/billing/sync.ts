// Maps verified Stripe subscription state into billing_subscriptions.
//
// Every write here is an idempotent upsert keyed by stripe_subscription_id, so
// replaying the same (or a later) webhook event always converges to correct
// state and never creates duplicates. Called only from the webhook receiver
// after signature verification.
import 'server-only'
import type Stripe from 'stripe'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { resolveOrgIdByCustomer } from './customers'

function toIso(unixSeconds: number | null | undefined): string | null {
  return typeof unixSeconds === 'number' ? new Date(unixSeconds * 1000).toISOString() : null
}

/**
 * Upsert the local subscription row from a Stripe Subscription object.
 * Resolves the owning org from the customer mapping (falling back to the
 * subscription metadata) so the row is always tenant-scoped.
 */
export async function syncSubscription(subscription: Stripe.Subscription): Promise<void> {
  const customerId =
    typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id

  let orgId = await resolveOrgIdByCustomer(customerId)
  if (!orgId && subscription.metadata?.org_id) orgId = subscription.metadata.org_id

  if (!orgId) {
    console.warn(
      `[billing] syncSubscription: no org for customer ${customerId} (sub ${subscription.id}); skipping.`,
    )
    return
  }

  // In the current API version, the billing period lives on the subscription
  // item, not the top-level subscription object.
  const item = subscription.items.data[0]

  const supabase = createServiceRoleClient()
  const { error } = await supabase.from('billing_subscriptions').upsert(
    {
      org_id: orgId,
      stripe_subscription_id: subscription.id,
      stripe_customer_id: customerId,
      stripe_price_id: item?.price.id ?? null,
      status: subscription.status,
      cancel_at_period_end: subscription.cancel_at_period_end,
      current_period_start: toIso(item?.current_period_start),
      current_period_end: toIso(item?.current_period_end),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'stripe_subscription_id' },
  )

  if (error) {
    // Surface so the webhook returns non-2xx and Stripe retries the delivery.
    throw new Error(`Failed to upsert subscription ${subscription.id}: ${error.message}`)
  }
}
