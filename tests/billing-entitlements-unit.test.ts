// tests/billing-entitlements-unit.test.ts
// Phase 1 — pure-function unit tests for the billing entitlements resolver.
//
// No DB. Tests resolveEffectivePlan() precedence (override > subscription >
// trial > none) and the catalog lookups. The IO wrapper getEntitlements() is
// covered by manual E2E (it only wires DB rows into resolveEffectivePlan).

// BTC-02 audit (Phase 116): all four precedence levels (override, subscription,
// trial, none) are confirmed covered above — see 'precedence', 'subscription',
// and 'trial & none' describe blocks. No gap found; no new cases added.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { resolveEffectivePlan } from '@/lib/billing/entitlements'
import {
  getPlan,
  planByPriceId,
  topupByPriceId,
  PLAN_CATALOG,
  TRIAL_PLAN_KEY,
} from '@/lib/billing/catalog'

const NOW = new Date('2026-06-13T12:00:00.000Z')
const FUTURE = new Date('2026-12-31T00:00:00.000Z').toISOString()
const PAST = new Date('2026-01-01T00:00:00.000Z').toISOString()

describe('resolveEffectivePlan — precedence', () => {
  it('override wins over everything (even a live subscription and trial)', () => {
    const r = resolveEffectivePlan({
      planOverride: 'starter',
      subscription: { status: 'active', stripePriceId: 'price_pro' },
      trialEndsAt: FUTURE,
      now: NOW,
    })
    expect(r).toEqual({ planKey: 'starter', status: 'active', source: 'override' })
  })

  it('ignores an unknown override and falls through to the next source', () => {
    const r = resolveEffectivePlan({
      planOverride: 'nonexistent-plan',
      subscription: null,
      trialEndsAt: FUTURE,
      now: NOW,
    })
    expect(r.source).toBe('trial')
    expect(r.planKey).toBe(TRIAL_PLAN_KEY)
  })
})

describe('resolveEffectivePlan — subscription', () => {
  beforeEach(() => {
    process.env.STRIPE_PRICE_PRO = 'price_live_pro'
  })
  afterEach(() => {
    delete process.env.STRIPE_PRICE_PRO
  })

  it('active subscription with a catalogued price resolves to that plan', () => {
    const r = resolveEffectivePlan({
      planOverride: null,
      subscription: { status: 'active', stripePriceId: 'price_live_pro' },
      trialEndsAt: null,
      now: NOW,
    })
    expect(r).toEqual({ planKey: 'pro', status: 'active', source: 'subscription' })
  })

  it("Stripe 'trialing' counts as active access", () => {
    const r = resolveEffectivePlan({
      planOverride: null,
      subscription: { status: 'trialing', stripePriceId: 'price_live_pro' },
      trialEndsAt: null,
      now: NOW,
    })
    expect(r.status).toBe('active')
    expect(r.source).toBe('subscription')
  })

  it("'past_due' keeps access but is surfaced as past_due", () => {
    const r = resolveEffectivePlan({
      planOverride: null,
      subscription: { status: 'past_due', stripePriceId: 'price_live_pro' },
      trialEndsAt: null,
      now: NOW,
    })
    expect(r.status).toBe('past_due')
  })

  it('a live subscription with an uncatalogued price still grants access (planKey null)', () => {
    const r = resolveEffectivePlan({
      planOverride: null,
      subscription: { status: 'active', stripePriceId: 'price_unknown_xyz' },
      trialEndsAt: null,
      now: NOW,
    })
    expect(r).toEqual({ planKey: null, status: 'active', source: 'subscription' })
  })

  it('canceled/unpaid/incomplete subscriptions do NOT grant access', () => {
    for (const status of ['canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused']) {
      const r = resolveEffectivePlan({
        planOverride: null,
        subscription: { status, stripePriceId: 'price_live_pro' },
        trialEndsAt: null,
        now: NOW,
      })
      expect(r.source, `status=${status}`).toBe('none')
    }
  })
})

describe('resolveEffectivePlan — trial & none', () => {
  it('a future trial grants the trial plan', () => {
    const r = resolveEffectivePlan({
      planOverride: null,
      subscription: null,
      trialEndsAt: FUTURE,
      now: NOW,
    })
    expect(r).toEqual({ planKey: TRIAL_PLAN_KEY, status: 'trialing', source: 'trial' })
  })

  it('a lapsed trial resolves to expired', () => {
    const r = resolveEffectivePlan({
      planOverride: null,
      subscription: null,
      trialEndsAt: PAST,
      now: NOW,
    })
    expect(r).toEqual({ planKey: null, status: 'expired', source: 'none' })
  })

  it('no trial window at all resolves to none', () => {
    const r = resolveEffectivePlan({
      planOverride: null,
      subscription: null,
      trialEndsAt: null,
      now: NOW,
    })
    expect(r).toEqual({ planKey: null, status: 'none', source: 'none' })
  })
})

describe('catalog lookups', () => {
  it('getPlan returns a known plan and null for unknown/empty', () => {
    expect(getPlan('pro')?.key).toBe('pro')
    expect(getPlan('nope')).toBeNull()
    expect(getPlan(null)).toBeNull()
  })

  it('enterprise unlocks every feature and has unlimited limits', () => {
    const ent = PLAN_CATALOG.enterprise
    expect(ent.limits.contacts).toBeNull()
    expect(ent.features.length).toBeGreaterThanOrEqual(PLAN_CATALOG.pro.features.length)
  })

  it('planByPriceId maps a Stripe price back to its plan', () => {
    process.env.STRIPE_PRICE_STARTER = 'price_starter_xyz'
    expect(planByPriceId('price_starter_xyz')?.key).toBe('starter')
    expect(planByPriceId('price_nope')).toBeNull()
    expect(planByPriceId(null)).toBeNull()
    delete process.env.STRIPE_PRICE_STARTER
  })

  it('topupByPriceId maps a Stripe price back to its credit package', () => {
    process.env.STRIPE_PRICE_CREDITS_MEDIUM = 'price_credits_med'
    expect(topupByPriceId('price_credits_med')?.key).toBe('medium')
    expect(topupByPriceId('price_nope')).toBeNull()
    delete process.env.STRIPE_PRICE_CREDITS_MEDIUM
  })
})
