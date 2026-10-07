// tests/mcp-prospects-enroll-inbox.test.ts
//
// Item 2 (2026-09-30): when prospects_enroll_in_campaign is called without
// email_account_id, it used to pick "the first available inbox" from
// xmailListEmailAccounts() with no regard for whether that inbox is allowed
// to send a campaign — e.g. picking a work inbox like info@ that Xmail
// itself refuses with 422. Xmail now reports a `campaignSenderEligible`
// boolean per account; this file covers the Xphere-side consumption of it:
//   - email_account_id omitted: only choose among campaignSenderEligible===true
//     accounts; never guess when the field is entirely absent (older Xmail)
//     or when nothing is eligible — fail with a clear, actionable error instead.
//   - email_account_id given explicitly: refuse BEFORE calling Xmail if that
//     account is reported campaignSenderEligible===false.
//
// Does not re-test confirmed:true's does-not-activate-campaign-governance
// behavior (out of scope for this item) — only the inbox-selection gate.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createServiceRoleClient } = vi.hoisted(() => ({ createServiceRoleClient: vi.fn() }))
const {
  isXmailConfigured,
  xmailBulkImportLeads,
  xmailListEmailAccounts,
  xmailAddLeadsToCampaign,
  xmailActivateCampaign,
} = vi.hoisted(() => ({
  isXmailConfigured: vi.fn(() => true),
  xmailBulkImportLeads: vi.fn(),
  xmailListEmailAccounts: vi.fn(),
  xmailAddLeadsToCampaign: vi.fn(),
  xmailActivateCampaign: vi.fn(),
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
  xmailListEmailAccounts,
  xmailAddLeadsToCampaign,
  xmailActivateCampaign,
  xmailNotifyVerificationComplete: vi.fn(),
}))

import { prospectsTools } from '@/lib/mcp/tools/prospects'
import { verifyProspectsBatch } from '@/lib/email-verification/verify'

function tool() {
  return prospectsTools.find((candidate) => candidate.name === 'prospects_enroll_in_campaign')!
}

/** Same chainable Supabase stub as tests/mcp-prospects-import.test.ts. */
function makeDb(rowsByTable: Record<string, Array<Record<string, unknown>>>) {
  function makeQuery(table: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = {}
    const chain = () => q
    q.select = vi.fn(chain)
    q.eq = vi.fn(chain)
    q.gte = vi.fn(chain)
    q.lte = vi.fn(chain)
    q.not = vi.fn(chain)
    q.contains = vi.fn(chain)
    q.ilike = vi.fn(chain)
    q.limit = vi.fn(chain)
    q.order = vi.fn(chain)
    q.in = vi.fn(chain)
    q.update = vi.fn(chain)
    q.insert = vi.fn(() => Promise.resolve({ data: null, error: null }))
    q.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: rowsByTable[table] ?? [], error: null }).then(resolve)
    return q
  }
  return { from: vi.fn((table: string) => makeQuery(table)) }
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
    xmail_imported_at: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

const CAMPAIGN_ID = '11111111-1111-1111-1111-111111111111'

describe('prospects_enroll_in_campaign — campaignSenderEligible inbox gate (Item 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isXmailConfigured.mockReturnValue(true)
    ;(verifyProspectsBatch as ReturnType<typeof vi.fn>).mockResolvedValue({
      results: [{ kind: 'contact', id: 'c-ok', email: 'ada@example.com', result: { status: 'ok', risk: 'low', provider: 'millionverifier', verifiedAt: 'x', cached: true }, sendable: true }],
      aggregate: { ok: 1, catch_all: 0, unknown: 0, invalid: 0, disposable: 0, bounced: 0, blocked: 0, platform_email: 0 },
    })
    xmailBulkImportLeads.mockResolvedValue({ ok: true, imported: 1, leadIds: ['lead-1'], skippedPlatformEmails: [], duplicatesInPayload: 0 })
    xmailAddLeadsToCampaign.mockResolvedValue({ ok: true, added: 1 })
    // Deliberately not ok — keeps markEnrolled's DB insert out of scope for
    // these tests, which only care about which emailAccountId was chosen.
    xmailActivateCampaign.mockResolvedValue({ ok: false, error: 'sequence missing' })
  })

  it('email_account_id omitted + no account reports campaignSenderEligible (older Xmail): fails instead of guessing', async () => {
    createServiceRoleClient.mockReturnValue(makeDb({ contacts: [contact({ id: 'c-ok' })], accounts: [] }))
    xmailListEmailAccounts.mockResolvedValue({
      ok: true,
      accounts: [{ id: '22222222-2222-2222-2222-222222222222', email: 'info@example.com', displayName: null }],
    })

    const input = tool().inputSchema.parse({ campaign_id: CAMPAIGN_ID, confirmed: true })
    const result = (await tool().handler(input, { auth: { orgId: 'org-1' } } as never)) as Record<string, unknown>

    expect(result.error).toBe('no_eligible_sending_inbox')
    expect(xmailAddLeadsToCampaign).not.toHaveBeenCalled()
    expect(xmailBulkImportLeads).not.toHaveBeenCalled()
  })

  it('email_account_id omitted + every account is campaignSenderEligible:false: fails and lists the accounts', async () => {
    createServiceRoleClient.mockReturnValue(makeDb({ contacts: [contact({ id: 'c-ok' })], accounts: [] }))
    xmailListEmailAccounts.mockResolvedValue({
      ok: true,
      accounts: [
        { id: '22222222-2222-2222-2222-222222222222', email: 'info@example.com', displayName: null, campaignSenderEligible: false },
      ],
    })

    const input = tool().inputSchema.parse({ campaign_id: CAMPAIGN_ID, confirmed: true })
    const result = (await tool().handler(input, { auth: { orgId: 'org-1' } } as never)) as Record<string, unknown>

    expect(result.error).toBe('no_eligible_sending_inbox')
    expect(result.email_accounts).toEqual([
      { id: '22222222-2222-2222-2222-222222222222', email: 'info@example.com', campaignSenderEligible: false },
    ])
    expect(xmailAddLeadsToCampaign).not.toHaveBeenCalled()
  })

  it('email_account_id omitted + one eligible account among several: picks only the eligible one', async () => {
    createServiceRoleClient.mockReturnValue(makeDb({ contacts: [contact({ id: 'c-ok' })], accounts: [] }))
    xmailListEmailAccounts.mockResolvedValue({
      ok: true,
      accounts: [
        { id: '22222222-2222-2222-2222-222222222222', email: 'info@example.com', displayName: null, campaignSenderEligible: false },
        { id: '33333333-3333-3333-3333-333333333333', email: 'outreach@example.com', displayName: null, campaignSenderEligible: true },
      ],
    })

    const input = tool().inputSchema.parse({ campaign_id: CAMPAIGN_ID, confirmed: true })
    const result = (await tool().handler(input, { auth: { orgId: 'org-1' } } as never)) as Record<string, unknown>

    expect(result.error).toBeUndefined()
    expect(xmailAddLeadsToCampaign).toHaveBeenCalledWith(CAMPAIGN_ID, ['lead-1'], '33333333-3333-3333-3333-333333333333')
  })

  it('email_account_id given explicitly and Xmail reports it campaignSenderEligible:false: refuses before calling Xmail', async () => {
    createServiceRoleClient.mockReturnValue(makeDb({ contacts: [contact({ id: 'c-ok' })], accounts: [] }))
    xmailListEmailAccounts.mockResolvedValue({
      ok: true,
      accounts: [{ id: '22222222-2222-2222-2222-222222222222', email: 'info@example.com', displayName: null, campaignSenderEligible: false }],
    })

    const input = tool().inputSchema.parse({ campaign_id: CAMPAIGN_ID, email_account_id: '22222222-2222-2222-2222-222222222222', confirmed: true })
    const result = (await tool().handler(input, { auth: { orgId: 'org-1' } } as never)) as Record<string, unknown>

    expect(result.error).toBe('email_account_not_campaign_eligible')
    expect(xmailBulkImportLeads).not.toHaveBeenCalled()
    expect(xmailAddLeadsToCampaign).not.toHaveBeenCalled()
  })

  it('email_account_id given explicitly and eligible: proceeds and uses it', async () => {
    createServiceRoleClient.mockReturnValue(makeDb({ contacts: [contact({ id: 'c-ok' })], accounts: [] }))
    xmailListEmailAccounts.mockResolvedValue({
      ok: true,
      accounts: [{ id: '33333333-3333-3333-3333-333333333333', email: 'outreach@example.com', displayName: null, campaignSenderEligible: true }],
    })

    const input = tool().inputSchema.parse({ campaign_id: CAMPAIGN_ID, email_account_id: '33333333-3333-3333-3333-333333333333', confirmed: true })
    const result = (await tool().handler(input, { auth: { orgId: 'org-1' } } as never)) as Record<string, unknown>

    expect(result.error).toBeUndefined()
    expect(xmailAddLeadsToCampaign).toHaveBeenCalledWith(CAMPAIGN_ID, ['lead-1'], '33333333-3333-3333-3333-333333333333')
  })

  it('email_account_id given explicitly and the field is absent (older Xmail): proceeds without guessing eligibility either way', async () => {
    createServiceRoleClient.mockReturnValue(makeDb({ contacts: [contact({ id: 'c-ok' })], accounts: [] }))
    xmailListEmailAccounts.mockResolvedValue({
      ok: true,
      accounts: [{ id: '44444444-4444-4444-4444-444444444444', email: 'legacy@example.com', displayName: null }],
    })

    const input = tool().inputSchema.parse({ campaign_id: CAMPAIGN_ID, email_account_id: '44444444-4444-4444-4444-444444444444', confirmed: true })
    const result = (await tool().handler(input, { auth: { orgId: 'org-1' } } as never)) as Record<string, unknown>

    expect(result.error).toBeUndefined()
    expect(xmailAddLeadsToCampaign).toHaveBeenCalledWith(CAMPAIGN_ID, ['lead-1'], '44444444-4444-4444-4444-444444444444')
  })
})
