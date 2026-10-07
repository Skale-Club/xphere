// tests/mcp-prospects-import-platform-email.test.ts
//
// Item 4 (2026-09-30): prospects_import_to_xmail used to stamp
// xmail_imported_at on EVERY submitted prospect, including ones Xmail
// itself rejected as a platform email (Xmail's bulk-import response reports
// this back as `skippedPlatformEmails`, alongside `duplicatesInPayload` —
// see src/server/routes/outreach/leads.ts in the xmail repo). Only the ones
// Xmail actually accepted or already had should get the stamp; the rejected
// ones must stay retained/reportable (`platform_email`), never counted as
// imported and never marked imported.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createServiceRoleClient } = vi.hoisted(() => ({ createServiceRoleClient: vi.fn() }))
const { isXmailConfigured, xmailBulkImportLeads } = vi.hoisted(() => ({
  isXmailConfigured: vi.fn(() => true),
  xmailBulkImportLeads: vi.fn(),
}))
const { loadWebsiteInsightsForAccounts } = vi.hoisted(() => ({
  loadWebsiteInsightsForAccounts: vi.fn(async () => new Map()),
}))
const { loadSourceRunIdsForEntities } = vi.hoisted(() => ({
  loadSourceRunIdsForEntities: vi.fn(async () => new Map()),
}))

vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient }))
vi.mock('@/lib/prospects/outreach-eligibility', () => ({
  isDndBlocked: vi.fn(() => false),
  loadEmailSuppressions: vi.fn(async () => new Set<string>()),
  normalizeOutreachEmail: vi.fn((value: string | null) => value?.trim().toLowerCase() ?? null),
}))
vi.mock('@/lib/email-verification/verify', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/email-verification/verify')>()
  return { ...actual, verifyProspectsBatch: vi.fn() }
})
vi.mock('@/lib/xmail/website-insights', () => ({ loadWebsiteInsightsForAccounts }))
vi.mock('@/lib/xmail/source-runs', () => ({ loadSourceRunIdsForEntities }))
vi.mock('@/lib/xmail/client', () => ({
  isXmailConfigured,
  xmailBulkImportLeads,
  xmailListCampaigns: vi.fn(),
  xmailListEmailAccounts: vi.fn(),
  xmailAddLeadsToCampaign: vi.fn(),
  xmailActivateCampaign: vi.fn(),
  xmailNotifyVerificationComplete: vi.fn(),
}))

import { prospectsTools } from '@/lib/mcp/tools/prospects'

function tool() {
  return prospectsTools.find((candidate) => candidate.name === 'prospects_import_to_xmail')!
}

/** Same chainable Supabase stub as tests/mcp-prospects-import.test.ts. */
function makeDb(rowsByTable: Record<string, Array<Record<string, unknown>>>) {
  const updateCalls: Array<{ table: string; data: Record<string, unknown>; ids: unknown[] }> = []
  function makeQuery(table: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = {}
    const chain = () => q
    let pendingUpdate: Record<string, unknown> | undefined
    q.select = vi.fn(chain)
    q.eq = vi.fn(chain)
    q.gte = vi.fn(chain)
    q.lte = vi.fn(chain)
    q.not = vi.fn(chain)
    q.contains = vi.fn(chain)
    q.ilike = vi.fn(chain)
    q.limit = vi.fn(chain)
    q.order = vi.fn(chain)
    q.update = vi.fn((data: Record<string, unknown>) => {
      pendingUpdate = data
      return q
    })
    q.in = vi.fn((_col: string, ids: unknown[]) => {
      if (pendingUpdate) {
        updateCalls.push({ table, data: pendingUpdate, ids })
        pendingUpdate = undefined
        return Promise.resolve({ data: null, error: null })
      }
      return chain()
    })
    q.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: rowsByTable[table] ?? [], error: null }).then(resolve)
    return q
  }
  return { from: vi.fn((table: string) => makeQuery(table)), updateCalls }
}

function contact(overrides: Partial<Record<string, unknown>>) {
  return {
    id: 'c-default',
    first_name: 'Ada',
    last_name: 'Lovelace',
    name: null,
    email: 'ada@example.com',
    phone: null,
    custom_fields: {},
    score: 50,
    source_type: 'xcraper',
    engagement_status: 'not_contacted',
    dnd_enabled: false,
    dnd_channels: [],
    email_status: 'ok',
    email_verified_at: '2026-09-01T00:00:00.000Z',
    email_verification_provider: 'millionverifier',
    email_risk: 'low',
    xmail_imported_at: null,
    ...overrides,
  }
}

// Since 2026-10-07 Xphere holds known platform domains (booksy.com...) back BEFORE calling Xmail (see
// the describe block at the bottom). These Item 4 tests cover the fallback that remains: an address
// Xphere's own list does not know yet but Xmail rejects as a platform email, so the domain used here
// is deliberately one that is NOT in PLATFORM_EMAIL_DOMAINS.
describe('prospects_import_to_xmail — platform-email accounting (Item 4)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isXmailConfigured.mockReturnValue(true)
  })

  it('does not stamp xmail_imported_at on a prospect Xmail rejected as a platform email, and reports it retained', async () => {
    const db = makeDb({
      prospect_sources: [{ id: 'src-1' }],
      contacts: [
        contact({ id: 'c-accepted', email: 'owner@independentshop.example' }),
        contact({ id: 'c-platform', email: 'support@newplatform.example' }),
      ],
      accounts: [],
    })
    createServiceRoleClient.mockReturnValue(db)
    // Mirrors xmail's real /bulk-import response shape: one accepted, one
    // dropped as a platform email — imported counts only the accepted one.
    xmailBulkImportLeads.mockResolvedValue({
      ok: true,
      imported: 1,
      leadIds: ['lead-accepted'],
      skippedPlatformEmails: ['support@newplatform.example'],
      duplicatesInPayload: 0,
    })

    const input = tool().inputSchema.parse({ external_run_id: 'run-1', confirmed: true })
    const result = (await tool().handler(input, { auth: { orgId: 'org-1' } } as never)) as Record<string, unknown>

    expect(result.imported).toBe(1)
    expect(result.retained_platform_email).toBe(1)

    // Only the accepted prospect gets stamped — the platform-email one must
    // never appear in an xmail_imported_at update call.
    expect(db.updateCalls).toHaveLength(1)
    expect(db.updateCalls[0].table).toBe('contacts')
    expect(db.updateCalls[0].ids).toEqual(['c-accepted'])
  })

  it('stamps nobody and reports every submitted prospect retained when Xmail rejects all of them as platform emails', async () => {
    const db = makeDb({
      prospect_sources: [{ id: 'src-1' }],
      contacts: [contact({ id: 'c-platform', email: 'support@newplatform.example' })],
      accounts: [],
    })
    createServiceRoleClient.mockReturnValue(db)
    xmailBulkImportLeads.mockResolvedValue({
      ok: true,
      imported: 0,
      leadIds: [],
      skippedPlatformEmails: ['support@newplatform.example'],
      duplicatesInPayload: 0,
    })

    const input = tool().inputSchema.parse({ external_run_id: 'run-1', confirmed: true })
    const result = (await tool().handler(input, { auth: { orgId: 'org-1' } } as never)) as Record<string, unknown>

    expect(result.imported).toBe(0)
    expect(result.retained_platform_email).toBe(1)
    expect(db.updateCalls).toHaveLength(0)
    expect(result.message).toMatch(/retained as platform_email/i)
  })

  it('does not report retained_platform_email at all when nothing was skipped', async () => {
    const db = makeDb({
      prospect_sources: [{ id: 'src-1' }],
      contacts: [contact({ id: 'c-accepted', email: 'owner@independentshop.example' })],
      accounts: [],
    })
    createServiceRoleClient.mockReturnValue(db)
    xmailBulkImportLeads.mockResolvedValue({
      ok: true,
      imported: 1,
      leadIds: ['lead-accepted'],
      skippedPlatformEmails: [],
      duplicatesInPayload: 0,
    })

    const input = tool().inputSchema.parse({ external_run_id: 'run-1', confirmed: true })
    const result = (await tool().handler(input, { auth: { orgId: 'org-1' } } as never)) as Record<string, unknown>

    expect(result.retained_platform_email).toBeUndefined()
    expect(db.updateCalls[0].ids).toEqual(['c-accepted'])
  })
})

describe('prospects_import_to_xmail — platform_email hold-back (2026-10-07)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isXmailConfigured.mockReturnValue(true)
  })

  it('holds a known platform address back first, even when it is already email_status ok, and never sends it to Xmail', async () => {
    const db = makeDb({
      prospect_sources: [{ id: 'src-1' }],
      contacts: [
        contact({ id: 'c-ok', email: 'owner@independentshop.example' }),
        // verified 'ok' (credits were spent) and a subdomain of a platform: still held back
        contact({ id: 'c-booksy', email: 'Help.Us@Booksy.com', email_status: 'ok' }),
        contact({ id: 'c-subdomain', email: 'noreply@mail.vagaro.com', email_status: 'ok' }),
        // lookalike domain is NOT a platform
        contact({ id: 'c-lookalike', email: 'hello@notbooksy.com', email_status: 'ok' }),
      ],
      accounts: [],
    })
    createServiceRoleClient.mockReturnValue(db)
    xmailBulkImportLeads.mockResolvedValue({ ok: true, imported: 2, leadIds: ['a', 'b'], skippedPlatformEmails: [], duplicatesInPayload: 0 })

    const input = tool().inputSchema.parse({ external_run_id: 'run-1', confirmed: true })
    const result = (await tool().handler(input, { auth: { orgId: 'org-1' } } as never)) as Record<string, unknown>

    const submitted = (xmailBulkImportLeads.mock.calls[0][0] as Array<{ email: string }>).map((lead) => lead.email)
    expect(submitted).toEqual(['owner@independentshop.example', 'hello@notbooksy.com'])
    expect(result.imported).toBe(2)

    const held = (result.held_back as Record<string, number>)
    expect(held.platform_email).toBe(2)
    expect(held.shared_email).toBe(0)
    expect(held.franchise).toBe(0)
    const retained = result.retained_for_review as Array<{ email: string; reason: string }>
    expect(retained.map((r) => r.reason)).toEqual(['platform_email', 'platform_email'])
    expect(result.message).toMatch(/2 platform_email/)

    // only the two accepted rows are stamped; the platform rows never get xmail_imported_at
    expect(db.updateCalls).toHaveLength(1)
    expect(db.updateCalls[0].ids).toEqual(['c-ok', 'c-lookalike'])
  })

  it('reports platform_email in the dry run and imports nothing', async () => {
    const db = makeDb({
      prospect_sources: [{ id: 'src-1' }],
      contacts: [contact({ id: 'c-booksy', email: 'help.us@booksy.com', email_status: 'ok' })],
      accounts: [],
    })
    createServiceRoleClient.mockReturnValue(db)

    const input = tool().inputSchema.parse({ external_run_id: 'run-1' })
    const result = (await tool().handler(input, { auth: { orgId: 'org-1' } } as never)) as Record<string, unknown>

    expect(result.would_import).toBe(0)
    expect((result.held_back as Record<string, number>).platform_email).toBe(1)
    expect(xmailBulkImportLeads).not.toHaveBeenCalled()
    expect(db.updateCalls).toHaveLength(0)
  })
})
