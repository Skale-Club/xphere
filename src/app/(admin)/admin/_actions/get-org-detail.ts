'use server'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { resolveEffectivePlan, ACTIVE_SUB_STATUSES } from '@/lib/billing/entitlements'
import { getPlan } from '@/lib/billing/catalog'

export type OrgMember = {
  id: string
  user_id: string
  email: string
  role: string
  joined_at: string
}

export type OrgBilling = {
  planOverride: string | null
  trialEndsAt: string | null
  /** Resolved effective plan (override > subscription > trial > none). */
  effectivePlanKey: string | null
  effectivePlanName: string | null
  status: string
  source: string
  copilotTotalUsd: number
  copilotIncludedUsd: number
  copilotTopupUsd: number
}

export type OrgDetail = {
  id: string
  name: string
  slug: string
  is_active: boolean
  created_at: string
  settings: Record<string, unknown>
  contacts_count: number
  calls_count: number
  conversations_count: number
  members: OrgMember[]
  billing: OrgBilling
}

export async function getOrgDetail(orgId: string): Promise<OrgDetail> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createServiceRoleClient() as any

  const [orgResult, membersResult, contacts, calls, conversations, subsResult, creditsResult] = await Promise.all([
    admin.from('organizations').select('id, name, slug, is_active, created_at, settings, plan_override, trial_ends_at').eq('id', orgId).single(),
    admin.from('org_members').select('id, user_id, role, created_at').eq('organization_id', orgId).order('created_at', { ascending: true }),
    admin.from('contacts').select('*', { count: 'exact', head: true }).eq('org_id', orgId),
    admin.from('calls').select('*', { count: 'exact', head: true }).eq('organization_id', orgId),
    admin.from('conversations').select('*', { count: 'exact', head: true }).eq('org_id', orgId),
    admin.from('billing_subscriptions').select('status, stripe_price_id, created_at').eq('org_id', orgId).order('created_at', { ascending: false }),
    admin.from('copilot_credit_balances').select('included_balance_usd, topup_balance_usd').eq('org_id', orgId).maybeSingle(),
  ])

  if (orgResult.error) throw new Error(`Organization not found: ${orgResult.error.message}`)
  const org = orgResult.data as { id: string; name: string; slug: string; is_active: boolean; created_at: string; settings: unknown; plan_override: string | null; trial_ends_at: string | null }
  const rawMembers = (membersResult.data ?? []) as { id: string; user_id: string; role: string; created_at: string }[]

  // Resolve effective billing the same way the app does (override > sub > trial).
  const subs = (subsResult.data ?? []) as { status: string; stripe_price_id: string | null }[]
  const liveSub = subs.find((s) => ACTIVE_SUB_STATUSES.has(s.status)) ?? null
  const eff = resolveEffectivePlan({
    planOverride: org.plan_override ?? null,
    subscription: liveSub ? { status: liveSub.status, stripePriceId: liveSub.stripe_price_id } : null,
    trialEndsAt: org.trial_ends_at ?? null,
    now: new Date(),
  })
  const effPlan = getPlan(eff.planKey)
  const credits = creditsResult.data as { included_balance_usd: number; topup_balance_usd: number } | null
  const copilotIncludedUsd = Number(credits?.included_balance_usd ?? 0)
  const copilotTopupUsd = Number(credits?.topup_balance_usd ?? 0)

  let emailMap = new Map<string, string>()
  if (rawMembers.length > 0) {
    const { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 })
    emailMap = new Map((users as { id: string; email?: string }[]).map(u => [u.id, u.email ?? '']))
  }

  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    is_active: org.is_active,
    created_at: org.created_at,
    settings: (org.settings as Record<string, unknown>) ?? {},
    contacts_count: (contacts as { count: number | null }).count ?? 0,
    calls_count: (calls as { count: number | null }).count ?? 0,
    conversations_count: (conversations as { count: number | null }).count ?? 0,
    members: rawMembers.map(m => ({
      id: m.id,
      user_id: m.user_id,
      email: emailMap.get(m.user_id) ?? m.user_id,
      role: m.role,
      joined_at: m.created_at,
    })),
    billing: {
      planOverride: org.plan_override ?? null,
      trialEndsAt: org.trial_ends_at ?? null,
      effectivePlanKey: eff.planKey,
      effectivePlanName: effPlan?.name ?? null,
      status: eff.status,
      source: eff.source,
      copilotTotalUsd: copilotIncludedUsd + copilotTopupUsd,
      copilotIncludedUsd,
      copilotTopupUsd,
    },
  }
}

export async function updateOrgSettings(orgId: string, settings: Record<string, unknown>): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createServiceRoleClient() as any
  const { error } = await admin
    .from('organizations')
    .update({ settings: settings as import('@/types/database').Json })
    .eq('id', orgId)
  if (error) throw new Error(`Failed to update settings: ${error.message}`)
}
