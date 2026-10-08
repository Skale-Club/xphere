// tests/prospect-verify-tick-route.test.ts
//
// Coverage for GET /api/cron/prospect-verify-tick — the automated trigger for
// email verification described in src/app/api/cron/prospect-verify-tick/
// route.ts. Asserts the checklist from that file's header:
//   - disabled (PROSPECTING_AUTO_VERIFY unset) never touches the DB or a
//     provider
//   - enabled: verifies only never-checked prospects with a linked run,
//     respects the daily cap, and notifies Xmail with the right
//     external_run_id per run
//   - out of credits (upfront, or mid-run): stops and reports it loudly,
//     never silently
//
// Mocking recipe mirrors tests/mcp-prospects-verify.test.ts (same shared
// dependencies: verifyProspectsBatch, credits, Xmail client, Supabase admin)
// plus tests/ads-tick-route.test.ts's dynamic-import-per-test pattern, since
// this route also reads CRON_SECRET / PROSPECTING_AUTO_VERIFY* into request
// handling and must never hit the real DB or providers against this
// worktree's production-pointed .env.local.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createServiceRoleClient } = vi.hoisted(() => ({ createServiceRoleClient: vi.fn() }))
const { verifyProspectsBatch } = vi.hoisted(() => ({ verifyProspectsBatch: vi.fn() }))
const { getMillionVerifierCredits, getVerificationCreditStatus } = vi.hoisted(() => ({
  getMillionVerifierCredits: vi.fn(),
  getVerificationCreditStatus: vi.fn(),
}))
const { isXmailConfigured, xmailNotifyVerificationComplete } = vi.hoisted(() => ({
  isXmailConfigured: vi.fn(() => true),
  xmailNotifyVerificationComplete: vi.fn(),
}))
const { captureApiError } = vi.hoisted(() => ({ captureApiError: vi.fn() }))

vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient }))
vi.mock('@/lib/prospects/outreach-eligibility', () => ({
  isDndBlocked: vi.fn(() => false),
  loadEmailSuppressions: vi.fn(async () => new Set<string>()),
  normalizeOutreachEmail: vi.fn((value: string | null) => value?.trim().toLowerCase() ?? null),
}))
vi.mock('@/lib/email-verification/verify', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/email-verification/verify')>()
  return { ...actual, verifyProspectsBatch }
})
vi.mock('@/lib/email-verification/credits', () => ({ getMillionVerifierCredits, getVerificationCreditStatus }))
vi.mock('@/lib/xmail/client', () => ({
  isXmailConfigured,
  xmailNotifyVerificationComplete,
  // Unused by this route but imported transitively by @/lib/mcp/tools/prospects.
  xmailBulkImportLeads: vi.fn(),
  xmailListCampaigns: vi.fn(),
  xmailListEmailAccounts: vi.fn(),
  xmailAddLeadsToCampaign: vi.fn(),
  xmailActivateCampaign: vi.fn(),
}))
vi.mock('@/lib/obs/logger', () => ({
  createLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(), child: vi.fn() }),
}))
vi.mock('@/lib/api-error', () => ({ captureApiError }))

type Filter =
  | { type: 'eq'; col: string; val: unknown }
  | { type: 'is'; col: string; val: unknown }
  | { type: 'not_null'; col: string }
  | { type: 'gte'; col: string; val: unknown }
  | { type: 'in'; col: string; vals: unknown[] }

function matchRow(row: Record<string, unknown>, filters: Filter[]): boolean {
  return filters.every((f) => {
    const v = row[f.col]
    switch (f.type) {
      case 'eq':
        return v === f.val
      case 'is':
        return v === f.val
      case 'not_null':
        return v !== null && v !== undefined
      case 'gte':
        return (v as string) >= (f.val as string)
      case 'in':
        return f.vals.includes(v)
    }
  })
}

/** A chainable Supabase query-builder stub good enough for this route's own
 *  filter/order/limit/count usage — same spirit as mcp-prospects-verify.test.ts's
 *  makeDb, extended with is/not/gte/count-mode since this route uses all of them. */
function makeQuery(
  rows: Array<Record<string, unknown>>,
  onUpdate?: (data: Record<string, unknown>, ids: unknown[]) => void,
) {
  let countMode = false
  let limitN: number | null = null
  let offsetN = 0
  let orderSpec: { col: string; ascending: boolean } | null = null
  let pendingUpdate: Record<string, unknown> | undefined
  const filters: Filter[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: any = {}
  q.select = (_cols: string, opts?: { count?: string; head?: boolean }) => {
    if (opts?.count === 'exact' && opts?.head === true) countMode = true
    return q
  }
  q.eq = (col: string, val: unknown) => {
    filters.push({ type: 'eq', col, val })
    return q
  }
  q.is = (col: string, val: unknown) => {
    filters.push({ type: 'is', col, val })
    return q
  }
  // route.ts only ever calls `.not(col, 'is', null)` — the operator/value are
  // fixed by that call shape, so this fake only needs the column name.
  q.not = (col: string) => {
    filters.push({ type: 'not_null', col })
    return q
  }
  q.gte = (col: string, val: unknown) => {
    filters.push({ type: 'gte', col, val })
    return q
  }
  // .update(data) stages a write; the following .in(col, ids) (Item 1's
  // xmail_imported_at stamp, via pushCappedToXmail) applies it in place to
  // the matching rows and resolves immediately instead of collecting a
  // read-time filter — mirrors makeDb's update/in capture in
  // tests/mcp-prospects-import.test.ts.
  q.update = (data: Record<string, unknown>) => {
    pendingUpdate = data
    return q
  }
  q.in = (col: string, vals: unknown[]) => {
    if (pendingUpdate) {
      const data = pendingUpdate
      pendingUpdate = undefined
      for (const row of rows) {
        if (vals.includes(row.id)) Object.assign(row, data)
      }
      onUpdate?.(data, vals)
      return Promise.resolve({ data: null, error: null })
    }
    filters.push({ type: 'in', col, vals })
    return q
  }
  q.order = (col: string, opts?: { ascending?: boolean }) => {
    orderSpec = { col, ascending: opts?.ascending !== false }
    return q
  }
  q.limit = (n: number) => {
    limitN = n
    return q
  }
  q.range = (from: number, to: number) => {
    offsetN = from
    limitN = to - from + 1
    return q
  }
  q.then = (resolve: (v: unknown) => unknown) => {
    let matched = rows.filter((r) => matchRow(r, filters))
    if (orderSpec) {
      const spec = orderSpec
      matched = [...matched].sort((a, b) => {
        const av = String(a[spec.col] ?? '')
        const bv = String(b[spec.col] ?? '')
        const cmp = av < bv ? -1 : av > bv ? 1 : 0
        return spec.ascending ? cmp : -cmp
      })
    }
    if (countMode) {
      return Promise.resolve({ data: null, error: null, count: matched.length }).then(resolve)
    }
    const sliced = limitN != null ? matched.slice(offsetN, offsetN + limitN) : matched.slice(offsetN)
    return Promise.resolve({ data: sliced, error: null }).then(resolve)
  }
  return q
}

function fakeDb(rowsByTable: Record<string, Array<Record<string, unknown>>>) {
  const updateCalls: Array<{ table: string; data: Record<string, unknown>; ids: unknown[] }> = []
  return {
    from: vi.fn((table: string) =>
      makeQuery(rowsByTable[table] ?? [], (data, ids) => updateCalls.push({ table, data, ids })),
    ),
    updateCalls,
  }
}

function makeRequest(): Request {
  return new Request('http://localhost/api/cron/prospect-verify-tick', {
    headers: { Authorization: 'Bearer test-verify-tick-secret' },
  })
}

async function importRoute(env: Record<string, string> = {}) {
  vi.resetModules()
  process.env.CRON_SECRET = 'test-verify-tick-secret'
  delete process.env.PROSPECTING_AUTO_VERIFY
  delete process.env.PROSPECTING_AUTO_VERIFY_MAX_PER_DAY
  for (const [k, v] of Object.entries(env)) process.env[k] = v
  return import('@/app/api/cron/prospect-verify-tick/route')
}

const okCreditStatus = {
  millionverifier: { configured: true, credits: 500, ok: true },
  neverbounce: { configured: false, credits: null, ok: false },
  anyAvailable: true,
  lowCredit: false,
  lowCreditThreshold: 500,
}

const noCreditStatus = {
  millionverifier: { configured: true, credits: 0, ok: false },
  neverbounce: { configured: false, credits: null, ok: false },
  anyAvailable: false,
  lowCredit: true,
  lowCreditThreshold: 500,
}

describe('GET /api/cron/prospect-verify-tick', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isXmailConfigured.mockReturnValue(true)
  })

  it('fails closed with 503 when CRON_SECRET is unset', async () => {
    vi.resetModules()
    delete process.env.CRON_SECRET
    const { GET } = await import('@/app/api/cron/prospect-verify-tick/route')
    const res = await GET(makeRequest())
    expect(res.status).toBe(503)
  })

  it('rejects a request with the wrong bearer token', async () => {
    const { GET } = await importRoute()
    const res = await GET(new Request('http://localhost/api/cron/prospect-verify-tick', { headers: { Authorization: 'Bearer wrong' } }))
    expect(res.status).toBe(401)
  })

  it('disabled (PROSPECTING_AUTO_VERIFY unset): reports disabled and touches nothing', async () => {
    const { GET } = await importRoute()
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, enabled: false, ran: false })

    expect(createServiceRoleClient).not.toHaveBeenCalled()
    expect(getVerificationCreditStatus).not.toHaveBeenCalled()
    expect(verifyProspectsBatch).not.toHaveBeenCalled()
    expect(xmailNotifyVerificationComplete).not.toHaveBeenCalled()
  })

  it('disabled when PROSPECTING_AUTO_VERIFY is set to something other than "1"', async () => {
    const { GET } = await importRoute({ PROSPECTING_AUTO_VERIFY: 'true' })
    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body.enabled).toBe(false)
    expect(verifyProspectsBatch).not.toHaveBeenCalled()
  })

  it('enabled but daily cap already reached: stops before any provider call', async () => {
    createServiceRoleClient.mockReturnValue(
      fakeDb({
        contacts: [{ id: 'c1', email_verified_at: new Date().toISOString() }],
        accounts: [{ id: 'a1', email_verified_at: new Date().toISOString() }, { id: 'a2', email_verified_at: new Date().toISOString() }],
      }),
    )
    const { GET } = await importRoute({ PROSPECTING_AUTO_VERIFY: '1', PROSPECTING_AUTO_VERIFY_MAX_PER_DAY: '3' })
    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body).toMatchObject({ ok: true, enabled: true, ran: false, stopped_reason: 'daily_cap_reached', max_per_day: 3, verified_today: 3 })
    expect(getVerificationCreditStatus).not.toHaveBeenCalled()
    expect(verifyProspectsBatch).not.toHaveBeenCalled()
  })

  it('enabled but both providers are out of credits: stops loudly before loading any candidate', async () => {
    createServiceRoleClient.mockReturnValue(fakeDb({ contacts: [], accounts: [] }))
    getVerificationCreditStatus.mockResolvedValue(noCreditStatus)

    const { GET } = await importRoute({ PROSPECTING_AUTO_VERIFY: '1' })
    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body).toMatchObject({ ok: true, enabled: true, ran: false, stopped_reason: 'no_credits' })
    expect(body.credit_status).toEqual(noCreditStatus)
    expect(verifyProspectsBatch).not.toHaveBeenCalled()
    expect(captureApiError).toHaveBeenCalled()
  })

  it('verifies a never-checked contact, resolves its run, and notifies Xmail with that external_run_id', async () => {
    createServiceRoleClient.mockReturnValue(
      fakeDb({
        contacts: [
          { id: 'c1', org_id: 'org-1', email: 'alice@example.com', created_at: '2026-09-29T00:00:00.000Z', prospect_source_id: 'src-1', email_status: null, lifecycle_stage: 'prospect' },
        ],
        accounts: [],
        prospect_sources: [{ id: 'src-1', org_id: 'org-1', external_run_id: 'run-42' }],
      }),
    )
    getVerificationCreditStatus.mockResolvedValue(okCreditStatus)
    getMillionVerifierCredits.mockResolvedValueOnce({ configured: true, credits: 500, ok: true }).mockResolvedValueOnce({ configured: true, credits: 499, ok: true })
    verifyProspectsBatch.mockResolvedValue({
      results: [{ kind: 'contact', id: 'c1', email: 'alice@example.com', result: { status: 'ok', risk: 'low', provider: 'millionverifier', verifiedAt: 'x', cached: false }, sendable: true }],
      aggregate: { ok: 1, catch_all: 0, unknown: 0, invalid: 0, disposable: 0, bounced: 0, blocked: 0, platform_email: 0 },
    })
    xmailNotifyVerificationComplete.mockResolvedValue({ ok: true, runId: 'xmail-run-1', eventId: 'e', costEntryId: 'c', idempotentReplay: false })

    const { GET } = await importRoute({ PROSPECTING_AUTO_VERIFY: '1' })
    const res = await GET(makeRequest())
    const body = await res.json()

    expect(verifyProspectsBatch).toHaveBeenCalledWith('org-1', [{ kind: 'contact', id: 'c1', email: 'alice@example.com' }])
    expect(xmailNotifyVerificationComplete).toHaveBeenCalledWith('run-42', {
      provider: 'xcraper',
      checked: 1,
      ok: 1,
      catchAll: 0,
      unknown: 0,
      invalid: 0,
      creditsUsed: 1,
      verificationProvider: 'millionverifier',
      verifiedAt: expect.any(String),
    })

    expect(body).toMatchObject({
      ok: true,
      enabled: true,
      ran: true,
      checked: 1,
    })
    expect(body.runs).toEqual([
      expect.objectContaining({ external_run_id: 'run-42', checked: 1, ok: 1, credits_used: 1, xmail_notified: true }),
    ])
    expect(body.stopped_reason).toBeNull()
  })

  it('Item 1 (2026-09-30): imports the run\'s email_status="ok" prospect into Xmail after verifying/notifying, and stamps xmail_imported_at', async () => {
    // Starts email_status: null so loadCandidates() (which filters on exactly
    // that) picks it up for verification, same as any never-checked prospect.
    const contactFixture = { id: 'c1', org_id: 'org-1', email: 'alice@example.com', created_at: '2026-09-29T00:00:00.000Z', prospect_source_id: 'src-1', email_status: null as string | null, lifecycle_stage: 'prospect', xmail_imported_at: null }
    const db = fakeDb({
      contacts: [contactFixture],
      accounts: [],
      prospect_sources: [{ id: 'src-1', org_id: 'org-1', external_run_id: 'run-42' }],
    })
    createServiceRoleClient.mockReturnValue(db)
    getVerificationCreditStatus.mockResolvedValue(okCreditStatus)
    getMillionVerifierCredits.mockResolvedValueOnce({ configured: true, credits: 500, ok: true }).mockResolvedValueOnce({ configured: true, credits: 499, ok: true })
    // verifyProspectsBatch is mocked (not the real verify engine), so it
    // never touches the DB on its own — this mutates the SAME fixture object
    // the fake DB reads from, standing in for verifyProspectEmail's real
    // persistence, so the import step re-reading contacts afterward sees the
    // 'ok' status exactly like it would against the real engine.
    verifyProspectsBatch.mockImplementation(async () => {
      contactFixture.email_status = 'ok'
      return {
        results: [{ kind: 'contact', id: 'c1', email: 'alice@example.com', result: { status: 'ok', risk: 'low', provider: 'millionverifier', verifiedAt: 'x', cached: false }, sendable: true }],
        aggregate: { ok: 1, catch_all: 0, unknown: 0, invalid: 0, disposable: 0, bounced: 0, blocked: 0, platform_email: 0 },
      }
    })
    xmailNotifyVerificationComplete.mockResolvedValue({ ok: true, runId: 'xmail-run-1', eventId: 'e', costEntryId: 'c', idempotentReplay: false })

    // importRoute() calls vi.resetModules(), which re-evaluates the
    // '@/lib/xmail/client' mock factory and creates a FRESH xmailBulkImportLeads
    // vi.fn() (it isn't one of the vi.hoisted() shared references above) — the
    // reference route.ts's fresh import graph actually uses must be grabbed
    // AFTER importRoute(), never before, or configuring it here is a no-op.
    const { GET } = await importRoute({ PROSPECTING_AUTO_VERIFY: '1' })
    const xmailBulkImportLeadsMock = (await import('@/lib/xmail/client')).xmailBulkImportLeads as ReturnType<typeof vi.fn>
    xmailBulkImportLeadsMock.mockResolvedValue({ ok: true, imported: 1, leadIds: ['lead-1'], skippedPlatformEmails: [], duplicatesInPayload: 0 })

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(xmailBulkImportLeadsMock).toHaveBeenCalledTimes(1)
    const leads = xmailBulkImportLeadsMock.mock.calls[0][0] as Array<{ email: string }>
    expect(leads).toHaveLength(1)
    expect(leads[0].email).toBe('alice@example.com')

    expect(body.runs).toEqual([
      expect.objectContaining({ external_run_id: 'run-42', imported_to_xmail: 1 }),
    ])
    expect(body.imported_to_xmail).toBe(1)
    expect(db.updateCalls).toContainEqual(
      expect.objectContaining({ table: 'contacts', ids: ['c1'] }),
    )
    expect(contactFixture.xmail_imported_at).not.toBeNull()
  })

  it('never calls Xmail bulk-import when nothing in the run is email_status="ok" yet', async () => {
    const db = fakeDb({
      contacts: [
        { id: 'c1', org_id: 'org-1', email: 'alice@example.com', created_at: '2026-09-29T00:00:00.000Z', prospect_source_id: 'src-1', email_status: null, lifecycle_stage: 'prospect' },
      ],
      accounts: [],
      prospect_sources: [{ id: 'src-1', org_id: 'org-1', external_run_id: 'run-42' }],
    })
    createServiceRoleClient.mockReturnValue(db)
    getVerificationCreditStatus.mockResolvedValue(okCreditStatus)
    getMillionVerifierCredits.mockResolvedValueOnce({ configured: true, credits: 500, ok: true }).mockResolvedValueOnce({ configured: true, credits: 499, ok: true })
    // Simulates a catch_all outcome — verified, but deliberately not imported.
    verifyProspectsBatch.mockResolvedValue({
      results: [{ kind: 'contact', id: 'c1', email: 'alice@example.com', result: { status: 'catch_all', risk: 'medium', provider: 'millionverifier', verifiedAt: 'x', cached: false }, sendable: true }],
      aggregate: { ok: 0, catch_all: 1, unknown: 0, invalid: 0, disposable: 0, bounced: 0, blocked: 0, platform_email: 0 },
    })
    xmailNotifyVerificationComplete.mockResolvedValue({ ok: true, runId: 'xmail-run-1', eventId: 'e', costEntryId: 'c', idempotentReplay: false })

    const { GET } = await importRoute({ PROSPECTING_AUTO_VERIFY: '1' })
    const xmailBulkImportLeadsMock = (await import('@/lib/xmail/client')).xmailBulkImportLeads as ReturnType<typeof vi.fn>
    const res = await GET(makeRequest())
    const body = await res.json()

    expect(xmailBulkImportLeadsMock).not.toHaveBeenCalled()
    expect(body.imported_to_xmail).toBe(0)
    expect(body.runs).toEqual([
      expect.objectContaining({ external_run_id: 'run-42', imported_to_xmail: 0 }),
    ])
  })

  it('groups two candidates from two different runs into two separate Xmail notifications', async () => {
    createServiceRoleClient.mockReturnValue(
      fakeDb({
        contacts: [
          { id: 'c1', org_id: 'org-1', email: 'alice@example.com', created_at: '2026-09-28T00:00:00.000Z', prospect_source_id: 'src-1', email_status: null, lifecycle_stage: 'prospect' },
          { id: 'c2', org_id: 'org-1', email: 'bob@example.com', created_at: '2026-09-29T00:00:00.000Z', prospect_source_id: 'src-2', email_status: null, lifecycle_stage: 'prospect' },
        ],
        accounts: [],
        prospect_sources: [
          { id: 'src-1', org_id: 'org-1', external_run_id: 'run-A' },
          { id: 'src-2', org_id: 'org-1', external_run_id: 'run-B' },
        ],
      }),
    )
    getVerificationCreditStatus.mockResolvedValue(okCreditStatus)
    getMillionVerifierCredits.mockResolvedValue({ configured: true, credits: 500, ok: true })
    verifyProspectsBatch.mockImplementation(async (_orgId: string, prospects: Array<{ id: string; email: string }>) => ({
      results: prospects.map((p) => ({ kind: 'contact', id: p.id, email: p.email, result: { status: 'ok', risk: 'low', provider: 'millionverifier', verifiedAt: 'x', cached: false }, sendable: true })),
      aggregate: { ok: prospects.length, catch_all: 0, unknown: 0, invalid: 0, disposable: 0, bounced: 0, blocked: 0, platform_email: 0 },
    }))
    xmailNotifyVerificationComplete.mockResolvedValue({ ok: true, runId: 'r', eventId: 'e', costEntryId: 'c', idempotentReplay: false })

    const { GET } = await importRoute({ PROSPECTING_AUTO_VERIFY: '1' })
    const res = await GET(makeRequest())
    const body = await res.json()

    expect(verifyProspectsBatch).toHaveBeenCalledTimes(2)
    expect(xmailNotifyVerificationComplete).toHaveBeenCalledWith('run-A', expect.objectContaining({ checked: 1 }))
    expect(xmailNotifyVerificationComplete).toHaveBeenCalledWith('run-B', expect.objectContaining({ checked: 1 }))
    expect(body.runs_found).toBe(2)
    expect(body.checked).toBe(2)
  })

  it('skips a candidate whose prospect_sources row has no external_run_id, and never verifies it', async () => {
    createServiceRoleClient.mockReturnValue(
      fakeDb({
        contacts: [
          { id: 'c1', org_id: 'org-1', email: 'alice@example.com', created_at: '2026-09-29T00:00:00.000Z', prospect_source_id: 'src-1', email_status: null, lifecycle_stage: 'prospect' },
        ],
        accounts: [],
        prospect_sources: [{ id: 'src-1', org_id: 'org-1', external_run_id: null }],
      }),
    )
    getVerificationCreditStatus.mockResolvedValue(okCreditStatus)

    const { GET } = await importRoute({ PROSPECTING_AUTO_VERIFY: '1' })
    const res = await GET(makeRequest())
    const body = await res.json()

    expect(verifyProspectsBatch).not.toHaveBeenCalled()
    expect(xmailNotifyVerificationComplete).not.toHaveBeenCalled()
    expect(body.skipped_no_external_run).toBe(1)
    expect(body.checked).toBe(0)
  })

  it('respects the remaining daily budget by only loading the oldest N candidates', async () => {
    createServiceRoleClient.mockReturnValue(
      fakeDb({
        contacts: [
          { id: 'c1', org_id: 'org-1', email: 'a@example.com', created_at: '2026-09-27T00:00:00.000Z', prospect_source_id: 'src-1', email_status: null, lifecycle_stage: 'prospect' },
          { id: 'c2', org_id: 'org-1', email: 'b@example.com', created_at: '2026-09-28T00:00:00.000Z', prospect_source_id: 'src-1', email_status: null, lifecycle_stage: 'prospect' },
          { id: 'c3', org_id: 'org-1', email: 'c@example.com', created_at: '2026-09-29T00:00:00.000Z', prospect_source_id: 'src-1', email_status: null, lifecycle_stage: 'prospect' },
        ],
        accounts: [],
        prospect_sources: [{ id: 'src-1', org_id: 'org-1', external_run_id: 'run-1' }],
      }),
    )
    getVerificationCreditStatus.mockResolvedValue(okCreditStatus)
    getMillionVerifierCredits.mockResolvedValue({ configured: true, credits: 500, ok: true })
    verifyProspectsBatch.mockImplementation(async (_orgId: string, prospects: Array<{ id: string }>) => ({
      results: prospects.map((p) => ({ kind: 'contact', id: p.id, email: 'x', result: { status: 'ok', risk: 'low', provider: 'millionverifier', verifiedAt: 'x', cached: false }, sendable: true })),
      aggregate: { ok: prospects.length, catch_all: 0, unknown: 0, invalid: 0, disposable: 0, bounced: 0, blocked: 0, platform_email: 0 },
    }))
    xmailNotifyVerificationComplete.mockResolvedValue({ ok: true, runId: 'r', eventId: 'e', costEntryId: 'c', idempotentReplay: false })

    // Cap 2, nothing verified yet today -> remaining budget 2, so only c1+c2 (oldest) are processed.
    const { GET } = await importRoute({ PROSPECTING_AUTO_VERIFY: '1', PROSPECTING_AUTO_VERIFY_MAX_PER_DAY: '2' })
    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body.checked).toBe(2)
    expect(verifyProspectsBatch).toHaveBeenCalledWith('org-1', [
      { kind: 'contact', id: 'c1', email: 'a@example.com' },
      { kind: 'contact', id: 'c2', email: 'b@example.com' },
    ])
  })

  it('stops picking up further runs once a batch reports blocked (no credits) results, but still reports the in-flight run', async () => {
    createServiceRoleClient.mockReturnValue(
      fakeDb({
        contacts: [
          { id: 'c1', org_id: 'org-1', email: 'a@example.com', created_at: '2026-09-28T00:00:00.000Z', prospect_source_id: 'src-1', email_status: null, lifecycle_stage: 'prospect' },
          { id: 'c2', org_id: 'org-1', email: 'b@example.com', created_at: '2026-09-29T00:00:00.000Z', prospect_source_id: 'src-2', email_status: null, lifecycle_stage: 'prospect' },
        ],
        accounts: [],
        prospect_sources: [
          { id: 'src-1', org_id: 'org-1', external_run_id: 'run-A' },
          { id: 'src-2', org_id: 'org-1', external_run_id: 'run-B' },
        ],
      }),
    )
    getVerificationCreditStatus.mockResolvedValue(okCreditStatus)
    getMillionVerifierCredits.mockResolvedValue({ configured: true, credits: 5, ok: true })
    verifyProspectsBatch.mockResolvedValueOnce({
      results: [{ kind: 'contact', id: 'c1', email: 'a@example.com', result: { blocked: true, reason: 'no_verification_credits' }, sendable: false }],
      aggregate: { ok: 0, catch_all: 0, unknown: 0, invalid: 0, disposable: 0, bounced: 0, blocked: 1, platform_email: 0 },
    })
    xmailNotifyVerificationComplete.mockResolvedValue({ ok: true, runId: 'r', eventId: 'e', costEntryId: 'c', idempotentReplay: false })

    const { GET } = await importRoute({ PROSPECTING_AUTO_VERIFY: '1' })
    const res = await GET(makeRequest())
    const body = await res.json()

    expect(verifyProspectsBatch).toHaveBeenCalledTimes(1) // run-B never attempted
    expect(body.stopped_reason).toBe('no_credits')
    expect(body.runs).toHaveLength(1)
    expect(body.runs[0]).toMatchObject({ external_run_id: 'run-A', blocked_no_credits: 1 })
    expect(captureApiError).toHaveBeenCalled()
  })

  it('reports xmail_notified:false without failing verification when Xmail is not configured', async () => {
    isXmailConfigured.mockReturnValue(false)
    createServiceRoleClient.mockReturnValue(
      fakeDb({
        contacts: [
          { id: 'c1', org_id: 'org-1', email: 'a@example.com', created_at: '2026-09-29T00:00:00.000Z', prospect_source_id: 'src-1', email_status: null, lifecycle_stage: 'prospect' },
        ],
        accounts: [],
        prospect_sources: [{ id: 'src-1', org_id: 'org-1', external_run_id: 'run-1' }],
      }),
    )
    getVerificationCreditStatus.mockResolvedValue(okCreditStatus)
    getMillionVerifierCredits.mockResolvedValue({ configured: true, credits: 500, ok: true })
    verifyProspectsBatch.mockResolvedValue({
      results: [{ kind: 'contact', id: 'c1', email: 'a@example.com', result: { status: 'ok', risk: 'low', provider: 'millionverifier', verifiedAt: 'x', cached: false }, sendable: true }],
      aggregate: { ok: 1, catch_all: 0, unknown: 0, invalid: 0, disposable: 0, bounced: 0, blocked: 0, platform_email: 0 },
    })

    const { GET } = await importRoute({ PROSPECTING_AUTO_VERIFY: '1' })
    const res = await GET(makeRequest())
    const body = await res.json()

    expect(xmailNotifyVerificationComplete).not.toHaveBeenCalled()
    expect(body.runs[0]).toMatchObject({ xmail_notified: false })
    expect(body.checked).toBe(1) // still verified & persisted locally even though Xmail wasn't notified
  })
})
