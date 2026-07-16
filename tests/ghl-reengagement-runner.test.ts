// tests/ghl-reengagement-runner.test.ts
// Phase 32 — REENG-02, REENG-04, REENG-10, REENG-11, REENG-12 + edge cases.
// GREEN as of Plan 03 (src/lib/automations/ghl-reengagement/runner.ts shipped).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  FIXTURE_LOST_OLD_PAGE_1,
  FIXTURE_LOST_OLD_PAGE_2,
  FIXTURE_LOST_RECENT_ONLY,
  FIXTURE_EMPTY,
} from './__mocks__/ghl-opportunities-fixture'

// ---- Hoisted mocks ----
vi.mock('@/lib/ghl/list-opportunities', () => ({
  listOpportunities: vi.fn(),
  GHL_DATE_FILTER_PARAM: 'date',
}))
vi.mock('@/lib/ghl/send-sms', () => ({
  sendSmsViaGhl: vi.fn(),
}))
vi.mock('@/lib/logger', () => ({
  log: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/crypto', () => ({
  decrypt: vi.fn().mockResolvedValue('decrypted-ghl-key'),
}))

import { runReengagement, type RunnerConfig } from '@/lib/automations/ghl-reengagement/runner'
import { listOpportunities } from '@/lib/ghl/list-opportunities'
import { sendSmsViaGhl } from '@/lib/ghl/send-sms'
import { log } from '@/lib/logger'

// ---- Helpers ----
const ORG_ID = 'org_skleanings'
const INTEGRATION_ID = 'int_ghl_001'
const LOCATION_ID = 'loc_test_skleanings'

const ACTIVE_GHL_INTEGRATION = {
  id: INTEGRATION_ID,
  organization_id: ORG_ID,
  provider: 'gohighlevel',
  is_active: true,
  encrypted_api_key: 'iv:ciphertext',
}

const INACTIVE_GHL_INTEGRATION = {
  ...ACTIVE_GHL_INTEGRATION,
  is_active: false,
}

interface SupabaseMockOptions {
  integration?: Record<string, unknown> | null
  integrationError?: { message: string } | null
  alreadySentContactIds?: string[]
  insertResults?: Map<string, { id: string } | null> // contactId -> insert result (null = conflict)
}

function buildMockSupabase(opts: SupabaseMockOptions = {}) {
  const {
    integration = ACTIVE_GHL_INTEGRATION,
    integrationError = null,
    alreadySentContactIds = [],
    insertResults,
  } = opts

  const insertCalls: Array<{ contactId: string; payload: Record<string, unknown> }> = []
  const deleteCalls: Array<{ contactId: string }> = []
  const selectAlreadyCalls: Array<{ contactIds: string[] }> = []
  let insertCounter = 0

  const fromMock = vi.fn((table: string) => {
    if (table === 'integrations') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: integration, error: integrationError }),
          }),
        }),
      }
    }
    if (table === 'ghl_reengagement_sent') {
      return {
        // SELECT for bulk anti-loop pre-check
        select: vi.fn().mockImplementation(() => ({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockImplementation((_col: string, ids: string[]) => {
              selectAlreadyCalls.push({ contactIds: ids })
              const data = alreadySentContactIds
                .filter(id => ids.includes(id))
                .map(id => ({ ghl_contact_id: id }))
              return Promise.resolve({ data, error: null })
            }),
          }),
        })),
        // INSERT (claim-first)
        insert: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
          const contactId = String(payload.ghl_contact_id)
          insertCalls.push({ contactId, payload })
          return {
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockImplementation(() => {
                // Allow per-contact override (for conflict simulation)
                if (insertResults && insertResults.has(contactId)) {
                  const r = insertResults.get(contactId)
                  if (r === null) {
                    return Promise.resolve({ data: null, error: { message: 'unique violation' } })
                  }
                  return Promise.resolve({ data: r, error: null })
                }
                insertCounter++
                return Promise.resolve({ data: { id: `row_${insertCounter}` }, error: null })
              }),
            }),
          }
        }),
        // DELETE (rollback on send failure)
        delete: vi.fn().mockImplementation(() => ({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockImplementation((_col: string, value: string) => {
              deleteCalls.push({ contactId: value })
              return Promise.resolve({ data: null, error: null })
            }),
          }),
        })),
      }
    }
    return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() }
  })

  return {
    supabase: { from: fromMock } as never,
    fromMock,
    insertCalls,
    deleteCalls,
    selectAlreadyCalls,
  }
}

function baseCfg(overrides: Partial<RunnerConfig> = {}): RunnerConfig {
  return {
    integrationId: INTEGRATION_ID,
    locationId: LOCATION_ID,
    messageTemplate: 'Olá {{first_name}}, faz tempo que não falamos! Volte com a gente.',
    thresholdDays: 180,
    batchLimit: 20,
    runStartedAtIso: '2026-05-15T14:00:00.000Z',
    ...overrides,
  }
}

const ALL_OLD_OPPS = [
  ...FIXTURE_LOST_OLD_PAGE_1.opportunities,
  ...FIXTURE_LOST_OLD_PAGE_2.opportunities,
]

describe('runReengagement (REENG-02, REENG-04, REENG-10, REENG-11, REENG-12)', () => {
  beforeEach(() => { vi.clearAllMocks() })
  afterEach(() => { vi.restoreAllMocks() })

  // ---- Happy path ----
  it('lists Lost opportunities older than threshold and dispatches SMS to each new contact', async () => {
    vi.mocked(listOpportunities).mockResolvedValue(ALL_OLD_OPPS)
    vi.mocked(sendSmsViaGhl).mockResolvedValue('SMS sent via GHL. ID: msg_x')

    const { supabase } = buildMockSupabase()
    const result = await runReengagement(baseCfg(), supabase)

    expect(result.processed).toBe(5)
    expect(result.sent).toBe(5)
    expect(result.failed).toBe(0)
    expect(result.skipped).toBe(0)
    expect(result.errors).toEqual([])
  })

  // ---- Pre-flight: inactive integration row ----
  it('rejects when integration row is inactive', async () => {
    const { supabase } = buildMockSupabase({ integration: INACTIVE_GHL_INTEGRATION })
    await expect(runReengagement(baseCfg(), supabase)).rejects.toThrow(/inactive|not found/i)
  })

  // ---- REENG-04: contact field extraction ----
  it('passes contact.id and rendered body into sendSmsViaGhl params', async () => {
    vi.mocked(listOpportunities).mockResolvedValue(ALL_OLD_OPPS)
    vi.mocked(sendSmsViaGhl).mockResolvedValue('SMS sent via GHL. ID: msg_x')

    const { supabase } = buildMockSupabase()
    await runReengagement(baseCfg(), supabase)

    const callsByContact = vi.mocked(sendSmsViaGhl).mock.calls.map(
      ([params]) => (params as { contactId: string; body: string }),
    )
    const ids = callsByContact.map(c => c.contactId).sort()
    expect(ids).toEqual(['ct_001', 'ct_002', 'ct_003', 'ct_004', 'ct_005'])
    for (const c of callsByContact) {
      expect(typeof c.body).toBe('string')
      expect(c.body.length).toBeGreaterThan(0)
    }
  })

  // ---- REENG-10: anti-loop skip ----
  it('skips contacts already present in ghl_reengagement_sent (anti-loop)', async () => {
    vi.mocked(listOpportunities).mockResolvedValue(ALL_OLD_OPPS)
    vi.mocked(sendSmsViaGhl).mockResolvedValue('SMS sent via GHL. ID: msg_x')

    const { supabase } = buildMockSupabase({ alreadySentContactIds: ['ct_001'] })
    const result = await runReengagement(baseCfg(), supabase)

    const sendCallContactIds = vi.mocked(sendSmsViaGhl).mock.calls.map(
      ([params]) => (params as { contactId: string }).contactId,
    )
    expect(sendCallContactIds).not.toContain('ct_001')
    expect(result.skipped).toBeGreaterThanOrEqual(1)
    expect(result.sent).toBe(4)
  })

  // ---- REENG-11: claim-first rollback ----
  it('claims the anti-loop row BEFORE sending, deletes on GHL failure (claim-first pattern)', async () => {
    vi.mocked(listOpportunities).mockResolvedValue(ALL_OLD_OPPS)
    vi.mocked(sendSmsViaGhl).mockImplementation(async params => {
      const id = (params as { contactId: string }).contactId
      if (id === 'ct_004') throw new Error('GHL API error 422: no SMS permission')
      return 'SMS sent via GHL. ID: msg_x'
    })

    const { supabase, insertCalls, deleteCalls } = buildMockSupabase()
    const result = await runReengagement(baseCfg(), supabase)

    // 5 inserts (claim BEFORE send)
    expect(insertCalls).toHaveLength(5)
    // Only ct_004 rolled back
    expect(deleteCalls.map(c => c.contactId)).toEqual(['ct_004'])
    expect(result.failed).toBe(1)
  })

  it('insert conflict (concurrent claim) — second concurrent run returning null row skips the dispatch', async () => {
    vi.mocked(listOpportunities).mockResolvedValue(ALL_OLD_OPPS)
    vi.mocked(sendSmsViaGhl).mockResolvedValue('SMS sent via GHL. ID: msg_x')

    const insertResults = new Map<string, { id: string } | null>([
      ['ct_002', null], // simulate conflict
    ])
    const { supabase } = buildMockSupabase({ insertResults })
    const result = await runReengagement(baseCfg(), supabase)

    const sendCallContactIds = vi.mocked(sendSmsViaGhl).mock.calls.map(
      ([params]) => (params as { contactId: string }).contactId,
    )
    expect(sendCallContactIds).not.toContain('ct_002')
    expect(result.skipped).toBeGreaterThanOrEqual(1)
  })

  // ---- REENG-12: log() per dispatch ----
  it('calls log() once per dispatch attempt with event_type="ghl_reengagement.sms_sent" and a run-scoped correlation_id', async () => {
    vi.mocked(listOpportunities).mockResolvedValue(ALL_OLD_OPPS)
    vi.mocked(sendSmsViaGhl).mockResolvedValue('SMS sent via GHL. ID: msg_x')

    const { supabase } = buildMockSupabase()
    await runReengagement(baseCfg(), supabase)

    expect(vi.mocked(log)).toHaveBeenCalledTimes(5)
    for (const call of vi.mocked(log).mock.calls) {
      const entry = call[0]
      expect(entry.event_type).toBe('ghl_reengagement.sms_sent')
      expect(entry.source).toBe('ghl-reengagement')
      expect(entry.correlation_id).toMatch(/^cron:ghl-reengagement:\d{4}-\d{2}-\d{2}T/)
    }
  })

  it('log() payload includes ghl_contact_id (opaque) and truncates body to 40 chars; phone NEVER logged (T-32-03 / D-32-11)', async () => {
    vi.mocked(listOpportunities).mockResolvedValue([ALL_OLD_OPPS[0]])
    vi.mocked(sendSmsViaGhl).mockResolvedValue('SMS sent via GHL. ID: msg_x')

    const { supabase } = buildMockSupabase()
    await runReengagement(
      baseCfg({ messageTemplate: 'a'.repeat(80) }),
      supabase,
    )

    expect(vi.mocked(log)).toHaveBeenCalledTimes(1)
    const entry = vi.mocked(log).mock.calls[0][0]
    const payload = entry.payload as Record<string, unknown>
    expect(payload.ghl_contact_id).toBe('ct_001')
    expect(typeof payload.body).toBe('string')
    expect((payload.body as string).length).toBeLessThanOrEqual(40)
    expect(payload.phone).toBeUndefined()
    expect(payload.to).toBeUndefined()
  })

  it('log() on GHL failure: status="failed" + error_message populated', async () => {
    vi.mocked(listOpportunities).mockResolvedValue([ALL_OLD_OPPS[0]])
    vi.mocked(sendSmsViaGhl).mockRejectedValue(new Error('GHL API error 422: bad phone'))

    const { supabase } = buildMockSupabase()
    await runReengagement(baseCfg(), supabase)

    const errorCalls = vi.mocked(log).mock.calls.filter(c => c[0].status === 'failed')
    expect(errorCalls.length).toBeGreaterThanOrEqual(1)
    expect(errorCalls[0][0].error_message).toContain('422')
  })

  // ---- REENG-03 defense-in-depth ----
  it('JS-side date guard: filters out opportunities younger than threshold even if GHL returns them', async () => {
    // Force "now" so RECENT (2026-05-01) is within 180-day window
    vi.setSystemTime(new Date('2026-05-15T00:00:00.000Z'))
    vi.mocked(listOpportunities).mockResolvedValue(FIXTURE_LOST_RECENT_ONLY.opportunities)
    vi.mocked(sendSmsViaGhl).mockResolvedValue('SMS sent via GHL. ID: msg_x')

    const { supabase } = buildMockSupabase()
    const result = await runReengagement(baseCfg(), supabase)

    expect(result.processed).toBe(0)
    expect(vi.mocked(sendSmsViaGhl)).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  // ---- Edge cases from VALIDATION.md ----
  it('empty Lost list returns { processed:0, sent:0, skipped:0, failed:0, errors:[] }', async () => {
    vi.mocked(listOpportunities).mockResolvedValue(FIXTURE_EMPTY.opportunities)
    const { supabase } = buildMockSupabase()
    const result = await runReengagement(baseCfg(), supabase)
    expect(result).toEqual({ processed: 0, sent: 0, skipped: 0, failed: 0, errors: [] })
    expect(vi.mocked(sendSmsViaGhl)).not.toHaveBeenCalled()
  })

  it('all contacts in anti-loop → processed=N, sent=0, skipped=N', async () => {
    vi.mocked(listOpportunities).mockResolvedValue(ALL_OLD_OPPS)
    vi.mocked(sendSmsViaGhl).mockResolvedValue('ok')

    const alreadyAll = ALL_OLD_OPPS.map(o => o.contact.id)
    const { supabase } = buildMockSupabase({ alreadySentContactIds: alreadyAll })
    const result = await runReengagement(baseCfg(), supabase)

    expect(result.processed).toBe(5)
    expect(result.sent).toBe(0)
    expect(result.skipped).toBe(5)
    expect(vi.mocked(sendSmsViaGhl)).not.toHaveBeenCalled()
  })

  it('mixed success/failure via Promise.allSettled — one GHL fail does not block others', async () => {
    vi.mocked(listOpportunities).mockResolvedValue(ALL_OLD_OPPS.slice(0, 3))
    vi.mocked(sendSmsViaGhl).mockImplementation(async params => {
      const id = (params as { contactId: string }).contactId
      if (id === 'ct_002') throw new Error('GHL API error 500: server')
      return 'SMS sent via GHL. ID: msg_x'
    })

    const { supabase } = buildMockSupabase()
    const result = await runReengagement(baseCfg(), supabase)

    expect(result.sent).toBe(2)
    expect(result.failed).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].ghl_contact_id).toBe('ct_002')
    expect(result.errors[0].message).toContain('500')
  })

  it('GHL returns 4xx for contact with no phone → counted as "failed" with error_detail (D-32-03)', async () => {
    // ct_004 has non-E.164 phone; GHL would 4xx. Runner classifies as failed, not skipped.
    vi.mocked(listOpportunities).mockResolvedValue([ALL_OLD_OPPS[3]]) // ct_004
    vi.mocked(sendSmsViaGhl).mockRejectedValue(new Error('GHL API error 400: invalid phone'))

    const { supabase } = buildMockSupabase()
    const result = await runReengagement(baseCfg(), supabase)

    expect(vi.mocked(sendSmsViaGhl)).toHaveBeenCalled() // no pre-validation
    expect(result.failed).toBe(1)
    expect(result.errors[0].ghl_contact_id).toBe('ct_004')
    expect(result.errors[0].message).toContain('400')
  })

  it('missing firstName → SMS body contains "amigo(a)"; dispatch succeeds', async () => {
    vi.mocked(listOpportunities).mockResolvedValue([ALL_OLD_OPPS[2]]) // ct_003 has firstName: null
    vi.mocked(sendSmsViaGhl).mockResolvedValue('SMS sent via GHL. ID: msg_x')

    const { supabase } = buildMockSupabase()
    await runReengagement(baseCfg(), supabase)

    const call = vi.mocked(sendSmsViaGhl).mock.calls[0]
    const params = call[0] as { contactId: string; body: string }
    expect(params.contactId).toBe('ct_003')
    expect(params.body).toContain('amigo(a)')
  })

  it('GHL 401 on first listOpportunities call → throws so route handler returns 500', async () => {
    vi.mocked(listOpportunities).mockRejectedValue(new Error('GHL API error 401: unauthorized'))
    const { supabase } = buildMockSupabase()
    await expect(runReengagement(baseCfg(), supabase)).rejects.toThrow(/401/)
  })

  it('respects batchLimit: stops dispatching after batchLimit successful sends in one run', async () => {
    vi.mocked(listOpportunities).mockResolvedValue(ALL_OLD_OPPS)
    vi.mocked(sendSmsViaGhl).mockResolvedValue('SMS sent via GHL. ID: msg_x')

    const { supabase } = buildMockSupabase()
    const result = await runReengagement(baseCfg({ batchLimit: 2 }), supabase)

    expect(vi.mocked(sendSmsViaGhl)).toHaveBeenCalledTimes(2)
    expect(result.sent).toBe(2)
    expect(result.processed).toBe(5)
  })

  // ---- D-32-05: fromNumberOverride forwarding ----
  it('cfg.fromNumberOverride set → forwards params.fromNumber on every sendSmsViaGhl call', async () => {
    vi.mocked(listOpportunities).mockResolvedValue(ALL_OLD_OPPS)
    vi.mocked(sendSmsViaGhl).mockResolvedValue('ok')

    const { supabase } = buildMockSupabase()
    await runReengagement(baseCfg({ fromNumberOverride: '+5511AAA' }), supabase)

    for (const call of vi.mocked(sendSmsViaGhl).mock.calls) {
      const params = call[0] as { fromNumber?: string }
      expect(params.fromNumber).toBe('+5511AAA')
    }
  })

  it('cfg.fromNumberOverride unset → params.fromNumber undefined on every call', async () => {
    vi.mocked(listOpportunities).mockResolvedValue(ALL_OLD_OPPS)
    vi.mocked(sendSmsViaGhl).mockResolvedValue('ok')

    const { supabase } = buildMockSupabase()
    await runReengagement(baseCfg(), supabase)

    for (const call of vi.mocked(sendSmsViaGhl).mock.calls) {
      const params = call[0] as { fromNumber?: string; to?: unknown; phone?: unknown }
      expect(params.fromNumber).toBeUndefined()
      // D-32-02: contactId-direct path, NEVER to/phone
      expect(params.to).toBeUndefined()
      expect(params.phone).toBeUndefined()
    }
  })
})
