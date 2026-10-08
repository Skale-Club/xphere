// 2026-10-07: a booking-platform address (help.us@booksy.com...) must be visible in prospects_list,
// never enrolled by prospects_enroll_in_campaign, and counted (not hidden in `invalid`) by
// prospects_verify. The import hold-back lives in mcp-prospects-import-platform-email.test.ts and
// the engine-level skip in email-verification-platform-rule.test.ts.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createServiceRoleClient } = vi.hoisted(() => ({ createServiceRoleClient: vi.fn() }))
const { isXmailConfigured, xmailBulkImportLeads, xmailListCampaigns, xmailListEmailAccounts, xmailAddLeadsToCampaign, xmailNotifyVerificationComplete } =
  vi.hoisted(() => ({
    isXmailConfigured: vi.fn(() => true),
    xmailBulkImportLeads: vi.fn(),
    xmailListCampaigns: vi.fn(),
    xmailListEmailAccounts: vi.fn(),
    xmailAddLeadsToCampaign: vi.fn(),
    xmailNotifyVerificationComplete: vi.fn(),
  }))
const { getMillionVerifierCredits } = vi.hoisted(() => ({ getMillionVerifierCredits: vi.fn() }))

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
vi.mock('@/lib/email-verification/credits', () => ({ getMillionVerifierCredits }))
vi.mock('@/lib/xmail/website-insights', () => ({ loadWebsiteInsightsForAccounts: vi.fn(async () => new Map()) }))
vi.mock('@/lib/xmail/source-runs', () => ({ loadSourceRunIdsForEntities: vi.fn(async () => new Map()) }))
vi.mock('@/lib/xmail/client', () => ({
  isXmailConfigured,
  xmailBulkImportLeads,
  xmailListCampaigns,
  xmailListEmailAccounts,
  xmailAddLeadsToCampaign,
  xmailNotifyVerificationComplete,
}))

import { prospectsTools } from '@/lib/mcp/tools/prospects'
import { verifyProspectsBatch } from '@/lib/email-verification/verify'
import { isPlatformEmail } from '@/lib/prospects/platform-emails'

const tool = (name: string) => prospectsTools.find((candidate) => candidate.name === name)!
const ctx = { auth: { orgId: 'org-1' } } as never
const CAMPAIGN_ID = '11111111-1111-1111-1111-111111111111'

function makeDb(rowsByTable: Record<string, Array<Record<string, unknown>>>) {
  function makeQuery(table: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = {}
    const chain = () => q
    for (const m of ['select', 'eq', 'gte', 'lte', 'not', 'contains', 'ilike', 'limit', 'order', 'range', 'in', 'update']) q[m] = vi.fn(chain)
    q.insert = vi.fn(() => Promise.resolve({ data: null, error: null }))
    q.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: rowsByTable[table] ?? [], error: null }).then(resolve)
    return q
  }
  return { from: vi.fn((table: string) => makeQuery(table)) }
}

function account(id: string, email: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Shop ${id}`,
    domain: null,
    website: null,
    phone: null,
    address: null,
    score: 50,
    source_type: 'xcraper',
    engagement_status: 'not_contacted',
    custom_fields: { email },
    email_status: 'ok',
    email_verified_at: '2026-09-01T00:00:00.000Z',
    email_verification_provider: 'millionverifier',
    email_risk: 'low',
    xmail_imported_at: '2026-09-02T00:00:00.000Z',
    ...overrides,
  }
}

/** Behaves like the real engine for the part under test: platform -> not sendable, rest -> ok. */
function realisticBatch() {
  ;(verifyProspectsBatch as ReturnType<typeof vi.fn>).mockImplementation(
    async (_orgId: string, prospects: Array<{ kind: string; id: string; email: string }>) => {
      const results = prospects.map((p) => {
        const platform = isPlatformEmail(p.email)
        return {
          ...p,
          result: platform
            ? { status: 'invalid', risk: 'high', provider: 'platform_rule', verifiedAt: 'x', cached: false }
            : { status: 'ok', risk: 'low', provider: 'millionverifier', verifiedAt: 'x', cached: true },
          sendable: !platform,
        }
      })
      const platformCount = results.filter((r) => isPlatformEmail(r.email)).length
      return {
        results,
        aggregate: { ok: results.length - platformCount, catch_all: 0, unknown: 0, invalid: 0, disposable: 0, bounced: 0, blocked: 0, platform_email: platformCount },
      }
    },
  )
}

describe('platform_email across the prospects tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isXmailConfigured.mockReturnValue(true)
    xmailListCampaigns.mockResolvedValue({ ok: true, campaigns: [{ id: CAMPAIGN_ID, name: 'Pilot', status: 'draft' }] })
    realisticBatch()
  })

  it('prospects_list counts platform_email and flags each row', async () => {
    createServiceRoleClient.mockReturnValue(
      makeDb({
        contacts: [],
        accounts: [account('a-booksy', 'help.us@booksy.com'), account('a-own', 'owner@independentshop.example')],
      }),
    )
    const result = (await tool('prospects_list').handler(tool('prospects_list').inputSchema.parse({}), ctx)) as Record<string, unknown>

    expect(result.with_email).toBe(2)
    expect(result.platform_email).toBe(1)
    const rows = result.prospects as Array<{ id: string; platform_email: boolean }>
    expect(Object.fromEntries(rows.map((r) => [r.id, r.platform_email]))).toEqual({ 'a-booksy': true, 'a-own': false })
  })

  it('prospects_enroll_in_campaign dry run reports platform_email and does not count it as enrollable or as waiting for import', async () => {
    createServiceRoleClient.mockReturnValue(
      makeDb({ contacts: [], accounts: [account('a-booksy', 'help.us@booksy.com'), account('a-own', 'owner@independentshop.example')] }),
    )
    const input = tool('prospects_enroll_in_campaign').inputSchema.parse({ campaign_id: CAMPAIGN_ID })
    const result = (await tool('prospects_enroll_in_campaign').handler(input, ctx)) as Record<string, unknown>

    expect(result.would_enroll).toBe(1)
    expect(result.platform_email).toBe(1)
    expect(result.not_yet_imported).toBe(0)
    expect((result.verification as Record<string, number>).blocked_platform_email).toBe(1)
    expect(result.message).toMatch(/platform_email/)
  })

  it('prospects_enroll_in_campaign confirmed never verifies or sends a platform address, even one already staged', async () => {
    createServiceRoleClient.mockReturnValue(
      makeDb({ contacts: [], accounts: [account('a-booksy', 'help.us@booksy.com'), account('a-own', 'owner@independentshop.example')] }),
    )
    xmailListEmailAccounts.mockResolvedValue({ ok: true, accounts: [{ id: '22222222-2222-2222-2222-222222222222', email: 's@x.example', campaignSenderEligible: true }] })
    xmailBulkImportLeads.mockResolvedValue({ ok: true, imported: 1, leadIds: ['lead-own'], skippedPlatformEmails: [], duplicatesInPayload: 0 })
    xmailAddLeadsToCampaign.mockResolvedValue({ ok: true, added: 1 })

    const input = tool('prospects_enroll_in_campaign').inputSchema.parse({ campaign_id: CAMPAIGN_ID, confirmed: true })
    const result = (await tool('prospects_enroll_in_campaign').handler(input, ctx)) as Record<string, unknown>

    const verified = (verifyProspectsBatch as ReturnType<typeof vi.fn>).mock.calls[0][1] as Array<{ email: string }>
    expect(verified.map((p) => p.email)).toEqual(['owner@independentshop.example'])
    const sent = (xmailBulkImportLeads.mock.calls[0][0] as Array<{ email: string }>).map((lead) => lead.email)
    expect(sent).toEqual(['owner@independentshop.example'])
    expect(result.enrolled).toBe(1)
    expect(result.platform_email).toBe(1)
    expect(result).toMatchObject({ campaign_activated: false, activation_required: true })
  })

  it('prospects_verify reports platform_email apart from invalid, labels the row, and notifies Xmail with a consistent invalid total', async () => {
    createServiceRoleClient.mockReturnValue(
      makeDb({
        prospect_sources: [{ id: 'src-1' }],
        contacts: [],
        accounts: [
          { id: 'a-booksy', custom_fields: { email: 'help.us@booksy.com' }, created_at: '2026-01-01T00:00:00.000Z' },
          { id: 'a-own', custom_fields: { email: 'owner@independentshop.example' }, created_at: '2026-01-02T00:00:00.000Z' },
        ],
      }),
    )
    getMillionVerifierCredits.mockResolvedValue({ configured: true, credits: 100, ok: true })
    xmailNotifyVerificationComplete.mockResolvedValue({ ok: true, runId: 'r', eventId: 'e', costEntryId: 'c', idempotentReplay: false })

    const input = tool('prospects_verify').inputSchema.parse({ external_run_id: 'run-42' })
    const result = (await tool('prospects_verify').handler(input, ctx)) as Record<string, unknown>

    expect(result).toMatchObject({ checked: 2, ok: 1, invalid: 0, platform_email: 1, verification_provider: 'millionverifier' })
    const rows = result.results as Array<{ prospect_id: string; status: string }>
    expect(Object.fromEntries(rows.map((r) => [r.prospect_id, r.status]))).toEqual({ 'a-booksy': 'platform_email', 'a-own': 'ok' })
    // Xmail validates checked == ok + catchAll + unknown + invalid
    expect(xmailNotifyVerificationComplete).toHaveBeenCalledWith('run-42', expect.objectContaining({ checked: 2, ok: 1, invalid: 1 }))
  })
})
