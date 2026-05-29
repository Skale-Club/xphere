// Customer mapping: each organization owns exactly one Stripe Customer.
//
// Uses the service-role client because billing tables are written only by
// trusted server code (checkout server action + webhook), never by the
// authenticated user directly. The org_id is always supplied by the server
// from the authenticated session — never trusted from the client.
import 'server-only'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { getStripe } from './stripe'

/**
 * Returns the Stripe customer id for an org, creating the Stripe Customer and
 * the local mapping row on first use. Idempotent: concurrent first-time calls
 * resolve to a single mapping row via the unique (org_id) constraint.
 */
export async function getOrCreateStripeCustomer(orgId: string): Promise<string> {
  const supabase = createServiceRoleClient()

  // Fast path: mapping already exists.
  const { data: existing } = await supabase
    .from('billing_customers')
    .select('stripe_customer_id')
    .eq('org_id', orgId)
    .maybeSingle()

  if (existing?.stripe_customer_id) return existing.stripe_customer_id

  // Pull org name/email context for a recognizable Stripe Customer.
  const { data: org } = await supabase
    .from('organizations')
    .select('name')
    .eq('id', orgId)
    .maybeSingle()

  const stripe = getStripe()
  const customer = await stripe.customers.create({
    name: org?.name ?? undefined,
    // org_id in metadata is the backup link if the local mapping is ever lost.
    metadata: { org_id: orgId },
  })

  // Upsert guards against a race where two requests create the mapping at once:
  // the unique (org_id) constraint keeps one row; we then read back the winner.
  const { error } = await supabase
    .from('billing_customers')
    .upsert({ org_id: orgId, stripe_customer_id: customer.id }, { onConflict: 'org_id' })

  if (error) {
    // Another request won the race and stored a different customer; reconcile by
    // returning the persisted one so we never diverge from the DB source of truth.
    const { data: winner } = await supabase
      .from('billing_customers')
      .select('stripe_customer_id')
      .eq('org_id', orgId)
      .maybeSingle()
    if (winner?.stripe_customer_id) return winner.stripe_customer_id
    throw new Error(`Failed to persist Stripe customer mapping: ${error.message}`)
  }

  return customer.id
}

/** Resolve an org id from a Stripe customer id (webhook reverse lookup). */
export async function resolveOrgIdByCustomer(stripeCustomerId: string): Promise<string | null> {
  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from('billing_customers')
    .select('org_id')
    .eq('stripe_customer_id', stripeCustomerId)
    .maybeSingle()
  return data?.org_id ?? null
}
