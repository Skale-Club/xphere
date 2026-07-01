// tests/billing-checkout-sessions.test.ts
// Phase 116 (BTC-04) — coverage for createCheckoutSession (subscription mode)
// and createCreditTopUpSession (payment mode) in src/lib/billing/actions.ts.
//
// Verifies the exact Stripe checkout.sessions.create call shape (price id,
// metadata, subscription_data/payment_intent_data) plus the auth/admin guards
// and unknown-plan/package/missing-url edge cases.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/billing/stripe', () => ({
  getStripe: vi.fn(),
  isStripeConfigured: vi.fn(() => true),
}))
vi.mock('@/lib/billing/customers', () => ({
  getOrCreateStripeCustomer: vi.fn(async () => 'cus_test_123'),
}))
vi.mock('@/lib/billing/context', () => ({
  getBillingContext: vi.fn(async () => ({ userId: 'u1', orgId: 'org-1', isAdmin: true })),
  getBaseUrl: vi.fn(async () => 'https://xphere.app'),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { getStripe } from '@/lib/billing/stripe'
import { getBillingContext } from '@/lib/billing/context'
import { createCheckoutSession, createCreditTopUpSession } from '@/lib/billing/actions'

let createSessionSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  createSessionSpy = vi.fn(async () => ({ url: 'https://checkout.stripe.com/test' }))
  vi.mocked(getStripe).mockReturnValue({
    checkout: { sessions: { create: createSessionSpy } },
  } as never)
  vi.mocked(getBillingContext).mockResolvedValue({ userId: 'u1', orgId: 'org-1', isAdmin: true })
})

afterEach(() => {
  delete process.env.STRIPE_PRICE_PRO
  delete process.env.STRIPE_PRICE_CREDITS_MEDIUM
})

describe('createCheckoutSession (subscription mode)', () => {
  it('creates a subscription checkout session with the correct price id and metadata', async () => {
    process.env.STRIPE_PRICE_PRO = 'price_pro_test'

    const result = await createCheckoutSession('pro')

    expect(createSessionSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        customer: 'cus_test_123',
        line_items: [{ price: 'price_pro_test', quantity: 1 }],
        metadata: { org_id: 'org-1' },
        subscription_data: { metadata: { org_id: 'org-1' } },
        allow_promotion_codes: true,
      }),
    )
    expect(result).toEqual({ ok: true, data: { url: 'https://checkout.stripe.com/test' } })
  })

  it('returns an error for an unknown/unconfigured plan without calling Stripe', async () => {
    const result = await createCheckoutSession('unknown-plan')

    expect(createSessionSpy).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: false, error: 'Unknown or unconfigured plan.' })
  })

  it('returns an error when not authenticated', async () => {
    vi.mocked(getBillingContext).mockResolvedValueOnce(null)

    const result = await createCheckoutSession('pro')

    expect(createSessionSpy).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: false, error: 'Not authenticated.' })
  })

  it('returns an error when the caller is not an org admin', async () => {
    vi.mocked(getBillingContext).mockResolvedValueOnce({ userId: 'u1', orgId: 'org-1', isAdmin: false })

    const result = await createCheckoutSession('pro')

    expect(createSessionSpy).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: false, error: 'Only org admins can manage billing.' })
  })

  it('returns an error when Stripe does not return a checkout URL', async () => {
    process.env.STRIPE_PRICE_PRO = 'price_pro_test'
    createSessionSpy.mockResolvedValueOnce({ url: null })

    const result = await createCheckoutSession('pro')

    expect(result).toEqual({ ok: false, error: 'Stripe did not return a checkout URL.' })
  })
})

describe('createCreditTopUpSession (payment mode)', () => {
  it('creates a one-time top-up session with the correct price id and metadata', async () => {
    process.env.STRIPE_PRICE_CREDITS_MEDIUM = 'price_credits_med_test'

    const result = await createCreditTopUpSession('medium')

    expect(createSessionSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'payment',
        customer: 'cus_test_123',
        line_items: [{ price: 'price_credits_med_test', quantity: 1 }],
        metadata: { org_id: 'org-1', kind: 'copilot_topup', package: 'medium' },
        payment_intent_data: {
          metadata: { org_id: 'org-1', kind: 'copilot_topup', package: 'medium' },
        },
      }),
    )
    expect(result).toEqual({ ok: true, data: { url: 'https://checkout.stripe.com/test' } })
  })

  it('returns an error for an unknown/unconfigured credit package without calling Stripe', async () => {
    const result = await createCreditTopUpSession('unknown-package')

    expect(createSessionSpy).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: false, error: 'Unknown or unconfigured credit package.' })
  })

  it('returns an error when Stripe does not return a checkout URL', async () => {
    process.env.STRIPE_PRICE_CREDITS_MEDIUM = 'price_credits_med_test'
    createSessionSpy.mockResolvedValueOnce({ url: null })

    const result = await createCreditTopUpSession('medium')

    expect(result).toEqual({ ok: false, error: 'Stripe did not return a checkout URL.' })
  })
})
