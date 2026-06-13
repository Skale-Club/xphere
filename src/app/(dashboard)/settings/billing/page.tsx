import { redirect } from 'next/navigation'

import { PageContainer } from '@/components/layout/page-header'
import { createClient } from '@/lib/supabase/server'
import { getBillingContext } from '@/lib/billing/context'
import { configuredPlanKeys } from '@/lib/billing/plans'
import { getEntitlements } from '@/lib/billing/entitlements'
import { getCopilotBalance, getCopilotLedger } from '@/lib/billing/credits'
import { availableTopupPackages } from '@/lib/billing/catalog'
import { BillingClient } from './billing-client'
import { PlanUsageCard } from '@/components/billing/plan-usage-card'
import { CreditsCard } from '@/components/billing/credits-card'

// Subscription/credit state is read from the DB per-request and the catalog from
// runtime env, so this page must never be statically cached.
export const dynamic = 'force-dynamic'

type CheckoutResult = 'success' | 'cancel'

// Stripe statuses that mean the org currently holds a usable (or recoverable)
// subscription — these surface the Customer Portal instead of a plan picker.
const ACTIVE_STATUSES = new Set(['trialing', 'active', 'past_due', 'unpaid', 'paused'])

function oneOf<T extends string>(
  raw: string | string[] | undefined,
  allowed: readonly T[],
): T | null {
  const v = Array.isArray(raw) ? raw[0] : raw
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : null
}

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
  const checkoutResult = oneOf<CheckoutResult>(sp.checkout, ['success', 'cancel'])
  const topupResult = oneOf<'success' | 'cancel'>(sp.topup, ['success', 'cancel'])

  // RLS scopes all of these to the caller's org. Resolve subscription, effective
  // entitlements, the Copilot wallet, and usage counts in parallel.
  const supabase = await createClient()
  const [
    { data: subs },
    entitlements,
    balance,
    ledger,
    { count: contactsCount },
    { count: membersCount },
    { count: agentsCount },
    { count: workflowsCount },
  ] = await Promise.all([
    supabase
      .from('billing_subscriptions')
      .select('status, stripe_price_id, cancel_at_period_end, current_period_end, created_at')
      .order('created_at', { ascending: false }),
    getEntitlements(),
    getCopilotBalance(ctx.orgId),
    getCopilotLedger(ctx.orgId),
    supabase.from('contacts').select('id', { count: 'exact', head: true }),
    supabase.from('org_members').select('id', { count: 'exact', head: true }),
    supabase.from('agents').select('id', { count: 'exact', head: true }),
    supabase.from('workflows').select('id', { count: 'exact', head: true }),
  ])

  const subscription = subs?.find((s) => ACTIVE_STATUSES.has(s.status)) ?? subs?.[0] ?? null

  const usageItems = [
    { label: 'Contacts', count: contactsCount ?? 0, limit: entitlements.limits.contacts },
    { label: 'Team members', count: membersCount ?? 0, limit: entitlements.limits.members },
    { label: 'Agents', count: agentsCount ?? 0, limit: entitlements.limits.agents },
    { label: 'Workflows', count: workflowsCount ?? 0, limit: entitlements.limits.workflows },
  ]

  const topupPackages = availableTopupPackages().map((p) => ({
    key: p.key,
    name: p.name,
    creditsUsd: p.creditsUsd,
  }))

  return (
    <PageContainer className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Billing</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your organization&rsquo;s subscription, plan, credits, and invoices.
        </p>
      </div>

      <PlanUsageCard
        planName={entitlements.plan?.name ?? null}
        status={entitlements.status}
        trialEndsAt={entitlements.trialEndsAt}
        items={usageItems}
      />

      <CreditsCard
        totalUsd={balance.totalUsd}
        includedUsd={balance.includedUsd}
        topupUsd={balance.topupUsd}
        packages={topupPackages}
        ledger={ledger}
        isAdmin={ctx.isAdmin}
        topupResult={topupResult}
      />

      <BillingClient
        isAdmin={ctx.isAdmin}
        subscription={subscription}
        plans={configuredPlanKeys()}
        checkoutResult={checkoutResult}
      />
    </PageContainer>
  )
}
