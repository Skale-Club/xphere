// tests/mcp-prospects-import-shared-franchise.test.ts
//
// Item 3 (2026-09-30): prospects_import_to_xmail retains two extra
// categories for a human decision, reported (never silently dropped) the
// same way catch_all/unknown already are:
//   (a) shared_email — an address recorded on 3+ DISTINCT businesses.
//       Measured: help.us@booksy.com on 11 different scraped barbershops. Since
//       2026-10-07 a known platform domain is held back earlier, as platform_email
//       (see mcp-prospects-import-platform-email.test.ts), so this file exercises the
//       heuristic with a NON-platform shared address, which is what shared_email is
//       still for (e.g. a management company's front desk).
//   (b) franchise — a recognized national barbershop/salon chain location.
//       Measured: contact.us@sportclips.com (Sport Clips' corporate support
//       address) on a scraped location.
//
// Also covers the negative case that motivates the >=3 threshold: two
// listings of the SAME business under slightly different names — "ATM
// (Roslindale Barbershop)" and "Roslindale Barbershop" — sharing
// roslindalebarbershop@live.com must collapse to ONE business and import
// normally, not trip shared_email at a lower threshold.

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

/** Same chainable Supabase stub as tests/mcp-prospects-import.test.ts — every
 *  filter is a no-op, so it also stands in for detectSharedEmailCounts' own
 *  unfiltered scan of every company prospect in the org. */
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
    q.range = vi.fn(chain)
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

function account(overrides: Partial<Record<string, unknown>>) {
  return {
    id: 'acc-default',
    name: 'Some Shop',
    domain: null,
    website: null,
    phone: null,
    address: null,
    score: 50,
    source_type: 'xcraper',
    engagement_status: 'not_contacted',
    custom_fields: {},
    email_status: 'ok',
    email_verified_at: '2026-09-01T00:00:00.000Z',
    email_verification_provider: 'millionverifier',
    email_risk: 'low',
    xmail_imported_at: null,
    ...overrides,
  }
}

describe('prospects_import_to_xmail — shared_email + franchise retention (Item 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isXmailConfigured.mockReturnValue(true)
    xmailBulkImportLeads.mockResolvedValue({ ok: true, imported: 1, leadIds: ['lead-1'], skippedPlatformEmails: [], duplicatesInPayload: 0 })
  })

  it('Booksy ×11 -> shared_email; Sport Clips -> franchise; Roslindale ×2 (same business) imports normally', async () => {
    const booksyAccounts = Array.from({ length: 11 }, (_, i) =>
      account({
        id: `booksy-${i + 1}`,
        name: `Booksy Shop ${i + 1}`,
        custom_fields: { email: 'frontdesk@sharedmgmt.example' },
      }),
    )
    // Two listings of the SAME business under different names, no website on
    // file for either — must collapse to ONE distinct business (count 1, well
    // under the >=3 threshold) and import the verified one normally.
    const roslindaleImported = account({
      id: 'ros-1',
      name: 'ATM (Roslindale Barbershop)',
      custom_fields: { email: 'roslindalebarbershop@live.com' },
      email_status: 'ok',
    })
    const roslindaleUnverified = account({
      id: 'ros-2',
      name: 'Roslindale Barbershop',
      custom_fields: { email: 'roslindalebarbershop@live.com' },
      email_status: null,
    })
    const sportClips = account({
      id: 'sport-clips-1',
      name: 'Sport Clips Haircuts of Anytown',
      custom_fields: { email: 'contact.us@sportclips.com' },
    })

    const db = makeDb({
      contacts: [],
      accounts: [...booksyAccounts, roslindaleImported, roslindaleUnverified, sportClips],
    })
    createServiceRoleClient.mockReturnValue(db)

    const input = tool().inputSchema.parse({ source_type: 'xcraper', confirmed: true })
    const result = (await tool().handler(input, { auth: { orgId: 'org-1' } } as never)) as Record<string, unknown>

    expect(result.held_back).toMatchObject({ shared_email: 11, franchise: 1, unverified: 1 })
    expect(result.importable).toBe(1)
    expect(result.imported).toBe(1)

    expect(xmailBulkImportLeads).toHaveBeenCalledTimes(1)
    const leads = xmailBulkImportLeads.mock.calls[0][0] as Array<{ email: string }>
    expect(leads).toHaveLength(1)
    expect(leads[0].email).toBe('roslindalebarbershop@live.com')
    expect(db.updateCalls[0].ids).toEqual(['ros-1'])

    const retained = result.retained_for_review as Array<Record<string, unknown>>
    expect(retained.length).toBeGreaterThan(0)
    expect(retained.length).toBeLessThanOrEqual(10)
    expect(retained.some((r) => r.reason === 'franchise' && r.matched_brand === 'Sport Clips')).toBe(true)
    expect(retained.some((r) => r.reason === 'shared_email' && r.email === 'frontdesk@sharedmgmt.example')).toBe(true)
  })

  it('dry run (confirmed omitted) reports shared_email/franchise counts without importing anything', async () => {
    const booksyAccounts = Array.from({ length: 3 }, (_, i) =>
      account({ id: `booksy-${i + 1}`, name: `Booksy Shop ${i + 1}`, custom_fields: { email: 'frontdesk@sharedmgmt.example' } }),
    )
    const db = makeDb({ contacts: [], accounts: booksyAccounts })
    createServiceRoleClient.mockReturnValue(db)

    const input = tool().inputSchema.parse({ source_type: 'xcraper' })
    const result = (await tool().handler(input, { auth: { orgId: 'org-1' } } as never)) as Record<string, unknown>

    expect(result.dry_run).toBe(true)
    expect(result.would_import).toBe(0)
    expect(result.held_back).toMatchObject({ shared_email: 3, franchise: 0 })
    expect(xmailBulkImportLeads).not.toHaveBeenCalled()
  })
})
