// tests/billing-webhook.test.ts
// BTC-01 — Stripe webhook handler coverage (src/app/api/stripe/webhook/route.ts).
//
// The webhook is the ONLY trusted source of subscription/credit state changes;
// a regression here silently breaks billing. This file covers:
//   - real HMAC signature verification (valid / missing / wrong-secret) — NOT
//     mocked, so the actual constructEvent code path is genuinely exercised
//   - billing_events idempotency guard (upsert + processed_at check + update)
//   - all six SUPPORTED_EVENTS branches in handleEvent
//   - the checkout.session.completed topup edge case with missing metadata
//   - the legacy vs. current invoice->subscription field shape fallback
//   - the processing-failure path (500, processed_at NOT written)
//
// Mocking strategy: module-boundary vi.mock() for every dependency EXCEPT the
// stripe package itself. A separate, locally-constructed `new Stripe(...)`
// instance is used purely to sign test payloads (stripeForSigning) — this is
// distinct from the mocked `getStripe()` the route calls internally.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Stripe from 'stripe'

// ---- Module mocks (hoisted by Vitest above imports) ----
vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/lib/billing/sync', () => ({ syncSubscription: vi.fn() }))
vi.mock('@/lib/billing/customers', () => ({ resolveOrgIdByCustomer: vi.fn() }))
vi.mock('@/lib/billing/credits', () => ({
  grantCopilot: vi.fn(),
  resetCopilotForPeriod: vi.fn(),
}))
vi.mock('@/lib/billing/stripe', () => ({
  getStripe: vi.fn(),
  isStripeConfigured: vi.fn(() => true),
}))
vi.mock('@/lib/logger', () => ({ log: vi.fn() }))

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { syncSubscription } from '@/lib/billing/sync'
import { resolveOrgIdByCustomer } from '@/lib/billing/customers'
import { grantCopilot, resetCopilotForPeriod } from '@/lib/billing/credits'
import { getStripe } from '@/lib/billing/stripe'
import { CREDIT_TOPUP_PACKAGES } from '@/lib/billing/catalog'
import { log } from '@/lib/logger'
import { POST } from '@/app/api/stripe/webhook/route'

// ---- Real signing setup (NOT mocked — exercises actual constructEvent) ----
const STRIPE_WEBHOOK_SECRET = 'whsec_test_secret_for_vitest'
process.env.STRIPE_WEBHOOK_SECRET = STRIPE_WEBHOOK_SECRET
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'
const stripeForSigning = new Stripe(process.env.STRIPE_SECRET_KEY)

/**
 * Build a real, validly-signed Stripe Request for the webhook route.
 * The payload is JSON.stringify'd exactly ONCE and that exact string is used
 * for both signing and the request body (never re-derived separately).
 */
function buildSignedRequest(
  event: Record<string, unknown>,
  secret: string = STRIPE_WEBHOOK_SECRET,
): Request {
  const payload = JSON.stringify({
    id: 'evt_test_123',
    object: 'event',
    api_version: '2026-05-27.dahlia',
    created: Math.floor(Date.now() / 1000),
    data: { object: {} },
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    ...event,
  })
  const signature = stripeForSigning.webhooks.generateTestHeaderString({ payload, secret })
  return new Request('http://localhost/api/stripe/webhook', {
    method: 'POST',
    body: payload,
    headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
  })
}

/**
 * Fake service-role admin client. The route calls `.from('billing_events')`
 * THREE separate times (upsert, select().eq().maybeSingle(), update().eq()) —
 * not one chained call — so all three must be satisfied by the same object.
 */
function buildFakeAdmin(billingEventsRow: { processed_at: string | null } | null = null) {
  const upsertSpy = vi.fn().mockResolvedValue({ data: null, error: null })
  const updateEqSpy = vi.fn().mockResolvedValue({ data: null, error: null })
  const updateSpy = vi.fn(() => ({ eq: updateEqSpy }))
  const maybeSingleSpy = vi.fn().mockResolvedValue({ data: billingEventsRow, error: null })
  const fromMock = vi.fn((table: string) => {
    if (table === 'billing_events') {
      return {
        upsert: upsertSpy,
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: maybeSingleSpy,
        update: updateSpy,
      }
    }
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
  })
  return { from: fromMock, upsertSpy, updateSpy, updateEqSpy, maybeSingleSpy }
}

/**
 * Build the object returned by the mocked getStripe(). `webhooks.constructEvent`
 * delegates to the REAL, un-mocked stripeForSigning instance so signature
 * verification is genuinely exercised (per RESEARCH.md — do not mock
 * constructEvent itself). Only `subscriptions.retrieve` is a bare vi.fn(),
 * overridden per-test as needed.
 */
function buildFakeStripe(retrieve = vi.fn()) {
  return {
    webhooks: {
      constructEvent: (rawBody: string, signature: string, secret: string) =>
        stripeForSigning.webhooks.constructEvent(rawBody, signature, secret),
    },
    subscriptions: { retrieve },
  }
}

describe('Stripe webhook route — POST /api/stripe/webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.STRIPE_WEBHOOK_SECRET = STRIPE_WEBHOOK_SECRET
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'
    // Safe default: subscriptions.retrieve is overridden per-test as needed.
    vi.mocked(getStripe).mockReturnValue(buildFakeStripe() as unknown as ReturnType<typeof getStripe>)
  })

  afterEach(() => {
    delete process.env.STRIPE_PRICE_PRO
  })

  // ---- Task 1: signature verification + idempotency guard ----

  describe('signature verification', () => {
    it('returns 400 "Missing signature" when the stripe-signature header is absent', async () => {
      const payload = JSON.stringify({ id: 'evt_no_sig', type: 'checkout.session.completed' })
      const request = new Request('http://localhost/api/stripe/webhook', {
        method: 'POST',
        body: payload,
        headers: { 'content-type': 'application/json' },
      })

      const response = await POST(request)

      expect(response.status).toBe(400)
      expect(await response.text()).toBe('Missing signature')
    })

    it('returns 400 "Invalid signature" when signed with the wrong secret', async () => {
      const fakeAdmin = buildFakeAdmin(null)
      vi.mocked(createServiceRoleClient).mockReturnValue(fakeAdmin as never)

      const request = buildSignedRequest(
        { id: 'evt_wrong_secret', type: 'checkout.session.completed' },
        'whsec_totally_different_secret',
      )

      const response = await POST(request)

      expect(response.status).toBe(400)
      expect(await response.text()).toBe('Invalid signature')
    })

    it('returns 500 "Webhook not configured" when STRIPE_WEBHOOK_SECRET is unset', async () => {
      delete process.env.STRIPE_WEBHOOK_SECRET
      try {
        const request = new Request('http://localhost/api/stripe/webhook', {
          method: 'POST',
          body: JSON.stringify({ id: 'evt_no_secret_env', type: 'checkout.session.completed' }),
          headers: { 'content-type': 'application/json' },
        })

        const response = await POST(request)

        expect(response.status).toBe(500)
        expect(await response.text()).toBe('Webhook not configured')
      } finally {
        process.env.STRIPE_WEBHOOK_SECRET = STRIPE_WEBHOOK_SECRET
      }
    })
  })

  describe('idempotency guard', () => {
    it('marks processed_at and returns 200 for a validly-signed but unsupported event type', async () => {
      const fakeAdmin = buildFakeAdmin(null)
      vi.mocked(createServiceRoleClient).mockReturnValue(fakeAdmin as never)

      const request = buildSignedRequest({
        id: 'evt_unsupported_1',
        type: 'customer.updated',
        data: { object: {} },
      })

      const response = await POST(request)

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ received: true })
      expect(fakeAdmin.upsertSpy).toHaveBeenCalledWith(
        { stripe_event_id: 'evt_unsupported_1', type: 'customer.updated' },
        { onConflict: 'stripe_event_id', ignoreDuplicates: true },
      )
      expect(fakeAdmin.updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ processed_at: expect.any(String) }),
      )
      expect(fakeAdmin.updateEqSpy).toHaveBeenCalledWith('stripe_event_id', 'evt_unsupported_1')
      // Unsupported event type never reaches handleEvent's dependent mocks.
      expect(syncSubscription).not.toHaveBeenCalled()
      expect(grantCopilot).not.toHaveBeenCalled()
    })

    it('returns 200 { received: true, duplicate: true } and skips handleEvent for an already-processed event', async () => {
      const fakeAdmin = buildFakeAdmin({ processed_at: '2026-07-01T00:00:00.000Z' })
      vi.mocked(createServiceRoleClient).mockReturnValue(fakeAdmin as never)

      const request = buildSignedRequest({
        id: 'evt_dup_1',
        type: 'checkout.session.completed',
        data: { object: { mode: 'subscription', subscription: 'sub_123' } },
      })

      const response = await POST(request)

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ received: true, duplicate: true })
      expect(syncSubscription).not.toHaveBeenCalled()
      expect(grantCopilot).not.toHaveBeenCalled()
      // Duplicate short-circuits before the update-processed_at write.
      expect(fakeAdmin.updateSpy).not.toHaveBeenCalled()
    })
  })

  // ---- Task 2: all six supported event types + edge cases ----

  describe('checkout.session.completed', () => {
    it('subscription mode: retrieves the subscription and syncs it', async () => {
      const fakeAdmin = buildFakeAdmin(null)
      vi.mocked(createServiceRoleClient).mockReturnValue(fakeAdmin as never)

      const fakeSubscription = {
        id: 'sub_123',
        customer: 'cus_1',
        status: 'active',
        cancel_at_period_end: false,
        metadata: {},
        items: { data: [{ price: { id: 'price_live_pro' } }] },
      }
      const retrieveSpy = vi.fn().mockResolvedValue(fakeSubscription)
      vi.mocked(getStripe).mockReturnValue(buildFakeStripe(retrieveSpy) as never)

      const request = buildSignedRequest({
        id: 'evt_checkout_sub_1',
        type: 'checkout.session.completed',
        data: {
          object: { id: 'cs_1', mode: 'subscription', subscription: 'sub_123' },
        },
      })

      const response = await POST(request)

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ received: true })
      expect(retrieveSpy).toHaveBeenCalledWith('sub_123')
      expect(syncSubscription).toHaveBeenCalledWith(fakeSubscription)
    })

    it('payment mode topup: grants copilot credits using catalog package data', async () => {
      const fakeAdmin = buildFakeAdmin(null)
      vi.mocked(createServiceRoleClient).mockReturnValue(fakeAdmin as never)

      const request = buildSignedRequest({
        id: 'evt_checkout_topup_1',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_topup_1',
            mode: 'payment',
            payment_intent: 'pi_123',
            metadata: { kind: 'copilot_topup', org_id: 'org-1', package: 'medium' },
          },
        },
      })

      const response = await POST(request)

      expect(response.status).toBe(200)
      expect(grantCopilot).toHaveBeenCalledWith(
        'org-1',
        CREDIT_TOPUP_PACKAGES.medium.creditsUsd,
        'topup',
        'pi_123',
        expect.stringContaining(CREDIT_TOPUP_PACKAGES.medium.name),
      )
    })

    it('payment mode topup with missing org/package metadata: does not grant credits, still returns 200', async () => {
      const fakeAdmin = buildFakeAdmin(null)
      vi.mocked(createServiceRoleClient).mockReturnValue(fakeAdmin as never)

      const request = buildSignedRequest({
        id: 'evt_checkout_topup_missing_meta',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_topup_2',
            mode: 'payment',
            payment_intent: 'pi_456',
            metadata: { kind: 'copilot_topup' }, // no org_id, no package
          },
        },
      })

      const response = await POST(request)

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ received: true })
      expect(grantCopilot).not.toHaveBeenCalled()
    })
  })

  describe('customer.subscription.* events', () => {
    it.each(['created', 'updated', 'deleted'] as const)(
      'customer.subscription.%s calls syncSubscription with event.data.object',
      async (suffix) => {
        const fakeAdmin = buildFakeAdmin(null)
        vi.mocked(createServiceRoleClient).mockReturnValue(fakeAdmin as never)

        const subscriptionObject = {
          id: `sub_${suffix}`,
          customer: 'cus_1',
          status: suffix === 'deleted' ? 'canceled' : 'active',
        }

        const request = buildSignedRequest({
          id: `evt_sub_${suffix}`,
          type: `customer.subscription.${suffix}`,
          data: { object: subscriptionObject },
        })

        const response = await POST(request)

        expect(response.status).toBe(200)
        expect(syncSubscription).toHaveBeenCalledWith(subscriptionObject)
      },
    )
  })

  describe('invoice.paid / invoice.payment_failed', () => {
    beforeEach(() => {
      process.env.STRIPE_PRICE_PRO = 'price_live_pro'
    })

    function fakeSubscriptionForInvoice() {
      return {
        id: 'sub_456',
        customer: 'cus_1',
        status: 'active',
        metadata: {},
        items: {
          data: [
            {
              price: { id: 'price_live_pro' },
              current_period_start: 1750000000,
              current_period_end: 1752600000,
            },
          ],
        },
      }
    }

    it('invoice.paid (current API shape): syncs subscription and refreshes copilot allowance', async () => {
      const fakeAdmin = buildFakeAdmin(null)
      vi.mocked(createServiceRoleClient).mockReturnValue(fakeAdmin as never)

      const fakeSubscription = fakeSubscriptionForInvoice()
      const retrieveSpy = vi.fn().mockResolvedValue(fakeSubscription)
      vi.mocked(getStripe).mockReturnValue(buildFakeStripe(retrieveSpy) as never)
      vi.mocked(resolveOrgIdByCustomer).mockResolvedValue('org-1')

      const request = buildSignedRequest({
        id: 'evt_invoice_paid_1',
        type: 'invoice.paid',
        data: {
          object: {
            id: 'in_1',
            customer: 'cus_1',
            parent: { subscription_details: { subscription: 'sub_456' } },
          },
        },
      })

      const response = await POST(request)

      expect(response.status).toBe(200)
      expect(retrieveSpy).toHaveBeenCalledWith('sub_456')
      expect(syncSubscription).toHaveBeenCalledWith(fakeSubscription)
      expect(resetCopilotForPeriod).toHaveBeenCalledWith(
        'org-1',
        20, // pro plan copilotIncludedUsd
        new Date(1752600000 * 1000).toISOString(),
      )
    })

    it('invoice.paid (legacy top-level subscription field): fallback still resolves and syncs', async () => {
      const fakeAdmin = buildFakeAdmin(null)
      vi.mocked(createServiceRoleClient).mockReturnValue(fakeAdmin as never)

      const fakeSubscription = fakeSubscriptionForInvoice()
      const retrieveSpy = vi.fn().mockResolvedValue(fakeSubscription)
      vi.mocked(getStripe).mockReturnValue(buildFakeStripe(retrieveSpy) as never)
      vi.mocked(resolveOrgIdByCustomer).mockResolvedValue('org-1')

      const request = buildSignedRequest({
        id: 'evt_invoice_paid_legacy',
        type: 'invoice.paid',
        data: {
          object: {
            id: 'in_2',
            customer: 'cus_1',
            subscription: 'sub_789', // legacy shape, no `parent` key at all
          },
        },
      })

      const response = await POST(request)

      expect(response.status).toBe(200)
      expect(retrieveSpy).toHaveBeenCalledWith('sub_789')
      expect(syncSubscription).toHaveBeenCalledWith(fakeSubscription)
    })

    it('invoice.payment_failed: syncs subscription but does NOT refresh copilot allowance', async () => {
      const fakeAdmin = buildFakeAdmin(null)
      vi.mocked(createServiceRoleClient).mockReturnValue(fakeAdmin as never)

      const fakeSubscription = fakeSubscriptionForInvoice()
      const retrieveSpy = vi.fn().mockResolvedValue(fakeSubscription)
      vi.mocked(getStripe).mockReturnValue(buildFakeStripe(retrieveSpy) as never)
      vi.mocked(resolveOrgIdByCustomer).mockResolvedValue('org-1')

      const request = buildSignedRequest({
        id: 'evt_invoice_failed_1',
        type: 'invoice.payment_failed',
        data: {
          object: {
            id: 'in_3',
            customer: 'cus_1',
            parent: { subscription_details: { subscription: 'sub_456' } },
          },
        },
      })

      const response = await POST(request)

      expect(response.status).toBe(200)
      expect(syncSubscription).toHaveBeenCalledWith(fakeSubscription)
      expect(resetCopilotForPeriod).not.toHaveBeenCalled()
    })
  })

  describe('processing failure', () => {
    it('returns 500 "Processing error" and does NOT write processed_at when handleEvent throws', async () => {
      const fakeAdmin = buildFakeAdmin(null)
      vi.mocked(createServiceRoleClient).mockReturnValue(fakeAdmin as never)
      vi.mocked(syncSubscription).mockRejectedValueOnce(new Error('boom'))

      const request = buildSignedRequest({
        id: 'evt_processing_fail_1',
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_fail', customer: 'cus_1', status: 'active' } },
      })

      const response = await POST(request)

      expect(response.status).toBe(500)
      expect(await response.text()).toBe('Processing error')
      expect(fakeAdmin.updateSpy).not.toHaveBeenCalled()
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: 'webhook.failed',
          source: 'stripe-webhook',
          severity: 'error',
          status: 'failed',
          actor_type: 'webhook',
          actor_id: 'evt_processing_fail_1',
          error_message: 'boom',
        }),
      )
    })
  })
})
