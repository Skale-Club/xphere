import { describe, expect, it, vi, beforeEach } from 'vitest'

// ─── In-memory ledger ───────────────────────────────────────────────────────────
// The real store.ts does everything through conditional UPDATEs so exactly one
// concurrent caller wins a transition; this fake reproduces just that contract
// (status must be in `from` or the transition is a no-op returning null) so the
// engine's state machine is exercised against something that behaves like the
// database, not a mock that always succeeds.

const ledger = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  events: [] as Array<Record<string, unknown>>,
  seq: 0,
  accountFailures: 0,
  reconcile: [] as Array<Record<string, unknown>>,
  laterChange: false,
}))

function resetLedger() {
  ledger.rows.clear()
  ledger.events = []
  ledger.seq = 0
  ledger.accountFailures = 0
  ledger.reconcile = []
  ledger.laterChange = false
}

vi.mock('@/lib/ads/commands/store', () => {
  return {
    insertChange: vi.fn(async (row: Record<string, unknown>) => {
      const existing = [...ledger.rows.values()].find(
        (r) => r.org_id === row.org_id && r.idempotency_key === row.idempotency_key,
      )
      if (existing) return { row: existing, duplicate: true }
      const id = `change-${++ledger.seq}`
      const now = new Date().toISOString()
      const full = {
        id,
        created_at: now,
        updated_at: now,
        executed_at: null,
        completed_at: null,
        attempt_count: 0,
        approved_by: null,
        approved_by_label: null,
        approved_at: null,
        next_attempt_at: null,
        error_code: null,
        error_message: null,
        verification: null,
        provider_ref: null,
        ...row,
      }
      ledger.rows.set(id, full)
      return { row: full, duplicate: false }
    }),
    getChangeRow: vi.fn(async (orgId: string, changeId: string) => {
      const row = ledger.rows.get(changeId)
      return row && row.org_id === orgId ? row : null
    }),
    transition: vi.fn(
      async (params: {
        orgId: string
        changeId: string
        from: string[]
        to: string
        patch?: Record<string, unknown>
        actor: unknown
        eventType?: string
        detail?: Record<string, unknown>
      }) => {
        const row = ledger.rows.get(params.changeId)
        if (!row || row.org_id !== params.orgId) return null
        if (!params.from.includes(row.status as string)) return null
        const updated = { ...row, ...(params.patch ?? {}), status: params.to, updated_at: new Date().toISOString() }
        ledger.rows.set(params.changeId, updated)
        ledger.events.push({ changeId: params.changeId, eventType: params.eventType ?? params.to, actor: params.actor, detail: params.detail })
        return updated
      },
    ),
    appendEvent: vi.fn(async (params: Record<string, unknown>) => {
      ledger.events.push(params)
    }),
    listChangeRows: vi.fn(async (orgId: string, filters: { batchId?: string; status?: string[] } = {}) =>
      [...ledger.rows.values()].filter(
        (r) =>
          r.org_id === orgId &&
          (!filters.batchId || r.batch_id === filters.batchId) &&
          (!filters.status || filters.status.includes(r.status as string)),
      ),
    ),
    listChangeEvents: vi.fn(async (orgId: string, changeId: string) =>
      ledger.events.filter((e) => e.changeId === changeId),
    ),
    dueQueuedChanges: vi.fn(async (limit: number) =>
      [...ledger.rows.values()]
        .filter((r) => r.status === 'queued' && typeof r.next_attempt_at === 'string' && Date.parse(r.next_attempt_at as string) <= Date.now())
        .slice(0, limit)
        .map((r) => ({ id: r.id as string, org_id: r.org_id as string })),
    ),
    staleApprovals: vi.fn(async (limit: number) =>
      [...ledger.rows.values()]
        .filter((r) => r.status === 'awaiting_approval' && typeof r.approval_expires_at === 'string' && Date.parse(r.approval_expires_at as string) < Date.now())
        .slice(0, limit)
        .map((r) => ({ id: r.id as string, org_id: r.org_id as string })),
    ),
    stuckChanges: vi.fn(async () => []),
    recentAccountFailures: vi.fn(async () => ledger.accountFailures),
    changesToReconcile: vi.fn(async () => ledger.reconcile),
    hasLaterChange: vi.fn(async () => ledger.laterChange),
    updateReconciliation: vi.fn(async (_orgId: string, changeId: string, patch: Record<string, unknown>) => {
      const row = ledger.rows.get(changeId)
      if (row) ledger.rows.set(changeId, { ...row, ...patch })
    }),
  }
})

// ─── Providers ──────────────────────────────────────────────────────────────────
// A single controllable fake adapter. Individual tests reassign its mock
// implementations rather than swapping the whole module, since the engine only
// ever talks to it through the AdsProviderAdapter interface.

const fakeAdapter = vi.hoisted(() => ({
  platform: 'google' as const,
  capabilities: vi.fn(() => [{ type: 'google.campaign.set_status' }, { type: 'google.keyword.set_cpc_bid' }]),
  snapshot: vi.fn(),
  plan: vi.fn(),
  validate: vi.fn(async () => {}),
  execute: vi.fn(),
  verify: vi.fn(),
  buildRollback: vi.fn(() => null as unknown),
  classifyError: vi.fn(() => ({ code: 'unknown', message: 'boom', transient: false, auth: false })),
}))

const loadAdapterContextMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/ads/providers', () => ({
  getAdapter: () => fakeAdapter,
  loadAdapterContext: (...args: unknown[]) => loadAdapterContextMock(...args),
}))

// ─── Policies: real evaluatePolicy, mocked loadEffectivePolicy only ─────────────

const loadEffectivePolicyMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/ads/commands/policies', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ads/commands/policies')>('@/lib/ads/commands/policies')
  return { ...actual, loadEffectivePolicy: (...args: unknown[]) => loadEffectivePolicyMock(...args) }
})

// ─── Side effects: journey, cache, connection health ────────────────────────────

const recordMutationMock = vi.hoisted(() => vi.fn(async (_args: { changeRequestId?: string }) => {}))
const invalidateMock = vi.hoisted(() => vi.fn(async () => {}))
const markConnectionErrorMock = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('@/lib/ads/journey-db', () => ({ recordMutationExecution: recordMutationMock }))
vi.mock('@/lib/ads/cache', () => ({ invalidateAccountReports: invalidateMock }))
vi.mock('@/lib/ads/connection-health', () => ({ markConnectionError: markConnectionErrorMock }))

import {
  approveBatch,
  approveChange,
  cancelChange,
  executeChange,
  reconcileAppliedChanges,
  previewChange,
  processChangeQueue,
  retryChange,
  rollbackChange,
  submitChange,
} from '@/lib/ads/commands/engine'
import { defaultPolicy } from '@/lib/ads/commands/policies'
import type { AdsActor, ResourceSnapshot } from '@/lib/ads/commands/types'
import { insertChange } from '@/lib/ads/commands/store'
import { hashState } from '@/lib/ads/commands/hash'

const ORG = 'org-1'

function human(overrides: Partial<AdsActor> = {}): AdsActor {
  return { type: 'user', id: 'u1', label: 'user:u1', canManage: true, canApprove: false, ...overrides }
}
function ai(overrides: Partial<AdsActor> = {}): AdsActor {
  return { type: 'ai', id: 'agent-1', label: 'mcp:xph_ab12', canManage: false, canApprove: false, ...overrides }
}

// risk 1 command — never trips requireApprovalMinRisk on its own.
const RISK1_COMMAND = {
  platform: 'google' as const,
  ad_account_id: '1234567890',
  type: 'google.campaign.set_status' as const,
  campaign_id: '111',
  status: 'ENABLED' as const,
}

// risk 3 command — at the default requireApprovalMinRisk (3), so a human
// change needs approval unless they hold ads.approve.
const RISK3_COMMAND = {
  platform: 'google' as const,
  ad_account_id: '1234567890',
  type: 'google.keyword.set_cpc_bid' as const,
  ad_group_id: '55',
  criterion_id: '66',
  cpc_bid: 2.5,
}

const SNAPSHOT: ResourceSnapshot = {
  resourceType: 'campaign',
  resourceId: '111',
  resourceName: 'Campaign 1',
  campaignId: '111',
  currency: 'USD',
  fields: { status: 'PAUSED' },
}

function samePlan(before: ResourceSnapshot) {
  return {
    ok: true as const,
    intended: { status: 'ENABLED' },
    diff: [{ field: 'status', label: 'Status', before: before.fields.status, after: 'ENABLED', beforeDisplay: 'PAUSED', afterDisplay: 'ENABLED' }],
    warnings: [],
    facts: {},
  }
}

beforeEach(() => {
  resetLedger()
  vi.clearAllMocks()
  loadAdapterContextMock.mockResolvedValue({ ok: true, ctx: { orgId: ORG, adAccountId: '1234567890', credential: 'token' }, accountName: 'Acct' })
  loadEffectivePolicyMock.mockResolvedValue(defaultPolicy())
  fakeAdapter.snapshot.mockResolvedValue(SNAPSHOT)
  fakeAdapter.plan.mockImplementation((_cmd: unknown, before: ResourceSnapshot) => samePlan(before))
  fakeAdapter.execute.mockResolvedValue({ providerRef: 'ref-1', raw: {} })
  fakeAdapter.verify.mockResolvedValue({ ok: true, mismatches: [], observed: { status: 'ENABLED' } })
  fakeAdapter.buildRollback.mockReturnValue(null)
  fakeAdapter.capabilities.mockReturnValue([{ type: 'google.campaign.set_status' }, { type: 'google.keyword.set_cpc_bid' }])
})

// ─── Human, self-approvable, risk requiring approval ────────────────────────────

describe('submitChange — human with ads.approve on an approval-required change', () => {
  it('executes end to end: succeeded, journey recorded with changeRequestId, cache invalidated', async () => {
    const result = await submitChange({ orgId: ORG, actor: human({ canApprove: true }), command: RISK3_COMMAND })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.change.status).toBe('succeeded')
    expect(fakeAdapter.execute).toHaveBeenCalledTimes(1)
    expect(recordMutationMock).toHaveBeenCalledTimes(1)
    const journeyArgs = recordMutationMock.mock.calls[0][0]
    expect(journeyArgs.changeRequestId).toBe((result as { change: { id: string } }).change.id)
    expect(invalidateMock).toHaveBeenCalledWith(ORG, 'google', '1234567890')
  })
})

describe('submitChange — human without ads.approve on an approval-required change', () => {
  it('stays awaiting_approval and never calls the provider execute', async () => {
    const result = await submitChange({ orgId: ORG, actor: human({ canApprove: false }), command: RISK3_COMMAND })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.change.status).toBe('awaiting_approval')
      expect(result.change.approval_required).toBe(true)
    }
    expect(fakeAdapter.execute).not.toHaveBeenCalled()
  })
})

// ─── AI actors ───────────────────────────────────────────────────────────────────

describe('previewChange — AI actor', () => {
  it('always lands in awaiting_approval and returns a confirmation token', async () => {
    const result = await previewChange({ orgId: ORG, actor: ai(), command: RISK1_COMMAND })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.change.status).toBe('awaiting_approval')
      expect(result.confirmationToken).toBeTruthy()
      expect(result.change.approval_reasons.map((r) => r.code)).toContain('machine_actor')
    }
  })
})

describe('approveChange — AI actor under default propose mode', () => {
  it('fails with approval_requires_human', async () => {
    const preview = await previewChange({ orgId: ORG, actor: ai(), command: RISK1_COMMAND })
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    const result = await approveChange({ orgId: ORG, changeId: preview.change.id, actor: ai(), confirmationToken: preview.confirmationToken })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('approval_requires_human')
  })
})

describe('approveChange — AI actor under execute_with_confirmation', () => {
  beforeEach(() => {
    loadEffectivePolicyMock.mockResolvedValue({ ...defaultPolicy(), aiMode: 'execute_with_confirmation' as const })
  })

  it('succeeds with the correct confirmation token', async () => {
    const preview = await previewChange({ orgId: ORG, actor: ai(), command: RISK1_COMMAND })
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    const result = await approveChange({ orgId: ORG, changeId: preview.change.id, actor: ai(), confirmationToken: preview.confirmationToken })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.change.status).toBe('succeeded')
  })

  it('fails with the wrong confirmation token', async () => {
    const preview = await previewChange({ orgId: ORG, actor: ai(), command: RISK1_COMMAND })
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    const result = await approveChange({ orgId: ORG, changeId: preview.change.id, actor: ai(), confirmationToken: 'adsc_wrong-token' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('invalid_confirmation')
  })

  it('fails when a different AI actor label tries to confirm it', async () => {
    const preview = await previewChange({ orgId: ORG, actor: ai(), command: RISK1_COMMAND })
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    const result = await approveChange({
      orgId: ORG,
      changeId: preview.change.id,
      actor: ai({ label: 'mcp:someone-else' }),
      confirmationToken: preview.confirmationToken,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('forbidden')
  })
})

describe('approveChange — expired approval window', () => {
  it('transitions to expired and fails with code expired', async () => {
    // A negative TTL puts approval_expires_at in the past the moment the row
    // is created — no need to fake system time to observe the expiry path.
    loadEffectivePolicyMock.mockResolvedValue({ ...defaultPolicy(), approvalTtlMinutes: -1 })
    const preview = await previewChange({ orgId: ORG, actor: human({ canApprove: false }), command: RISK3_COMMAND })
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    const result = await approveChange({ orgId: ORG, changeId: preview.change.id, actor: human({ canApprove: true }) })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('expired')
      expect(result.change?.status).toBe('expired')
    }
  })
})

// ─── Policy block at preview: nothing persisted ─────────────────────────────────

describe('previewChange — blocked by policy', () => {
  it('fails with policy_blocked and persists nothing', async () => {
    const result = await previewChange({ orgId: ORG, actor: human({ canManage: false }), command: RISK1_COMMAND })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('policy_blocked')
    expect(insertChange).not.toHaveBeenCalled()
    expect([...ledger.rows.values()]).toHaveLength(0)
  })
})

// ─── Optimistic concurrency ──────────────────────────────────────────────────────

describe('executeChange — state changed since preview', () => {
  it('fails with state_conflict and marks the change failed', async () => {
    const preview = await previewChange({ orgId: ORG, actor: human({ canApprove: true }), command: RISK1_COMMAND })
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    // The world moved between preview and execute.
    fakeAdapter.snapshot.mockResolvedValue({ ...SNAPSHOT, fields: { status: 'ENABLED' } })
    fakeAdapter.plan.mockReturnValue({ ok: false, code: 'no_op', message: 'already enabled' })
    const result = await approveChange({ orgId: ORG, changeId: preview.change.id, actor: human({ canApprove: true }) })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('state_conflict')
      expect(result.change?.status).toBe('failed')
    }
  })
})

// ─── Execution errors: transient vs permanent ───────────────────────────────────

describe('executeChange — provider errors', () => {
  it('a transient error re-queues the change with a next_attempt_at', async () => {
    const preview = await previewChange({ orgId: ORG, actor: human({ canApprove: true }), command: RISK1_COMMAND })
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    fakeAdapter.execute.mockRejectedValueOnce(new Error('temporary blip'))
    fakeAdapter.classifyError.mockReturnValue({ code: 'network', message: 'temporary blip', transient: true, auth: false })
    const result = await approveChange({ orgId: ORG, changeId: preview.change.id, actor: human({ canApprove: true }) })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('retry_scheduled')
      expect(result.change?.status).toBe('queued')
      expect(result.change?.next_attempt_at).toBeTruthy()
    }
  })

  it('a non-transient error fails the change outright', async () => {
    const preview = await previewChange({ orgId: ORG, actor: human({ canApprove: true }), command: RISK1_COMMAND })
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    fakeAdapter.execute.mockRejectedValueOnce(new Error('rejected'))
    fakeAdapter.classifyError.mockReturnValue({ code: 'invalid_input', message: 'rejected', transient: false, auth: false })
    const result = await approveChange({ orgId: ORG, changeId: preview.change.id, actor: human({ canApprove: true }) })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('invalid_input')
      expect(result.change?.status).toBe('failed')
    }
  })

  it('a retry that finds the change already applied by an earlier attempt succeeds', async () => {
    const preview = await previewChange({ orgId: ORG, actor: human({ canApprove: true }), command: RISK1_COMMAND })
    expect(preview.ok).toBe(true)
    if (!preview.ok) return

    // First attempt: transient failure, queued for retry.
    fakeAdapter.execute.mockRejectedValueOnce(new Error('timeout'))
    fakeAdapter.classifyError.mockReturnValue({ code: 'network', message: 'timeout', transient: true, auth: false })
    const first = await approveChange({ orgId: ORG, changeId: preview.change.id, actor: human({ canApprove: true }) })
    expect(first.ok).toBe(false)

    // Second attempt: the world now shows the write actually landed, and a
    // fresh plan against that state is a no_op — the earlier attempt worked,
    // only its response was lost.
    fakeAdapter.snapshot.mockResolvedValue({ ...SNAPSHOT, fields: { status: 'ENABLED' } })
    fakeAdapter.plan.mockReturnValue({ ok: false, code: 'no_op', message: 'already enabled' })
    const retry = await executeChange({ orgId: ORG, changeId: preview.change.id, actor: human({ canApprove: true }) })
    expect(retry.ok).toBe(true)
    if (retry.ok) {
      expect(retry.change.status).toBe('succeeded')
      expect(retry.change.verification).toMatchObject({ ok: true })
    }
  })
})

// ─── Verification outcomes ────────────────────────────────────────────────────────

describe('executeChange — verification', () => {
  it('a mismatch between intended and observed state lands the change as drifted', async () => {
    fakeAdapter.verify.mockResolvedValue({ ok: false, mismatches: [{ field: 'status', expected: 'ENABLED', actual: 'PAUSED' }], observed: { status: 'PAUSED' } })
    const result = await submitChange({ orgId: ORG, actor: human({ canApprove: true }), command: RISK1_COMMAND })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.change.status).toBe('drifted')
  })

  it('a verification read that throws still reports success, with checked: false', async () => {
    fakeAdapter.verify.mockRejectedValue(new Error('read-back timed out'))
    const result = await submitChange({ orgId: ORG, actor: human({ canApprove: true }), command: RISK1_COMMAND })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.change.status).toBe('succeeded')
      expect(result.change.verification).toMatchObject({ checked: false })
    }
  })
})

// ─── Idempotency / duplicate previews ────────────────────────────────────────────

describe('previewChange — idempotency', () => {
  it('an identical preview of the same command against the same state returns the same change (duplicate: true)', async () => {
    const actor = human({ canApprove: false })
    const first = await previewChange({ orgId: ORG, actor, command: RISK3_COMMAND })
    const second = await previewChange({ orgId: ORG, actor, command: RISK3_COMMAND })
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (first.ok && second.ok) {
      expect(second.duplicate).toBe(true)
      expect(second.change.id).toBe(first.change.id)
    }
  })

  it('after the change is cancelled, previewing the same command again creates a fresh row', async () => {
    const actor = human({ canApprove: false })
    const first = await previewChange({ orgId: ORG, actor, command: RISK3_COMMAND })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const cancelled = await cancelChange({ orgId: ORG, changeId: first.change.id, actor: human({ canManage: true }) })
    expect(cancelled.ok).toBe(true)

    const second = await previewChange({ orgId: ORG, actor, command: RISK3_COMMAND })
    expect(second.ok).toBe(true)
    if (second.ok) {
      expect(second.duplicate).toBe(false)
      expect(second.change.id).not.toBe(first.change.id)
    }
  })

  it('a derived key mints a fresh row after the change succeeded — pause -> rollback -> pause again must not be swallowed by the old succeeded row', async () => {
    const actor = human({ canApprove: true })
    const first = await submitChange({ orgId: ORG, actor, command: RISK1_COMMAND })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.change.status).toBe('succeeded')

    // Same command against the same (mocked, unchanged) snapshot: the derived
    // idempotency key would be identical to the first call's.
    const second = await previewChange({ orgId: ORG, actor, command: RISK1_COMMAND })
    expect(second.ok).toBe(true)
    if (second.ok) {
      expect(second.duplicate).toBe(false)
      expect(second.change.id).not.toBe(first.change.id)
      expect(second.change.status).toBe('awaiting_approval')
    }
  })

  it('an explicit idempotency key is always honoured as-is, even once the row is terminal (succeeded)', async () => {
    const key = 'explicit-key-succeeded'
    const actor = human({ canApprove: true })
    const first = await submitChange({ orgId: ORG, actor, command: RISK1_COMMAND, idempotencyKey: key })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.change.status).toBe('succeeded')

    // A client retrying the exact same request with the same key must get the
    // original row back, not a silently re-executed second attempt.
    const second = await previewChange({ orgId: ORG, actor, command: RISK1_COMMAND, idempotencyKey: key })
    expect(second.ok).toBe(true)
    if (second.ok) {
      expect(second.duplicate).toBe(true)
      expect(second.change.id).toBe(first.change.id)
      expect(second.change.status).toBe('succeeded')
    }
    expect(fakeAdapter.execute).toHaveBeenCalledTimes(1)
  })
})

// ─── Cancel ─────────────────────────────────────────────────────────────────────

describe('cancelChange', () => {
  it('cancels a change awaiting approval', async () => {
    const preview = await previewChange({ orgId: ORG, actor: human({ canApprove: false }), command: RISK3_COMMAND })
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    const result = await cancelChange({ orgId: ORG, changeId: preview.change.id, actor: human() })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.change.status).toBe('cancelled')
  })

  it('refuses to cancel a change that already reached a terminal state', async () => {
    const succeeded = await submitChange({ orgId: ORG, actor: human({ canApprove: true }), command: RISK1_COMMAND })
    expect(succeeded.ok).toBe(true)
    if (!succeeded.ok) return
    const result = await cancelChange({ orgId: ORG, changeId: succeeded.change.id, actor: human() })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('invalid_state')
  })
})

// ─── Rollback ───────────────────────────────────────────────────────────────────

describe('rollbackChange', () => {
  it('previews the adapter-built inverse command with rollback_of set to the original change', async () => {
    const succeeded = await submitChange({ orgId: ORG, actor: human({ canApprove: true }), command: RISK1_COMMAND })
    expect(succeeded.ok).toBe(true)
    if (!succeeded.ok) return

    fakeAdapter.buildRollback.mockReturnValue({ ...RISK1_COMMAND, status: 'PAUSED' })
    fakeAdapter.plan.mockImplementation((_cmd: unknown, before: ResourceSnapshot) => ({
      ok: true,
      intended: { status: 'PAUSED' },
      diff: [{ field: 'status', label: 'Status', before: before.fields.status, after: 'PAUSED', beforeDisplay: 'ENABLED', afterDisplay: 'PAUSED' }],
      warnings: [],
      facts: {},
    }))

    const result = await rollbackChange({ orgId: ORG, changeId: succeeded.change.id, actor: human({ canApprove: true }) })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.change.rollback_of).toBe(succeeded.change.id)
  })

  it('refuses to build a rollback when the adapter has no safe inverse', async () => {
    const succeeded = await submitChange({ orgId: ORG, actor: human({ canApprove: true }), command: RISK1_COMMAND })
    expect(succeeded.ok).toBe(true)
    if (!succeeded.ok) return
    fakeAdapter.buildRollback.mockReturnValue(null)
    const result = await rollbackChange({ orgId: ORG, changeId: succeeded.change.id, actor: human({ canApprove: true }) })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('not_reversible')
  })
})

// ─── Retry ──────────────────────────────────────────────────────────────────────

describe('retryChange', () => {
  it('re-previews a failed change against the current state', async () => {
    fakeAdapter.execute.mockRejectedValueOnce(new Error('rejected'))
    fakeAdapter.classifyError.mockReturnValue({ code: 'invalid_input', message: 'rejected', transient: false, auth: false })
    const failed = await submitChange({ orgId: ORG, actor: human({ canApprove: true }), command: RISK1_COMMAND })
    expect(failed.ok).toBe(false)
    if (failed.ok) return
    const changeId = failed.change!.id

    fakeAdapter.classifyError.mockReturnValue({ code: 'unknown', message: 'boom', transient: false, auth: false })
    const result = await retryChange({ orgId: ORG, changeId, actor: human({ canApprove: true }) })
    expect(result.ok).toBe(true)
  })
})

// ─── processChangeQueue ──────────────────────────────────────────────────────────

describe('processChangeQueue', () => {
  it('expires stale approvals and executes due queued changes', async () => {
    // Stale approval.
    loadEffectivePolicyMock.mockResolvedValueOnce({ ...defaultPolicy(), approvalTtlMinutes: -1 })
    const stalePreview = await previewChange({ orgId: ORG, actor: human({ canApprove: false }), command: RISK3_COMMAND })
    expect(stalePreview.ok).toBe(true)

    // Due queued change: preview + approve with a human lacking canApprove
    // would stay awaiting_approval, so use a risk-1 command with a human who
    // can self-approve, then force it back to queued with a past next_attempt_at.
    loadEffectivePolicyMock.mockResolvedValue(defaultPolicy())
    const duePreview = await previewChange({ orgId: ORG, actor: human({ canApprove: true }), command: { ...RISK1_COMMAND, campaign_id: '222' } })
    expect(duePreview.ok).toBe(true)
    if (!duePreview.ok) return
    const approved = await approveChange({ orgId: ORG, changeId: duePreview.change.id, actor: human({ canApprove: true }) })
    expect(approved.ok).toBe(true) // executes immediately in this fake, ending as succeeded

    // Give processChangeQueue something concrete to execute: insert a queued
    // row directly the way the ledger mock stores it.
    const queuedRow = {
      org_id: ORG,
      platform: 'google',
      ad_account_id: '1234567890',
      command_type: RISK1_COMMAND.type,
      resource_type: 'campaign',
      resource_id: '333',
      resource_name: 'Campaign 333',
      campaign_id: '333',
      payload: { ...RISK1_COMMAND, campaign_id: '333' },
      before_state: SNAPSHOT,
      before_hash: hashState(SNAPSHOT.fields),
      intended_state: { status: 'ENABLED' },
      diff: [],
      warnings: [],
      policy_verdict: {},
      risk_level: 1,
      status: 'queued',
      actor_type: 'user',
      actor_id: 'u1',
      actor_label: 'user:u1',
      idempotency_key: 'manual-due-key',
      approval_required: false,
      approval_expires_at: new Date(Date.now() + 60_000).toISOString(),
      confirmation_hash: null,
      rollback_of: null,
      batch_id: null,
      next_attempt_at: new Date(Date.now() - 1000).toISOString(),
    }
    await insertChange(queuedRow as never)

    fakeAdapter.snapshot.mockResolvedValue(SNAPSHOT)
    fakeAdapter.plan.mockImplementation((_cmd: unknown, before: ResourceSnapshot) => samePlan(before))

    const result = await processChangeQueue({ limit: 10 })
    expect(result.expired).toBeGreaterThanOrEqual(1)
    expect(result.executed).toBeGreaterThanOrEqual(1)

    if (!stalePreview.ok) return
    const expiredRow = ledger.rows.get(stalePreview.change.id)
    expect(expiredRow?.status).toBe('expired')
  })
})

// ─── Round 2: unsupported commands, circuit breaker, batches, reconciliation ──

describe('previewChange — command the adapter does not implement', () => {
  it('refuses it as unsupported instead of calling the adapter', async () => {
    // A catalog entry without an adapter implementation must never reach a
    // provider call that would return undefined and crash mid-lifecycle.
    fakeAdapter.capabilities.mockReturnValue([])
    const result = await previewChange({ orgId: ORG, actor: human(), command: RISK1_COMMAND })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('unsupported_command')
    expect(fakeAdapter.snapshot).not.toHaveBeenCalled()
    expect(ledger.rows.size).toBe(0)
  })
})

describe('executeChange — circuit breaker', () => {
  it('re-queues without spending an attempt or touching the platform when the account keeps failing', async () => {
    const preview = await previewChange({ orgId: ORG, actor: human({ canApprove: true }), command: RISK1_COMMAND })
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    ledger.accountFailures = 5

    const result = await approveChange({ orgId: ORG, changeId: preview.change.id, actor: human({ canApprove: true }) })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('circuit_open')
    expect(fakeAdapter.execute).not.toHaveBeenCalled()
    const row = ledger.rows.get(preview.change.id)!
    expect(row.status).toBe('queued')
    expect(row.attempt_count).toBe(0)
    expect(Date.parse(row.next_attempt_at as string)).toBeGreaterThan(Date.now() + 5 * 60_000)
    expect(ledger.events.some((e) => e.eventType === 'circuit_open')).toBe(true)
  })

  it('runs normally below the threshold', async () => {
    ledger.accountFailures = 4
    const result = await submitChange({ orgId: ORG, actor: human({ canApprove: true }), command: RISK1_COMMAND })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.change.status).toBe('succeeded')
  })
})

describe('approveBatch', () => {
  it('applies every pending change of the batch and reports each outcome', async () => {
    const a = await previewChange({ orgId: ORG, actor: human(), command: RISK1_COMMAND, batchId: 'batch-1', batchSize: 2 })
    const b = await previewChange({ orgId: ORG, actor: human(), command: RISK3_COMMAND, batchId: 'batch-1', batchSize: 2 })
    expect(a.ok && b.ok).toBe(true)

    const { results } = await approveBatch({ orgId: ORG, batchId: 'batch-1', actor: human({ canApprove: true }) })

    expect(results).toHaveLength(2)
    expect(results.every((r) => r.ok)).toBe(true)
    expect(fakeAdapter.execute).toHaveBeenCalledTimes(2)
  })

  it('keeps going after one change fails', async () => {
    await previewChange({ orgId: ORG, actor: human(), command: RISK1_COMMAND, batchId: 'batch-2', batchSize: 2 })
    await previewChange({ orgId: ORG, actor: human(), command: RISK3_COMMAND, batchId: 'batch-2', batchSize: 2 })
    fakeAdapter.execute.mockRejectedValueOnce(new Error('rejected')).mockResolvedValueOnce({ providerRef: 'ref-2', raw: {} })

    const { results } = await approveBatch({ orgId: ORG, batchId: 'batch-2', actor: human({ canApprove: true }) })

    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok)).toHaveLength(1)
    expect(fakeAdapter.execute).toHaveBeenCalledTimes(2)
  })

  it('requires a matching token per change for an AI actor', async () => {
    loadEffectivePolicyMock.mockResolvedValue({ ...defaultPolicy(), aiMode: 'execute_with_confirmation' })
    const p = await previewChange({ orgId: ORG, actor: ai(), command: RISK1_COMMAND, batchId: 'batch-3', batchSize: 1 })
    expect(p.ok).toBe(true)
    if (!p.ok) return

    const wrong = await approveBatch({ orgId: ORG, batchId: 'batch-3', actor: ai(), confirmationTokens: { [p.change.id]: 'adsc_wrong_token_value' } })
    expect(wrong.results[0].ok).toBe(false)

    const right = await approveBatch({ orgId: ORG, batchId: 'batch-3', actor: ai(), confirmationTokens: { [p.change.id]: p.confirmationToken! } })
    expect(right.results[0].ok).toBe(true)
  })
})

describe('reconcileAppliedChanges', () => {
  async function applied() {
    const r = await submitChange({ orgId: ORG, actor: human({ canApprove: true }), command: RISK1_COMMAND })
    if (!r.ok) throw new Error('setup failed')
    const row = ledger.rows.get(r.change.id)!
    ledger.reconcile = [row]
    return row
  }

  it('flags a change the platform no longer reflects, without rewriting its status', async () => {
    const row = await applied()
    fakeAdapter.verify.mockResolvedValue({ ok: false, mismatches: [{ field: 'status', expected: 'ENABLED', actual: 'PAUSED' }], observed: { status: 'PAUSED' } })

    const result = await reconcileAppliedChanges()

    expect(result).toMatchObject({ checked: 1, drifted: 1 })
    const updated = ledger.rows.get(row.id as string)!
    expect(updated.status).toBe('succeeded')
    expect(updated.external_drift_detected_at).toBeTruthy()
    expect(ledger.events.some((e) => e.eventType === 'external_change_detected')).toBe(true)
  })

  it('does not flag drift when a later Xphere change touched the same resource', async () => {
    await applied()
    ledger.laterChange = true
    fakeAdapter.verify.mockResolvedValue({ ok: false, mismatches: [{ field: 'status', expected: 'ENABLED', actual: 'PAUSED' }], observed: {} })

    const result = await reconcileAppliedChanges()

    expect(result.drifted).toBe(0)
    expect(ledger.events.some((e) => e.eventType === 'external_change_detected')).toBe(false)
  })

  it('treats a failed read as unknown, not as drift', async () => {
    const row = await applied()
    fakeAdapter.verify.mockRejectedValue(new Error('timeout'))

    const result = await reconcileAppliedChanges()

    expect(result).toMatchObject({ drifted: 0, errors: 1 })
    expect(ledger.rows.get(row.id as string)!.external_drift_detected_at).toBeFalsy()
  })
})
