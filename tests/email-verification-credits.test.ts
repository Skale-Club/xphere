// tests/email-verification-credits.test.ts
//
// getNeverBounceCredits against the documented /v4/account/info response. The
// balance lives under `credits_info`; reading any other key silently yields 0,
// which reads as "out of credits" and stops the auto-verify tick.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function stubAccountInfo(body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })))
}

async function loadCredits() {
  vi.resetModules()
  return import('@/lib/email-verification/credits')
}

describe('getNeverBounceCredits', () => {
  beforeEach(() => {
    vi.stubEnv('NEVERBOUNCE_API_KEY', 'test-key')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('sums paid and free credits from credits_info', async () => {
    stubAccountInfo({
      status: 'success',
      credits_info: {
        paid_credits_used: 0,
        free_credits_used: 0,
        paid_credits_remaining: 1000,
        free_credits_remaining: 25,
      },
      job_counts: { completed: 0, under_review: 0, queued: 0, processing: 0 },
      execution_time: 100,
    })

    const { getNeverBounceCredits } = await loadCredits()

    await expect(getNeverBounceCredits()).resolves.toEqual({ configured: true, credits: 1025, ok: true })
  })

  it('reports a real zero balance as not ok', async () => {
    stubAccountInfo({
      status: 'success',
      credits_info: { paid_credits_remaining: 0, free_credits_remaining: 0 },
    })

    const { getNeverBounceCredits } = await loadCredits()

    await expect(getNeverBounceCredits()).resolves.toEqual({ configured: true, credits: 0, ok: false })
  })

  it('reports an unknown balance, not zero, when credits_info is missing', async () => {
    stubAccountInfo({ status: 'success' })

    const { getNeverBounceCredits } = await loadCredits()

    await expect(getNeverBounceCredits()).resolves.toMatchObject({ configured: true, credits: null, ok: false })
  })
})
