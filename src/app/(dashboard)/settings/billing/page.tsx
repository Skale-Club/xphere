import { redirect } from 'next/navigation'

import { PageContainer } from '@/components/layout/page-header'
import { createClient } from '@/lib/supabase/server'
import { getBillingContext } from '@/lib/billing/context'
import { configuredPlanKeys } from '@/lib/billing/plans'
import { BillingClient } from './billing-client'

// Subscription state is read from the DB per-request and the plan catalog from
// runtime env, so this page must never be statically cached.
export const dynamic = 'force-dynamic'

type CheckoutResult = 'success' | 'cancel'

// Stripe statuses that mean the org currently holds a usable (or recoverable)
// subscription — these surface the Customer Portal instead of a plan picker.
const ACTIVE_STATUSES = new Set(['trialing', 'active', 'past_due', 'unpaid', 'paused'])

export default async function BillingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const ctx = await getBillingContext()
  // The settings layout already guarantees an authenticated user; a missing
  // context here means the caller isn't attached to an org.
  if (!ctx) redirect('/')

  const sp = await searchParams
  const checkoutRaw = Array.isArray(sp.checkout) ? sp.checkout[0] : sp.checkout
  const checkoutResult: CheckoutResult | null =
    checkoutRaw === 'success' || checkoutRaw === 'cancel' ? checkoutRaw : null

  // RLS (billing_subscriptions_org_read) scopes this to the caller's org, so we
  // don't filter by org_id here. Prefer a live subscription; fall back to the
  // most recent row (e.g. a past canceled one) for display.
  const supabase = await createClient()
  const { data: subs } = await supabase
    .from('billing_subscriptions')
    .select('status, stripe_price_id, cancel_at_period_end, current_period_end')
    .order('created_at', { ascending: false })

  const subscription =
    subs?.find((s) => ACTIVE_STATUSES.has(s.status)) ?? subs?.[0] ?? null

  return (
    <PageContainer className="space-y-6">
      <div className="max-w-2xl space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Billing</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your organization&rsquo;s subscription, payment method, and invoices.
          </p>
        </div>
        <BillingClient
          isAdmin={ctx.isAdmin}
          subscription={subscription}
          plans={configuredPlanKeys()}
          checkoutResult={checkoutResult}
        />
      </div>
    </PageContainer>
  )
}
