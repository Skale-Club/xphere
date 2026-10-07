// A booking-platform address (help.us@booksy.com...) is never the business's own mailbox, so the
// verification engine must decide it by rule: no provider call (no credit spent), persisted as
// invalid / platform_rule / high risk, and counted apart from real provider verdicts.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createServiceRoleClient } = vi.hoisted(() => ({ createServiceRoleClient: vi.fn() }))
const { verifyWithMillionVerifier, verifyWithNeverBounce } = vi.hoisted(() => ({
  verifyWithMillionVerifier: vi.fn(),
  verifyWithNeverBounce: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient }))
vi.mock('@/lib/email-verification/providers', () => ({ verifyWithMillionVerifier, verifyWithNeverBounce }))

import { verifyProspectEmail, verifyProspectsBatch } from '@/lib/email-verification/verify'

type Call = { table: string; data: Record<string, unknown>; eq: Array<[string, unknown]> }

function makeDb(existing: Record<string, unknown> | null = null) {
  const updates: Call[] = []
  function from(table: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = {}
    let pending: Record<string, unknown> | undefined
    const eqs: Array<[string, unknown]> = []
    q.select = vi.fn(() => q)
    q.update = vi.fn((data: Record<string, unknown>) => {
      pending = data
      return q
    })
    q.eq = vi.fn((col: string, val: unknown) => {
      eqs.push([col, val])
      return q
    })
    q.maybeSingle = vi.fn(async () => ({ data: existing, error: null }))
    q.then = (resolve: (value: unknown) => unknown) => {
      if (pending) updates.push({ table, data: pending, eq: eqs })
      return Promise.resolve({ data: null, error: null }).then(resolve)
    }
    return q
  }
  return { from: vi.fn(from), updates }
}

describe('verifyProspectEmail — platform addresses', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('never calls a provider, persists invalid/platform_rule/high and does not stamp email_verified_at', async () => {
    const db = makeDb()
    createServiceRoleClient.mockReturnValue(db)

    const result = await verifyProspectEmail('org-1', 'account', 'acc-1', 'Help.Us@Booksy.com')

    expect(verifyWithMillionVerifier).not.toHaveBeenCalled()
    expect(verifyWithNeverBounce).not.toHaveBeenCalled()
    expect(result).toMatchObject({ status: 'invalid', risk: 'high', provider: 'platform_rule', cached: false })

    expect(db.updates).toHaveLength(1)
    expect(db.updates[0].table).toBe('accounts')
    expect(db.updates[0].data).toMatchObject({
      email_status: 'invalid',
      email_verification_provider: 'platform_rule',
      email_risk: 'high',
    })
    // the cron's daily spend cap counts email_verified_at: nothing was verified, so it stays untouched
    expect(db.updates[0].data).not.toHaveProperty('email_verified_at')
    expect(db.updates[0].eq).toEqual([['org_id', 'org-1'], ['id', 'acc-1']])
  })

  it('ignores force and skips even a row whose cached status is a fresh ok', async () => {
    const db = makeDb({ email_status: 'ok', email_verified_at: new Date().toISOString(), email_verification_provider: 'millionverifier' })
    createServiceRoleClient.mockReturnValue(db)

    const result = await verifyProspectEmail('org-1', 'contact', 'c-1', 'safeguarding@vagaro.com', { force: true })

    expect(verifyWithMillionVerifier).not.toHaveBeenCalled()
    expect(result).toMatchObject({ status: 'invalid', provider: 'platform_rule' })
    expect(db.updates[0].table).toBe('contacts')
  })

  it('does not reuse a stale platform_rule verdict once the email is no longer a platform address', async () => {
    const db = makeDb({
      email_status: 'invalid',
      email_verified_at: new Date().toISOString(),
      email_verification_provider: 'platform_rule',
    })
    createServiceRoleClient.mockReturnValue(db)
    verifyWithMillionVerifier.mockResolvedValue({ status: 'ok', risk: 'low', provider: 'millionverifier', raw: {} })

    const result = await verifyProspectEmail('org-1', 'account', 'acc-1', 'owner@independentshop.example')

    expect(verifyWithMillionVerifier).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ status: 'ok', provider: 'millionverifier' })
  })
})

describe('verifyProspectsBatch — platform_email aggregate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('counts platform addresses in platform_email only (not invalid) and marks them not sendable', async () => {
    createServiceRoleClient.mockReturnValue(makeDb())
    verifyWithMillionVerifier.mockResolvedValue({ status: 'ok', risk: 'low', provider: 'millionverifier', raw: {} })

    const batch = await verifyProspectsBatch('org-1', [
      { kind: 'account', id: 'a1', email: 'help.us@booksy.com' },
      { kind: 'account', id: 'a2', email: 'owner@independentshop.example' },
      { kind: 'account', id: 'a3', email: 'privacy@pocketsuite.io' },
    ])

    expect(batch.aggregate).toEqual({
      ok: 1,
      catch_all: 0,
      unknown: 0,
      invalid: 0,
      disposable: 0,
      bounced: 0,
      blocked: 0,
      platform_email: 2,
    })
    expect(batch.results.map((r) => r.sendable)).toEqual([false, true, false])
    // only the one real address reached a provider
    expect(verifyWithMillionVerifier).toHaveBeenCalledTimes(1)
    expect(verifyWithMillionVerifier).toHaveBeenCalledWith('owner@independentshop.example')
  })
})
