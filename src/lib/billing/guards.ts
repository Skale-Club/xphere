// Enforcement helpers. ALL of these are no-ops unless billing enforcement is on
// (isBillingEnforced), so importing/calling them is safe to ship before launch.
//
//   shouldBlockForBilling — pure predicate for the app-wide paywall (used by the
//                           dashboard layout). Platform admins are never blocked.
//   requireFeature        — server-action guard: caller's plan must include a feature.
//   requireWithinLimit    — server-action guard: caller is under a per-plan resource cap.
import 'server-only'

import { isBillingEnforced } from './config'
import { getEntitlements, hasFeature, type BillingStatus } from './entitlements'
import type { Feature, LimitKey } from './catalog'

export type GuardResult = { ok: true; error: null } | { ok: false; error: string }

/**
 * Pure: should the dashboard render the paywall instead of the requested page?
 * Only a lapsed trial / no-plan org is blocked; trialing/active/past_due keep
 * access (past_due is surfaced elsewhere as a nudge). Platform admins bypass.
 */
export function shouldBlockForBilling(status: BillingStatus, isPlatformAdmin: boolean): boolean {
  if (isPlatformAdmin) return false
  return status === 'expired' || status === 'none'
}

/** Server-action guard: the caller's effective plan must include `feature`. */
export async function requireFeature(feature: Feature): Promise<GuardResult> {
  if (!isBillingEnforced()) return { ok: true, error: null }
  const ent = await getEntitlements()
  if (hasFeature(ent, feature)) return { ok: true, error: null }
  return { ok: false, error: `Your plan doesn't include this feature. Upgrade to continue.` }
}

/**
 * Server-action guard: the caller must be under their plan's cap for `resource`.
 * `currentCount` is the org's existing count (caller supplies it — reuse the same
 * count queries the app already runs). Unlimited plans (`null`) always pass.
 */
export async function requireWithinLimit(
  resource: LimitKey,
  currentCount: number,
): Promise<GuardResult> {
  if (!isBillingEnforced()) return { ok: true, error: null }
  const ent = await getEntitlements()
  const limit = ent.limits[resource]
  if (limit === null || currentCount < limit) return { ok: true, error: null }
  return {
    ok: false,
    error: `You've reached your plan's limit for this resource (${limit}). Upgrade to add more.`,
  }
}
