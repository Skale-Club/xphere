import 'server-only'

// Points quota (D3). Every scan point costs real provider money, so unlike the
// other billing guards this one is enforced even while
// BILLING_ENFORCEMENT_ENABLED is off — only the source of the limit changes:
//
//   org has an effective plan        -> plan.limits.local_seo_points_month
//   no plan, enforcement off (today) -> LOCAL_SEO_UNPLANNED_POINTS_MONTH (500)
//   no plan, enforcement on          -> 0
//
// On top of the per-org quota there is a platform-wide kill switch
// (LOCAL_SEO_DISABLED=true) and a daily ceiling across all orgs
// (LOCAL_SEO_DAILY_POINT_CAP, default 20,000 points ≈ US$12 on DataForSEO).
//
// Runs with the service-role client so cron and MCP callers (no session) get
// the same answer as the dashboard.

import type { SupabaseClient } from '@supabase/supabase-js'

import { getPlan, TRIAL_PLAN_KEY } from '@/lib/billing/catalog'
import { isBillingEnforced } from '@/lib/billing/config'
import { ACTIVE_SUB_STATUSES, resolveEffectivePlan } from '@/lib/billing/entitlements'
import type { Database } from '@/types/database'

type Admin = SupabaseClient<Database>

const DEFAULT_UNPLANNED_POINTS = 500
const DEFAULT_DAILY_CAP = 20_000

/** First day of the UTC month containing `d`, as YYYY-MM-DD. */
export function periodStart(d: Date = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
}

function envInt(name: string, fallback: number): number {
  const n = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

export function isLocalSeoDisabled(): boolean {
  return process.env.LOCAL_SEO_DISABLED === 'true'
}

export async function getMonthlyPointsLimit(admin: Admin, orgId: string): Promise<number> {
  const [{ data: org }, { data: subs }] = await Promise.all([
    admin.from('organizations').select('trial_ends_at, plan_override').eq('id', orgId).maybeSingle(),
    admin
      .from('billing_subscriptions')
      .select('status, stripe_price_id, created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false }),
  ])
  const live = subs?.find((s) => ACTIVE_SUB_STATUSES.has(s.status)) ?? null
  const eff = resolveEffectivePlan({
    planOverride: org?.plan_override ?? null,
    subscription: live ? { status: live.status, stripePriceId: live.stripe_price_id } : null,
    trialEndsAt: org?.trial_ends_at ?? null,
    now: new Date(),
  })
  const plan = getPlan(eff.planKey) ?? (eff.source === 'subscription' ? getPlan(TRIAL_PLAN_KEY) : null)
  if (plan) return plan.limits.local_seo_points_month ?? Number.MAX_SAFE_INTEGER
  return isBillingEnforced() ? 0 : envInt('LOCAL_SEO_UNPLANNED_POINTS_MONTH', DEFAULT_UNPLANNED_POINTS)
}

export async function getPointsUsed(admin: Admin, orgId: string, period = periodStart()): Promise<number> {
  const { data, error } = await admin
    .from('local_seo_usage_ledger')
    .select('points')
    .eq('org_id', orgId)
    .eq('period', period)
    .eq('billable', true)
  if (error) throw new Error(`usage lookup failed: ${error.message}`)
  return (data ?? []).reduce((a, r) => a + r.points, 0)
}

async function platformPointsToday(admin: Admin): Promise<number> {
  const since = new Date()
  since.setUTCHours(0, 0, 0, 0)
  const { data, error } = await admin
    .from('local_seo_usage_ledger')
    .select('points')
    .gte('created_at', since.toISOString())
    .eq('billable', true)
  if (error) throw new Error(`daily usage lookup failed: ${error.message}`)
  return (data ?? []).reduce((a, r) => a + r.points, 0)
}

export type QuotaSnapshot = { used: number; limit: number; remaining: number; period: string }

export async function getQuotaSnapshot(admin: Admin, orgId: string): Promise<QuotaSnapshot> {
  const period = periodStart()
  const [used, limit] = await Promise.all([getPointsUsed(admin, orgId, period), getMonthlyPointsLimit(admin, orgId)])
  return { used, limit, remaining: Math.max(0, limit - used), period }
}

export type QuotaCheck = ({ ok: true } | { ok: false; error: string }) & { quota: QuotaSnapshot }

/** Can `orgId` spend `points` billable points right now? */
export async function checkPointsQuota(admin: Admin, orgId: string, points: number): Promise<QuotaCheck> {
  const quota = await getQuotaSnapshot(admin, orgId)
  if (isLocalSeoDisabled()) {
    return { ok: false, error: 'Local SEO scans are temporarily paused by the platform.', quota }
  }
  if (points > quota.remaining) {
    return {
      ok: false,
      error: `This scan needs ${points} points but only ${quota.remaining} of ${quota.limit} are left this month.`,
      quota,
    }
  }
  const cap = envInt('LOCAL_SEO_DAILY_POINT_CAP', DEFAULT_DAILY_CAP)
  if ((await platformPointsToday(admin)) + points > cap) {
    return { ok: false, error: 'The platform-wide daily scan capacity is used up. Try again tomorrow.', quota }
  }
  return { ok: true, quota }
}
