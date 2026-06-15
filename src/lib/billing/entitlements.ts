// Resolves an org's EFFECTIVE entitlements: which plan is in force, the access
// status, and the features/limits/credit allowance that follow from it.
//
// Precedence (highest first):
//   1. plan_override  — the agency manually assigned a plan (hybrid sales model)
//   2. subscription   — a live Stripe subscription (active / trialing / past_due)
//   3. trial          — trial_ends_at is still in the future
//   4. none           — nothing grants access (expired trial, or never had one)
//
// The decision is split into a PURE function (resolveEffectivePlan) that is unit
// tested without any DB, and a thin IO wrapper (getEntitlements) that reads org +
// subscription state and is memoised per-request via React cache().
import 'server-only'
import { cache } from 'react'

import { createClient } from '@/lib/supabase/server'
import { getActiveOrg } from '@/lib/org/active-org'
import {
  getPlan,
  planByPriceId,
  TRIAL_PLAN_KEY,
  type Feature,
  type LimitKey,
  type Plan,
} from './catalog'

/** Internal access status. Note: distinct from raw Stripe subscription statuses. */
export type BillingStatus = 'trialing' | 'active' | 'past_due' | 'expired' | 'none'

export type EntitlementSource = 'override' | 'subscription' | 'trial' | 'none'

/** Stripe subscription statuses that still grant access. */
export const ACTIVE_SUB_STATUSES = new Set(['active', 'trialing', 'past_due'])

export interface Entitlements {
  orgId: string | null
  /** Effective plan key, or null when no plan is in force. */
  planKey: string | null
  plan: Plan | null
  status: BillingStatus
  source: EntitlementSource
  trialEndsAt: string | null
  /** Capabilities unlocked. Empty when no plan is in force. */
  features: readonly Feature[]
  /** Per-resource caps (`null` = unlimited). Zeroed when no plan is in force. */
  limits: Record<LimitKey, number | null>
  /** Monthly Copilot credit allowance (USD) for the effective plan. */
  copilotIncludedUsd: number
}

const ZERO_LIMITS: Record<LimitKey, number | null> = {
  contacts: 0,
  members: 0,
  agents: 0,
  workflows: 0,
}

/** No org / unauthenticated: nothing is granted. */
const EMPTY_ENTITLEMENTS: Entitlements = {
  orgId: null,
  planKey: null,
  plan: null,
  status: 'none',
  source: 'none',
  trialEndsAt: null,
  features: [],
  limits: ZERO_LIMITS,
  copilotIncludedUsd: 0,
}

export interface ResolveInput {
  planOverride: string | null
  subscription: { status: string; stripePriceId: string | null } | null
  trialEndsAt: string | null
  now: Date
}

export interface EffectivePlan {
  /** May be null when a live subscription's price isn't in the catalog. */
  planKey: string | null
  status: BillingStatus
  source: EntitlementSource
}

/**
 * Pure resolution of the effective plan from raw state. No IO — unit tested
 * directly. The caller maps `planKey` to a Plan and applies a fallback for the
 * (mis-configured) case of a live subscription whose price isn't catalogued.
 */
export function resolveEffectivePlan(input: ResolveInput): EffectivePlan {
  // 1. Agency override wins outright — a deliberate manual assignment.
  if (input.planOverride && getPlan(input.planOverride)) {
    return { planKey: input.planOverride, status: 'active', source: 'override' }
  }

  // 2. Live Stripe subscription.
  if (input.subscription && ACTIVE_SUB_STATUSES.has(input.subscription.status)) {
    const plan = planByPriceId(input.subscription.stripePriceId)
    // Stripe 'trialing' is a paid-plan trial → treat as active access; 'past_due'
    // keeps access but is surfaced so the UI can nudge the customer.
    const status: BillingStatus = input.subscription.status === 'past_due' ? 'past_due' : 'active'
    return { planKey: plan?.key ?? null, status, source: 'subscription' }
  }

  // 3. Free trial still running.
  if (input.trialEndsAt && new Date(input.trialEndsAt).getTime() > input.now.getTime()) {
    return { planKey: TRIAL_PLAN_KEY, status: 'trialing', source: 'trial' }
  }

  // 4. Nothing grants access. 'expired' if a trial window existed and lapsed,
  // otherwise 'none' (never provisioned).
  return { planKey: null, status: input.trialEndsAt ? 'expired' : 'none', source: 'none' }
}

/**
 * The current request's effective entitlements. Memoised per-request so the
 * layout, sidebar and pages share a single resolution. Reads are RLS-scoped to
 * the active org, so no manual org filtering is needed.
 */
export const getEntitlements = cache(async (): Promise<Entitlements> => {
  const active = await getActiveOrg()
  if (!active) return EMPTY_ENTITLEMENTS

  try {
    const supabase = await createClient()
    const [{ data: org }, { data: subs }] = await Promise.all([
      supabase
        .from('organizations')
        .select('trial_ends_at, plan_override')
        .eq('id', active.id)
        .maybeSingle(),
      supabase
        .from('billing_subscriptions')
        .select('status, stripe_price_id, created_at')
        .order('created_at', { ascending: false }),
    ])

    const liveSub = subs?.find((s) => ACTIVE_SUB_STATUSES.has(s.status)) ?? null

    const eff = resolveEffectivePlan({
      planOverride: org?.plan_override ?? null,
      subscription: liveSub
        ? { status: liveSub.status, stripePriceId: liveSub.stripe_price_id }
        : null,
      trialEndsAt: org?.trial_ends_at ?? null,
      now: new Date(),
    })

    // Map to a concrete Plan. A live subscription whose price isn't catalogued is
    // a config error — never strand a paying customer; fall back to the trial plan.
    let plan = getPlan(eff.planKey)
    if (!plan && eff.source === 'subscription') {
      console.warn(
        `[billing] org ${active.id}: live subscription price not in catalog; ` +
          `falling back to '${TRIAL_PLAN_KEY}' entitlements.`,
      )
      plan = getPlan(TRIAL_PLAN_KEY)
    }

    return {
      orgId: active.id,
      planKey: plan?.key ?? null,
      plan,
      status: eff.status,
      source: eff.source,
      trialEndsAt: org?.trial_ends_at ?? null,
      features: plan?.features ?? [],
      limits: plan?.limits ?? ZERO_LIMITS,
      copilotIncludedUsd: plan?.copilotIncludedUsd ?? 0,
    }
  } catch (err) {
    // Fail OPEN for resolution errors (DB hiccup): returning EMPTY would lock the
    // whole org out. Enforcement (Phase 3) is itself flag-gated and treats this
    // conservatively where it matters.
    console.error('[billing] getEntitlements failed; returning empty entitlements:', err)
    return { ...EMPTY_ENTITLEMENTS, orgId: active.id }
  }
})

/** Convenience: does the effective plan include `feature`? */
export function hasFeature(ent: Entitlements, feature: Feature): boolean {
  return ent.features.includes(feature)
}
