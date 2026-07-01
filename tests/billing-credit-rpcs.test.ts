// tests/billing-credit-rpcs.test.ts
// Phase 116 (BTC-03) — RPC-wrapper contract coverage for the Copilot credit
// wallet's write path: meterDebit / grantCopilot / resetCopilotForPeriod.
//
// SCOPE: these tests verify the JS RPC-wrapper's call contract (arguments
// passed, response/error handling) — they do NOT execute or verify the
// Postgres function body itself. The dual-bucket draw-down math simulated in
// mock return values mirrors supabase/migrations/1225_metering_reason.sql;
// SQL-level correctness was verified separately in Phase 114 via a live
// rolled-back transaction (see 116-VALIDATION.md).

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/lib/logger', () => ({ log: vi.fn() }))

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { meterDebit, grantCopilot, resetCopilotForPeriod } from '@/lib/billing/credits'
import { log } from '@/lib/logger'

let rpcSpy: ReturnType<typeof vi.fn>

function mockRpcOnce(impl: (fnName: string, args: unknown) => unknown) {
  rpcSpy.mockImplementationOnce(async (fnName: string, args: unknown) => impl(fnName, args))
}

beforeEach(() => {
  rpcSpy = vi.fn(async () => ({ data: null, error: null }))
  vi.mocked(createServiceRoleClient).mockReturnValue({ rpc: rpcSpy } as never)
})

describe('meterDebit — dual-bucket draw-down (via debit_copilot_credits RPC)', () => {
  it('normal draw-down: included=3,topup=10,debit=5 -> allowed:true, balanceAfter:8', async () => {
    mockRpcOnce(() => ({ data: { allowed: true, balance_after: 8 }, error: null }))

    const result = await meterDebit('org-1', 'copilot_turn', 5, 'run-123')

    expect(rpcSpy).toHaveBeenCalledWith('debit_copilot_credits', {
      p_org_id: 'org-1',
      p_amount_usd: 5,
      p_run_id: 'run-123',
      p_reason: 'copilot_turn',
    })
    expect(result).toEqual({ allowed: true, balanceAfter: 8 })
  })

  it('insufficient-balance: included=2,topup=1,debit=5 -> allowed:false, balanceAfter:-2 (NOT clamped)', async () => {
    mockRpcOnce(() => ({ data: { allowed: false, balance_after: -2 }, error: null }))

    const result = await meterDebit('org-1', 'copilot_turn', 5, 'run-123')

    expect(result).toEqual({ allowed: false, balanceAfter: -2 })
  })

  it('costUsd <= 0 short-circuits without calling the RPC', async () => {
    const zeroResult = await meterDebit('org-1', 'copilot_turn', 0, 'run-123')
    const negativeResult = await meterDebit('org-1', 'copilot_turn', -1, 'run-123')

    expect(rpcSpy).not.toHaveBeenCalled()
    expect(zeroResult).toEqual({ allowed: true, balanceAfter: 0 })
    expect(negativeResult).toEqual({ allowed: true, balanceAfter: 0 })
  })

  it('fails OPEN when the RPC returns an error field', async () => {
    mockRpcOnce(() => ({ data: null, error: { message: 'db exploded' } }))

    const result = await meterDebit('org-1', 'copilot_turn', 5, 'run-123')

    expect(result).toEqual({ allowed: true, balanceAfter: 0 })
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'credit_debit.failed',
        source: 'billing-credits',
        severity: 'error',
        status: 'failed',
        org_id: 'org-1',
        actor_type: 'system',
        error_message: 'db exploded',
      }),
    )
  })

  it('fails OPEN when the RPC call itself rejects (throws)', async () => {
    rpcSpy.mockImplementationOnce(async () => {
      throw new Error('network exploded')
    })

    const result = await meterDebit('org-1', 'copilot_turn', 5, 'run-123')

    expect(result).toEqual({ allowed: true, balanceAfter: 0 })
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'credit_debit.failed',
        source: 'billing-credits',
        severity: 'error',
        status: 'failed',
        org_id: 'org-1',
        actor_type: 'system',
        error_message: 'network exploded',
      }),
    )
  })
})

describe('grantCopilot (via credit_copilot_credits RPC)', () => {
  it('calls the RPC with the expected args and returns the new balance', async () => {
    mockRpcOnce(() => ({ data: 35, error: null }))

    const result = await grantCopilot('org-1', 25, 'topup', 'stripe_ref_1', 'top-up purchase')

    expect(rpcSpy).toHaveBeenCalledWith('credit_copilot_credits', {
      p_org_id: 'org-1',
      p_amount_usd: 25,
      p_kind: 'topup',
      p_ref: 'stripe_ref_1',
      p_note: 'top-up purchase',
    })
    expect(result).toBe(35)
  })

  it('defaults ref/note to null when omitted', async () => {
    mockRpcOnce(() => ({ data: 10, error: null }))

    await grantCopilot('org-1', 10, 'grant')

    expect(rpcSpy).toHaveBeenCalledWith('credit_copilot_credits', {
      p_org_id: 'org-1',
      p_amount_usd: 10,
      p_kind: 'grant',
      p_ref: null,
      p_note: null,
    })
  })

  it('throws (does NOT fail open) when the RPC returns an error', async () => {
    rpcSpy.mockImplementation(async () => ({ data: null, error: { message: 'wallet locked' } }))

    await expect(grantCopilot('org-1', 25, 'topup')).rejects.toThrow('grantCopilot failed:')
    await expect(grantCopilot('org-1', 25, 'topup')).rejects.toThrow('wallet locked')
  })
})

describe('resetCopilotForPeriod (via reset_copilot_credits RPC)', () => {
  it('calls the RPC with the expected args and returns the new allowance', async () => {
    mockRpcOnce(() => ({ data: 20, error: null }))

    const result = await resetCopilotForPeriod('org-1', 20, '2026-08-01T00:00:00.000Z')

    expect(rpcSpy).toHaveBeenCalledWith('reset_copilot_credits', {
      p_org_id: 'org-1',
      p_included_usd: 20,
      p_period_end: '2026-08-01T00:00:00.000Z',
    })
    expect(result).toBe(20)
  })

  it('defaults periodEnd to null when omitted', async () => {
    mockRpcOnce(() => ({ data: 20, error: null }))

    await resetCopilotForPeriod('org-1', 20)

    expect(rpcSpy).toHaveBeenCalledWith('reset_copilot_credits', {
      p_org_id: 'org-1',
      p_included_usd: 20,
      p_period_end: null,
    })
  })

  it('throws when the RPC returns an error', async () => {
    rpcSpy.mockImplementation(async () => ({ data: null, error: { message: 'period already reset' } }))

    await expect(resetCopilotForPeriod('org-1', 20)).rejects.toThrow('resetCopilotForPeriod failed:')
    await expect(resetCopilotForPeriod('org-1', 20)).rejects.toThrow('period already reset')
  })
})
