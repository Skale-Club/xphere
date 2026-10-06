// The "why" of a change travels through the Ads Command Engine: rationale,
// Global Knowledge refs and memory refs are normalised and stored on the
// ledger row at preview, exposed on the ChangeView, kept by retry and carried
// (with a "Rollback of change …" rationale) by rollback. The outcome reviewer
// later files results against exactly these references.
//
// Mock layout mirrors tests/ads-command-engine.test.ts: an in-memory ledger
// with the store's conditional-transition contract and one fake adapter.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const ledger = vi.hoisted(() => ({ rows: new Map<string, Record<string, unknown>>(), seq: 0 }))

vi.mock('@/lib/ads/commands/store', () => ({
  insertChange: vi.fn(async (row: Record<string, unknown>) => {
    const existing = [...ledger.rows.values()].find((r) => r.org_id === row.org_id && r.idempotency_key === row.idempotency_key)
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
      outcome: null,
      outcome_reviewed_at: null,
      ...row,
    }
    ledger.rows.set(id, full)
    return { row: full, duplicate: false }
  }),
  getChangeRow: vi.fn(async (orgId: string, id: string) => {
    const row = ledger.rows.get(id)
    return row && row.org_id === orgId ? row : null
  }),
  transition: vi.fn(async (p: { orgId: string; changeId: string; from: string[]; to: string; patch?: Record<string, unknown> }) => {
    const row = ledger.rows.get(p.changeId)
    if (!row || row.org_id !== p.orgId || !p.from.includes(row.status as string)) return null
    const updated = { ...row, ...(p.patch ?? {}), status: p.to }
    ledger.rows.set(p.changeId, updated)
    return updated
  }),
  appendEvent: vi.fn(async () => {}),
  listChangeRows: vi.fn(async () => [...ledger.rows.values()]),
  listChangeEvents: vi.fn(async () => []),
  dueQueuedChanges: vi.fn(async () => []),
  staleApprovals: vi.fn(async () => []),
  stuckChanges: vi.fn(async () => []),
  recentAccountFailures: vi.fn(async () => 0),
  changesToReconcile: vi.fn(async () => []),
  hasLaterChange: vi.fn(async () => false),
  updateReconciliation: vi.fn(async () => {}),
}))

const fakeAdapter = vi.hoisted(() => ({
  platform: 'google' as const,
  capabilities: vi.fn(() => [{ type: 'google.campaign.set_status' }]),
  snapshot: vi.fn(),
  plan: vi.fn(),
  validate: vi.fn(async () => {}),
  execute: vi.fn(),
  verify: vi.fn(),
  buildRollback: vi.fn(() => null as unknown),
  classifyError: vi.fn(() => ({ code: 'unknown', message: 'boom', transient: false, auth: false })),
}))

vi.mock('@/lib/ads/providers', () => ({
  getAdapter: () => fakeAdapter,
  loadAdapterContext: vi.fn(async () => ({ ok: true, ctx: { orgId: 'org-1', adAccountId: '1234567890', credential: 't' }, accountName: 'Acct' })),
}))

vi.mock('@/lib/ads/commands/policies', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ads/commands/policies')>('@/lib/ads/commands/policies')
  return { ...actual, loadEffectivePolicy: vi.fn(async () => actual.defaultPolicy()) }
})
vi.mock('@/lib/ads/journey-db', () => ({ recordMutationExecution: vi.fn(async () => {}) }))
vi.mock('@/lib/ads/cache', () => ({ invalidateAccountReports: vi.fn(async () => {}) }))
vi.mock('@/lib/ads/connection-health', () => ({ markConnectionError: vi.fn(async () => {}) }))

import {
  MAX_RATIONALE_CHARS,
  normalizeMemoryRefs,
  normalizeRationale,
  previewChange,
  retryChange,
  rollbackChange,
  sanitizeKnowledgeRefs,
  submitChange,
} from '@/lib/ads/commands/engine'
import type { AdsActor, ResourceSnapshot } from '@/lib/ads/commands/types'

const ORG = 'org-1'
const K1 = '11111111-1111-4111-8111-111111111111'
const K2 = '22222222-2222-4222-8222-222222222222'
const M1 = '33333333-3333-4333-8333-333333333333'

const ai: AdsActor = { type: 'ai', id: 'agent-1', label: 'mcp:xph_ab12', canManage: false, canApprove: false }
const approver: AdsActor = { type: 'user', id: 'u1', label: 'user:u1', canManage: true, canApprove: true }

const COMMAND = { platform: 'google' as const, ad_account_id: '1234567890', type: 'google.campaign.set_status' as const, campaign_id: '111', status: 'ENABLED' as const }
const PAUSED: ResourceSnapshot = { resourceType: 'campaign', resourceId: '111', resourceName: 'Campaign 1', campaignId: '111', currency: 'USD', fields: { status: 'PAUSED' } }

beforeEach(() => {
  ledger.rows.clear()
  ledger.seq = 0
  vi.clearAllMocks()
  fakeAdapter.capabilities.mockReturnValue([{ type: 'google.campaign.set_status' }])
  fakeAdapter.snapshot.mockResolvedValue(PAUSED)
  fakeAdapter.plan.mockImplementation((cmd: { status: string }, before: ResourceSnapshot) => ({
    ok: true,
    intended: { status: cmd.status },
    diff: [{ field: 'status', label: 'Status', before: before.fields.status, after: cmd.status, beforeDisplay: String(before.fields.status), afterDisplay: cmd.status }],
    warnings: [],
    facts: {},
  }))
  fakeAdapter.execute.mockResolvedValue({ providerRef: 'ref-1', raw: {} })
  fakeAdapter.verify.mockResolvedValue({ ok: true, mismatches: [], observed: { status: 'ENABLED' } })
})

describe('normalisers', () => {
  it('trims and caps the rationale; empty becomes null', () => {
    expect(normalizeRationale('  because CPA  ')).toBe('because CPA')
    expect(normalizeRationale('   ')).toBeNull()
    expect(normalizeRationale(undefined)).toBeNull()
    const long = normalizeRationale('x'.repeat(MAX_RATIONALE_CHARS + 500))
    expect(long).toHaveLength(MAX_RATIONALE_CHARS)
  })

  it('keeps only valid, distinct memory UUIDs (max 20)', () => {
    expect(normalizeMemoryRefs([M1, M1.toUpperCase(), 'not-a-uuid', ''])).toEqual([M1])
    const many = Array.from({ length: 30 }, (_, i) => `33333333-3333-4333-8333-${String(i).padStart(12, '0')}`)
    expect(normalizeMemoryRefs(many)).toHaveLength(20)
  })

  it('drops invalid knowledge refs and dedupes by source', () => {
    expect(
      sanitizeKnowledgeRefs([
        { source_id: K1, source_name: 'Budget scaling playbook' },
        { source_id: K1, source_name: 'duplicate' },
        { source_id: 'nope' },
        { source_id: K2, url: 'not a url' },
      ]),
    ).toEqual([{ source_id: K1, source_name: 'Budget scaling playbook', url: null }])
  })
})

describe('previewChange stores the grounding', () => {
  it('persists rationale, knowledge refs and memory refs, and exposes them on the view', async () => {
    const result = await previewChange({
      orgId: ORG,
      actor: ai,
      command: COMMAND,
      rationale: '  Paused campaign had the best CPA last quarter.  ',
      knowledgeRefs: [{ source_id: K1, source_name: 'Seasonality lesson', url: 'https://example.com/lesson' }],
      memoryRefs: [M1, 'junk'],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const row = ledger.rows.get(result.change.id)!
    expect(row.rationale).toBe('Paused campaign had the best CPA last quarter.')
    expect(row.knowledge_refs).toEqual([{ source_id: K1, source_name: 'Seasonality lesson', url: 'https://example.com/lesson' }])
    expect(row.memory_refs).toEqual([M1])
    expect(result.change.rationale).toBe('Paused campaign had the best CPA last quarter.')
    expect(result.change.knowledge_refs).toEqual([{ source_id: K1, source_name: 'Seasonality lesson', url: 'https://example.com/lesson' }])
    expect(result.change.memory_refs).toEqual([M1])
    expect(result.change.outcome).toBeNull()
    expect(result.change.outcome_reviewed_at).toBeNull()
  })

  it('without grounding the columns get their empty defaults (other clients keep working)', async () => {
    const result = await previewChange({ orgId: ORG, actor: ai, command: COMMAND })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const row = ledger.rows.get(result.change.id)!
    expect(row.rationale).toBeNull()
    expect(row.knowledge_refs).toEqual([])
    expect(row.memory_refs).toEqual([])
  })

  it('submitChange passes the grounding through', async () => {
    const result = await submitChange({ orgId: ORG, actor: approver, command: COMMAND, rationale: 'Operator call', knowledgeRefs: [{ source_id: K2 }] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.change.status).toBe('succeeded')
    expect(result.change.rationale).toBe('Operator call')
    expect(result.change.knowledge_refs).toEqual([{ source_id: K2, source_name: null, url: null }])
  })
})

describe('rollback and retry keep the grounding', () => {
  it('rollback carries the original refs with a "Rollback of change" rationale', async () => {
    const applied = await submitChange({
      orgId: ORG,
      actor: approver,
      command: COMMAND,
      rationale: 'Re-enable for the sale',
      knowledgeRefs: [{ source_id: K1, source_name: 'Seasonality lesson' }],
      memoryRefs: [M1],
    })
    expect(applied.ok && applied.change.status).toBe('succeeded')
    if (!applied.ok) return
    fakeAdapter.snapshot.mockResolvedValue({ ...PAUSED, fields: { status: 'ENABLED' } })
    fakeAdapter.buildRollback.mockReturnValue({ ...COMMAND, status: 'PAUSED' })

    const back = await rollbackChange({ orgId: ORG, changeId: applied.change.id, actor: approver, rationale: 'CPA doubled' })
    expect(back.ok).toBe(true)
    if (!back.ok) return
    expect(back.change.rollback_of).toBe(applied.change.id)
    expect(back.change.rationale).toBe(`Rollback of change ${applied.change.id}: CPA doubled`)
    expect(back.change.knowledge_refs).toEqual([{ source_id: K1, source_name: 'Seasonality lesson', url: null }])
    expect(back.change.memory_refs).toEqual([M1])
  })

  it('retry re-previews with the same rationale and refs', async () => {
    const first = await previewChange({ orgId: ORG, actor: ai, command: COMMAND, rationale: 'Try again', knowledgeRefs: [{ source_id: K1 }], memoryRefs: [M1] })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const row = ledger.rows.get(first.change.id)!
    ledger.rows.set(first.change.id, { ...row, status: 'failed' })

    const retried = await retryChange({ orgId: ORG, changeId: first.change.id, actor: ai })
    expect(retried.ok).toBe(true)
    if (!retried.ok) return
    expect(retried.change.id).not.toBe(first.change.id)
    expect(retried.change.rationale).toBe('Try again')
    expect(retried.change.knowledge_refs).toEqual([{ source_id: K1, source_name: null, url: null }])
    expect(retried.change.memory_refs).toEqual([M1])
  })
})
