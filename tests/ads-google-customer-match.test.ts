import { describe, expect, it, vi, beforeEach } from 'vitest'

// ─── Mocks ────────────────────────────────────────────────────────────────────
// Same approach as ads-google-create.test.ts / ads-google-adapter-r2.test.ts:
// only the Google Ads transport is faked for the handler tests. The upload
// command additionally goes through googleAdsRequest (offlineUserDataJobs
// create/addOperations/run) rather than mutateResources, so it's mocked too.
//
// The MCP-tool tests further down mock the engine entry point (previewChange),
// the account resolver and the Supabase service-role client so they exercise
// only ads-google-customer-match.ts's own logic: gathering contacts, hashing
// them, and shaping the response — never a live network or database call.

const runGaqlQueryMock = vi.fn()
const mutateResourcesMock = vi.fn()
const googleAdsRequestMock = vi.fn()

vi.mock('@/lib/ads/google-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ads/google-api')>('@/lib/ads/google-api')
  return {
    ...actual,
    runGaqlQuery: (...args: unknown[]) => runGaqlQueryMock(...args),
    mutateResources: (...args: unknown[]) => mutateResourcesMock(...args),
    googleAdsRequest: (...args: unknown[]) => googleAdsRequestMock(...args),
  }
})

const resolveAdAccountMock = vi.fn()
vi.mock('@/lib/ads/ai-accounts', () => ({
  resolveAdAccount: (...args: unknown[]) => resolveAdAccountMock(...args),
}))

vi.mock('@/lib/ads/connection-health', () => ({
  withConnectionHealth: (_params: unknown, op: () => unknown) => op(),
}))

const previewChangeMock = vi.fn()
vi.mock('@/lib/ads/commands/engine', () => ({
  previewChange: (...args: unknown[]) => previewChangeMock(...args),
}))

const loadEffectivePolicyMock = vi.fn()
vi.mock('@/lib/ads/commands/policies', () => ({
  loadEffectivePolicy: (...args: unknown[]) => loadEffectivePolicyMock(...args),
}))

const MCP_ACTOR = { type: 'ai' as const, id: 'user-1', label: 'mcp:xph_test', canManage: false, canApprove: false }
vi.mock('@/lib/ads/commands/actors', () => ({
  mcpActor: () => MCP_ACTOR,
}))

let contactsRows: Array<{ email: string | null; phone_e164: string | null; phone: string | null }> = []

const serviceClient = {
  from: () => {
    const builder: Record<string, unknown> = {}
    builder.select = vi.fn(() => builder)
    builder.eq = vi.fn(() => builder)
    builder.contains = vi.fn(() => builder)
    builder.then = (resolve: (v: { data: unknown; error: null }) => unknown) => resolve({ data: contactsRows, error: null })
    return builder
  },
}
vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: () => serviceClient }))

import { customerMatchHandler } from '@/lib/ads/providers/google/customer-match'
import { adsGoogleCustomerMatchTools } from '@/lib/mcp/tools/ads-google-customer-match'
import { sha256Hex } from '@/lib/ads/customer-match'
import type { AdapterContext } from '@/lib/ads/providers/types'
import type { ResourceSnapshot } from '@/lib/ads/commands/types'
import type { AdsCommand } from '@/lib/ads/commands/catalog'
import type { McpAuthContext } from '@/lib/mcp/auth'

const ctx: AdapterContext = {
  orgId: 'org-1',
  adAccountId: '1234567890',
  credential: JSON.stringify({ access_token: 'a', refresh_token: 'r' }),
}

const auth: McpAuthContext = { kind: 'legacy_token', orgId: 'org-1', userId: 'user-1', actor: 'mcp:xph_test', scope: 'mcp:all' }

const TOKEN = JSON.stringify({ access_token: 'a', refresh_token: 'r' })

beforeEach(() => {
  vi.clearAllMocks()
  contactsRows = []
})

const g = (type: string, fields: Record<string, unknown>) =>
  ({ platform: 'google' as const, ad_account_id: '1234567890', type, ...fields }) as AdsCommand

/** 64 lowercase hex chars — a plausible-looking SHA-256 digest for test fixtures. */
const hash = (n: number) => n.toString(16).padStart(64, '0')

describe('customerMatchHandler.types', () => {
  it('declares exactly the six Customer Match command types', () => {
    expect([...customerMatchHandler.types].sort()).toEqual([
      'google.user_list.attach',
      'google.user_list.create',
      'google.user_list.detach',
      'google.user_list.remove',
      'google.user_list.rename',
      'google.user_list.upload',
    ])
  })
})

// ─── google.user_list.create ───────────────────────────────────────────────────

describe('snapshot + plan — user_list.create', () => {
  it('reads currency and finds no existing CRM-based list by name', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([{ customer: { currencyCode: 'BRL' } }]).mockResolvedValueOnce([])
    const command = g('google.user_list.create', { name: 'VIP Customers', membership_life_span_days: 180 })
    const before = await customerMatchHandler.snapshot(ctx, command)
    expect(before?.currency).toBe('BRL')
    expect(before?.fields.existing_user_list_id).toBeNull()

    const plan = customerMatchHandler.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.intended).toEqual({ name: 'VIP Customers', membership_status: 'OPEN', membership_life_span: 180 })
  })

  it('rejects a name that matches an existing CRM-based list, case-insensitively', async () => {
    runGaqlQueryMock
      .mockResolvedValueOnce([{ customer: { currencyCode: 'USD' } }])
      .mockResolvedValueOnce([{ userList: { id: '999', name: 'vip customers', type: 'CRM_BASED' } }])
    const command = g('google.user_list.create', { name: 'VIP Customers', membership_life_span_days: 540 })
    const before = await customerMatchHandler.snapshot(ctx, command)
    expect(before?.fields.existing_user_list_id).toBe('999')
    const plan = customerMatchHandler.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('already_exists')
  })

  it('includes the description in the diff when given', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([{ customer: { currencyCode: 'USD' } }]).mockResolvedValueOnce([])
    const command = g('google.user_list.create', { name: 'List', membership_life_span_days: 540, description: 'From CRM tag vip' })
    const before = await customerMatchHandler.snapshot(ctx, command)
    const plan = customerMatchHandler.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.diff.some((d) => d.field === 'description' && d.after === 'From CRM tag vip')).toBe(true)
  })
})

describe('execute + validate — user_list.create', () => {
  it('builds an OPEN CRM_BASED create against userLists:mutate', async () => {
    mutateResourcesMock.mockResolvedValueOnce({ results: [{ resourceName: 'customers/1234567890/userLists/555' }] })
    const command = g('google.user_list.create', { name: 'VIP', membership_life_span_days: 365, description: 'desc' })
    const before: ResourceSnapshot = { resourceType: 'user_list', resourceId: null, resourceName: 'VIP', campaignId: null, currency: 'USD', fields: {} }
    const result = await customerMatchHandler.execute(ctx, command, before)
    const [, , service, operations] = mutateResourcesMock.mock.calls[0]
    expect(service).toBe('userLists')
    expect(operations).toEqual([
      {
        create: {
          name: 'VIP',
          description: 'desc',
          membershipStatus: 'OPEN',
          membershipLifeSpan: 365,
          crmBasedUserList: { uploadKeyType: 'CONTACT_INFO', dataSourceType: 'FIRST_PARTY' },
        },
      },
    ])
    expect(result.providerRef).toBe('customers/1234567890/userLists/555')
  })

  it('passes validateOnly through to mutateResources', async () => {
    mutateResourcesMock.mockResolvedValueOnce({})
    const command = g('google.user_list.create', { name: 'VIP', membership_life_span_days: 365 })
    const before: ResourceSnapshot = { resourceType: 'user_list', resourceId: null, resourceName: 'VIP', campaignId: null, currency: 'USD', fields: {} }
    await customerMatchHandler.validate(ctx, command, before)
    const [, , , , opts] = mutateResourcesMock.mock.calls[0]
    expect(opts).toEqual({ validateOnly: true })
  })
})

describe('verify + rollback — user_list.create', () => {
  it('verifies the created list by re-reading it', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([{ userList: { id: '555', name: 'VIP', membershipStatus: 'OPEN' } }])
    const command = g('google.user_list.create', { name: 'VIP', membership_life_span_days: 365 })
    const verdict = await customerMatchHandler.verify(ctx, command, { name: 'VIP', membership_status: 'OPEN' }, 'customers/1234567890/userLists/555')
    expect(verdict.ok).toBe(true)
  })

  it('fails verification when the created list cannot be found', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([])
    const command = g('google.user_list.create', { name: 'VIP', membership_life_span_days: 365 })
    const verdict = await customerMatchHandler.verify(ctx, command, { name: 'VIP', membership_status: 'OPEN' }, 'customers/1234567890/userLists/555')
    expect(verdict.ok).toBe(false)
  })

  it('has no rollback — deleting a list is a separate, explicit action', () => {
    const command = g('google.user_list.create', { name: 'VIP', membership_life_span_days: 365 })
    const before: ResourceSnapshot = { resourceType: 'user_list', resourceId: null, resourceName: 'VIP', campaignId: null, currency: 'USD', fields: {} }
    expect(customerMatchHandler.buildRollback(command, before, 'customers/1234567890/userLists/555')).toBeNull()
  })
})

// ─── google.user_list.rename ────────────────────────────────────────────────────

describe('user_list.rename', () => {
  it('plans a name change', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([{ userList: { id: '555', name: 'Old' }, customer: { currencyCode: 'USD' } }])
    const command = g('google.user_list.rename', { user_list_id: '555', name: 'New' })
    const before = await customerMatchHandler.snapshot(ctx, command)
    const plan = customerMatchHandler.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.diff).toEqual([expect.objectContaining({ field: 'name', before: 'Old', after: 'New' })])
  })

  it('is a no-op when the name is unchanged', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([{ userList: { id: '555', name: 'Same' }, customer: { currencyCode: 'USD' } }])
    const command = g('google.user_list.rename', { user_list_id: '555', name: 'Same' })
    const before = await customerMatchHandler.snapshot(ctx, command)
    const plan = customerMatchHandler.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('no_op')
  })

  it('returns null (not found) when the list does not exist', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([])
    const before = await customerMatchHandler.snapshot(ctx, g('google.user_list.rename', { user_list_id: '555', name: 'New' }))
    expect(before).toBeNull()
  })

  it('sends the rename with an updateMask of name', async () => {
    mutateResourcesMock.mockResolvedValueOnce({ results: [{ resourceName: 'customers/1234567890/userLists/555' }] })
    const command = g('google.user_list.rename', { user_list_id: '555', name: 'New' })
    const before: ResourceSnapshot = { resourceType: 'user_list', resourceId: '555', resourceName: 'Old', campaignId: null, currency: 'USD', fields: { name: 'Old' } }
    await customerMatchHandler.execute(ctx, command, before)
    const [, , service, operations] = mutateResourcesMock.mock.calls[0]
    expect(service).toBe('userLists')
    expect(operations).toEqual([{ update: { resourceName: 'customers/1234567890/userLists/555', name: 'New' }, updateMask: 'name' }])
  })

  it('rolls back to the previous name', () => {
    const command = g('google.user_list.rename', { user_list_id: '555', name: 'New' })
    const before: ResourceSnapshot = { resourceType: 'user_list', resourceId: '555', resourceName: 'Old', campaignId: null, currency: 'USD', fields: { name: 'Old' } }
    expect(customerMatchHandler.buildRollback(command, before, 'customers/1234567890/userLists/555')).toEqual({
      platform: 'google', ad_account_id: '1234567890', type: 'google.user_list.rename', user_list_id: '555', name: 'Old',
    })
  })
})

// ─── google.user_list.remove ────────────────────────────────────────────────────

describe('user_list.remove', () => {
  it('warns about the attachment count', async () => {
    runGaqlQueryMock
      .mockResolvedValueOnce([{ userList: { id: '555', name: 'VIP' }, customer: { currencyCode: 'USD' } }])
      .mockResolvedValueOnce([{ adGroupCriterion: { criterionId: '1' } }, { adGroupCriterion: { criterionId: '2' } }])
    const command = g('google.user_list.remove', { user_list_id: '555' })
    const before = await customerMatchHandler.snapshot(ctx, command)
    expect(before?.fields.attachment_count).toBe(2)
    const plan = customerMatchHandler.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.warnings.some((w) => /attached to 2 ad group/.test(w))).toBe(true)
  })

  it('sends a remove operation against userLists:mutate', async () => {
    mutateResourcesMock.mockResolvedValueOnce({ results: [{ resourceName: 'customers/1234567890/userLists/555' }] })
    const command = g('google.user_list.remove', { user_list_id: '555' })
    const before: ResourceSnapshot = { resourceType: 'user_list', resourceId: '555', resourceName: 'VIP', campaignId: null, currency: 'USD', fields: { name: 'VIP', attachment_count: 0 } }
    await customerMatchHandler.execute(ctx, command, before)
    const [, , service, operations] = mutateResourcesMock.mock.calls[0]
    expect(service).toBe('userLists')
    expect(operations).toEqual([{ remove: 'customers/1234567890/userLists/555' }])
  })

  it('skips provider-side validation for a pure remove', async () => {
    const command = g('google.user_list.remove', { user_list_id: '555' })
    const before: ResourceSnapshot = { resourceType: 'user_list', resourceId: '555', resourceName: 'VIP', campaignId: null, currency: 'USD', fields: { name: 'VIP', attachment_count: 0 } }
    await customerMatchHandler.validate(ctx, command, before)
    expect(mutateResourcesMock).not.toHaveBeenCalled()
  })

  it('verifies the list no longer exists', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([])
    const verdict = await customerMatchHandler.verify(ctx, g('google.user_list.remove', { user_list_id: '555' }), { exists: false }, 'customers/1234567890/userLists/555')
    expect(verdict.ok).toBe(true)
  })

  it('fails verification when the list still exists', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([{ userList: { id: '555', name: 'VIP' } }])
    const verdict = await customerMatchHandler.verify(ctx, g('google.user_list.remove', { user_list_id: '555' }), { exists: false }, 'customers/1234567890/userLists/555')
    expect(verdict.ok).toBe(false)
  })

  it('has no rollback — the list is gone', () => {
    const command = g('google.user_list.remove', { user_list_id: '555' })
    const before: ResourceSnapshot = { resourceType: 'user_list', resourceId: '555', resourceName: 'VIP', campaignId: null, currency: 'USD', fields: { name: 'VIP', attachment_count: 0 } }
    expect(customerMatchHandler.buildRollback(command, before, 'customers/1234567890/userLists/555')).toBeNull()
  })
})

// ─── google.user_list.attach / detach ──────────────────────────────────────────

describe('user_list.attach', () => {
  it('proposes attaching when not already attached', async () => {
    runGaqlQueryMock
      .mockResolvedValueOnce([{ adGroup: { id: '222', name: 'AG' }, campaign: { id: '111' }, customer: { currencyCode: 'USD' } }])
      .mockResolvedValueOnce([])
    const command = g('google.user_list.attach', { ad_group_id: '222', user_list_id: '555', exclude: false })
    const before = await customerMatchHandler.snapshot(ctx, command)
    const plan = customerMatchHandler.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.intended).toEqual({ user_list_id: '555', negative: false, status: 'ENABLED' })
  })

  it('rejects when already attached the same way', async () => {
    runGaqlQueryMock
      .mockResolvedValueOnce([{ adGroup: { id: '222', name: 'AG' }, campaign: { id: '111' }, customer: { currencyCode: 'USD' } }])
      .mockResolvedValueOnce([
        { adGroupCriterion: { criterionId: '9', negative: false, type: 'USER_LIST', userList: { userList: 'customers/1234567890/userLists/555' } }, adGroup: { id: '222' }, campaign: { id: '111' } },
      ])
    const command = g('google.user_list.attach', { ad_group_id: '222', user_list_id: '555', exclude: false })
    const before = await customerMatchHandler.snapshot(ctx, command)
    const plan = customerMatchHandler.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('already_exists')
  })

  it('tells the caller to detach first when attached with the opposite exclude flag', async () => {
    runGaqlQueryMock
      .mockResolvedValueOnce([{ adGroup: { id: '222', name: 'AG' }, campaign: { id: '111' }, customer: { currencyCode: 'USD' } }])
      .mockResolvedValueOnce([
        { adGroupCriterion: { criterionId: '9', negative: true, type: 'USER_LIST', userList: { userList: 'customers/1234567890/userLists/555' } }, adGroup: { id: '222' }, campaign: { id: '111' } },
      ])
    const command = g('google.user_list.attach', { ad_group_id: '222', user_list_id: '555', exclude: false })
    const before = await customerMatchHandler.snapshot(ctx, command)
    const plan = customerMatchHandler.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) {
      expect(plan.code).toBe('exclude_mismatch')
      expect(plan.message).toMatch(/detach it first/)
    }
  })

  it('sends an adGroupCriteria create with userList + negative', async () => {
    mutateResourcesMock.mockResolvedValueOnce({ results: [{ resourceName: 'customers/1234567890/adGroupCriteria/222~9' }] })
    const command = g('google.user_list.attach', { ad_group_id: '222', user_list_id: '555', exclude: true })
    const before: ResourceSnapshot = { resourceType: 'ad_group', resourceId: null, resourceName: 'x', campaignId: '111', currency: 'USD', fields: {} }
    const result = await customerMatchHandler.execute(ctx, command, before)
    const [, , service, operations] = mutateResourcesMock.mock.calls[0]
    expect(service).toBe('adGroupCriteria')
    expect(operations).toEqual([
      { create: { adGroup: 'customers/1234567890/adGroups/222', status: 'ENABLED', negative: true, userList: { userList: 'customers/1234567890/userLists/555' } } },
    ])
    expect(result.providerRef).toBe('customers/1234567890/adGroupCriteria/222~9')
  })

  it('verifies the attached criterion', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      { adGroupCriterion: { criterionId: '9', negative: true, type: 'USER_LIST', userList: { userList: 'customers/1234567890/userLists/555' } }, adGroup: { id: '222' }, campaign: { id: '111' } },
    ])
    const command = g('google.user_list.attach', { ad_group_id: '222', user_list_id: '555', exclude: true })
    const verdict = await customerMatchHandler.verify(ctx, command, { user_list_id: '555', negative: true, status: 'ENABLED' }, 'customers/1234567890/adGroupCriteria/222~9')
    expect(verdict.ok).toBe(true)
  })

  it('rolls back to a detach of the created criterion', () => {
    const command = g('google.user_list.attach', { ad_group_id: '222', user_list_id: '555', exclude: false })
    const before: ResourceSnapshot = { resourceType: 'ad_group', resourceId: null, resourceName: 'x', campaignId: '111', currency: 'USD', fields: {} }
    expect(customerMatchHandler.buildRollback(command, before, 'customers/1234567890/adGroupCriteria/222~9')).toEqual({
      platform: 'google', ad_account_id: '1234567890', type: 'google.user_list.detach', ad_group_id: '222', criterion_id: '9',
    })
  })
})

describe('user_list.detach', () => {
  it('finds the USER_LIST criterion and proposes removal', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      {
        adGroupCriterion: { criterionId: '9', negative: false, type: 'USER_LIST', userList: { userList: 'customers/1234567890/userLists/555' } },
        adGroup: { id: '222', name: 'AG' },
        campaign: { id: '111' },
        customer: { currencyCode: 'USD' },
      },
    ])
    const command = g('google.user_list.detach', { ad_group_id: '222', criterion_id: '9' })
    const before = await customerMatchHandler.snapshot(ctx, command)
    expect(before?.fields).toEqual({ exists: true, user_list_id: '555', exclude: false })
    const plan = customerMatchHandler.plan(command, before!)
    expect(plan.ok).toBe(true)
  })

  it('returns null when the criterion is not a USER_LIST criterion', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([{ adGroupCriterion: { criterionId: '9', type: 'KEYWORD' }, adGroup: { id: '222' }, campaign: { id: '111' } }])
    const before = await customerMatchHandler.snapshot(ctx, g('google.user_list.detach', { ad_group_id: '222', criterion_id: '9' }))
    expect(before).toBeNull()
  })

  it('sends an adGroupCriteria remove', async () => {
    mutateResourcesMock.mockResolvedValueOnce({ results: [{}] })
    const command = g('google.user_list.detach', { ad_group_id: '222', criterion_id: '9' })
    const before: ResourceSnapshot = { resourceType: 'ad_group', resourceId: '9', resourceName: 'x', campaignId: '111', currency: 'USD', fields: { exists: true, user_list_id: '555', exclude: false } }
    await customerMatchHandler.execute(ctx, command, before)
    const [, , service, operations] = mutateResourcesMock.mock.calls[0]
    expect(service).toBe('adGroupCriteria')
    expect(operations).toEqual([{ remove: 'customers/1234567890/adGroupCriteria/222~9' }])
  })

  it('skips provider-side validation', async () => {
    const command = g('google.user_list.detach', { ad_group_id: '222', criterion_id: '9' })
    const before: ResourceSnapshot = { resourceType: 'ad_group', resourceId: '9', resourceName: 'x', campaignId: '111', currency: 'USD', fields: { exists: true, user_list_id: '555', exclude: false } }
    await customerMatchHandler.validate(ctx, command, before)
    expect(mutateResourcesMock).not.toHaveBeenCalled()
  })

  it('rolls back to an attach with the same list and exclude flag', () => {
    const command = g('google.user_list.detach', { ad_group_id: '222', criterion_id: '9' })
    const before: ResourceSnapshot = { resourceType: 'ad_group', resourceId: '9', resourceName: 'x', campaignId: '111', currency: 'USD', fields: { exists: true, user_list_id: '555', exclude: true } }
    expect(customerMatchHandler.buildRollback(command, before, null)).toEqual({
      platform: 'google', ad_account_id: '1234567890', type: 'google.user_list.attach', ad_group_id: '222', user_list_id: '555', exclude: true,
    })
  })
})

// ─── google.user_list.upload ────────────────────────────────────────────────────

const uploadCommand = (overrides: Record<string, unknown> = {}) =>
  g('google.user_list.upload', {
    user_list_id: '555',
    hashed_emails: [hash(1)],
    hashed_phones: [],
    consent_ad_user_data: 'UNSPECIFIED',
    consent_ad_personalization: 'UNSPECIFIED',
    ...overrides,
  })

describe('snapshot + plan — user_list.upload', () => {
  it('reads the list and confirms it is a CRM-based list', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([{ userList: { id: '555', name: 'VIP', type: 'CRM_BASED', membershipStatus: 'OPEN' }, customer: { currencyCode: 'USD' } }])
    const before = await customerMatchHandler.snapshot(ctx, uploadCommand())
    expect(before?.fields).toEqual({ name: 'VIP', type: 'CRM_BASED', membership_status: 'OPEN' })
  })

  it('rejects a non-CRM-based list', () => {
    const before: ResourceSnapshot = { resourceType: 'user_list', resourceId: '555', resourceName: 'X', campaignId: null, currency: 'USD', fields: { type: 'LOGICAL', membership_status: 'OPEN' } }
    const plan = customerMatchHandler.plan(uploadCommand(), before)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('not_customer_match_list')
  })

  it('rejects a closed list', () => {
    const before: ResourceSnapshot = { resourceType: 'user_list', resourceId: '555', resourceName: 'X', campaignId: null, currency: 'USD', fields: { type: 'CRM_BASED', membership_status: 'CLOSED' } }
    const plan = customerMatchHandler.plan(uploadCommand(), before)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('list_closed')
  })

  it('shows only counts in the diff and warnings — never the hashes', () => {
    const before: ResourceSnapshot = { resourceType: 'user_list', resourceId: '555', resourceName: 'X', campaignId: null, currency: 'USD', fields: { type: 'CRM_BASED', membership_status: 'OPEN' } }
    const command = uploadCommand({ hashed_emails: [hash(1), hash(2)], hashed_phones: [hash(3)] })
    const plan = customerMatchHandler.plan(command, before)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.diff).toEqual([
      expect.objectContaining({ field: 'hashed_emails', after: 2 }),
      expect.objectContaining({ field: 'hashed_phones', after: 1 }),
    ])
    const serialized = JSON.stringify(plan.diff) + JSON.stringify(plan.warnings) + JSON.stringify(plan.intended)
    expect(serialized).not.toContain(hash(1))
    expect(serialized).not.toContain(hash(2))
    expect(serialized).not.toContain(hash(3))
    expect(plan.warnings.some((w) => /asynchronously/.test(w))).toBe(true)
  })
})

describe('validate — user_list.upload', () => {
  it('makes no provider call — Google has no validate-only for offline user data jobs', async () => {
    const before: ResourceSnapshot = { resourceType: 'user_list', resourceId: '555', resourceName: 'X', campaignId: null, currency: 'USD', fields: { type: 'CRM_BASED', membership_status: 'OPEN' } }
    await customerMatchHandler.validate(ctx, uploadCommand(), before)
    expect(mutateResourcesMock).not.toHaveBeenCalled()
    expect(googleAdsRequestMock).not.toHaveBeenCalled()
  })
})

describe('execute — the offline user data job flow', () => {
  it('creates the job with consent, uploads identifiers, and runs it', async () => {
    googleAdsRequestMock
      .mockResolvedValueOnce({ resourceName: 'customers/1234567890/offlineUserDataJobs/777' })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
    const command = uploadCommand({ hashed_emails: [hash(1), hash(2)], hashed_phones: [hash(3)], consent_ad_user_data: 'GRANTED', consent_ad_personalization: 'DENIED' })
    const before: ResourceSnapshot = { resourceType: 'user_list', resourceId: '555', resourceName: 'X', campaignId: null, currency: 'USD', fields: {} }
    const result = await customerMatchHandler.execute(ctx, command, before)

    expect(googleAdsRequestMock).toHaveBeenCalledTimes(3)

    const [createPath, , createOpts] = googleAdsRequestMock.mock.calls[0]
    expect(createPath).toBe('customers/1234567890/offlineUserDataJobs:create')
    expect(createOpts).toMatchObject({
      body: {
        job: {
          type: 'CUSTOMER_MATCH_USER_LIST',
          customerMatchUserListMetadata: {
            userList: 'customers/1234567890/userLists/555',
            consent: { adUserData: 'GRANTED', adPersonalization: 'DENIED' },
          },
        },
      },
    })

    const [addPath, , addOpts] = googleAdsRequestMock.mock.calls[1]
    expect(addPath).toBe('customers/1234567890/offlineUserDataJobs/777:addOperations')
    const addBody = (addOpts as { body: { enablePartialFailure: boolean; operations: unknown[] } }).body
    expect(addBody.enablePartialFailure).toBe(true)
    expect(addBody.operations).toEqual([
      { create: { userIdentifiers: [{ hashedEmail: hash(1) }] } },
      { create: { userIdentifiers: [{ hashedEmail: hash(2) }] } },
      { create: { userIdentifiers: [{ hashedPhoneNumber: hash(3) }] } },
    ])

    const [runPath] = googleAdsRequestMock.mock.calls[2]
    expect(runPath).toBe('customers/1234567890/offlineUserDataJobs/777:run')

    expect(result.providerRef).toBe('customers/1234567890/offlineUserDataJobs/777')
  })

  it('chunks operations into batches of at most 10,000', async () => {
    googleAdsRequestMock
      .mockResolvedValueOnce({ resourceName: 'customers/1234567890/offlineUserDataJobs/777' })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
    const hashedEmails = Array.from({ length: 10_000 }, (_, i) => hash(i))
    const hashedPhones = Array.from({ length: 5_000 }, (_, i) => hash(i + 20_000))
    const command = uploadCommand({ hashed_emails: hashedEmails, hashed_phones: hashedPhones })
    const before: ResourceSnapshot = { resourceType: 'user_list', resourceId: '555', resourceName: 'X', campaignId: null, currency: 'USD', fields: {} }
    await customerMatchHandler.execute(ctx, command, before)

    // create + 2 addOperations chunks (10,000 then 5,000) + run = 4 calls.
    expect(googleAdsRequestMock).toHaveBeenCalledTimes(4)
    const firstChunk = (googleAdsRequestMock.mock.calls[1][2] as { body: { operations: unknown[] } }).body.operations
    const secondChunk = (googleAdsRequestMock.mock.calls[2][2] as { body: { operations: unknown[] } }).body.operations
    expect(firstChunk).toHaveLength(10_000)
    expect(secondChunk).toHaveLength(5_000)
  })
})

describe('verify — user_list.upload', () => {
  it.each(['PENDING', 'RUNNING', 'SUCCESS'])('treats %s as ok — uploads are processed asynchronously', async (status) => {
    runGaqlQueryMock.mockResolvedValueOnce([{ offlineUserDataJob: { status } }])
    const verdict = await customerMatchHandler.verify(ctx, uploadCommand(), {}, 'customers/1234567890/offlineUserDataJobs/777')
    expect(verdict.ok).toBe(true)
    expect(verdict.observed?.status).toBe(status)
  })

  it('treats FAILED as a mismatch', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([{ offlineUserDataJob: { status: 'FAILED', failureReason: 'INVALID_USER_LIST_ID' } }])
    const verdict = await customerMatchHandler.verify(ctx, uploadCommand(), {}, 'customers/1234567890/offlineUserDataJobs/777')
    expect(verdict.ok).toBe(false)
    expect(verdict.mismatches[0]).toEqual({ field: 'status', expected: 'PENDING|RUNNING|SUCCESS', actual: 'FAILED' })
  })

  it('fails verification without a providerRef, without querying', async () => {
    const verdict = await customerMatchHandler.verify(ctx, uploadCommand(), {}, null)
    expect(verdict.ok).toBe(false)
    expect(runGaqlQueryMock).not.toHaveBeenCalled()
  })

  it('has no rollback for an upload', () => {
    const before: ResourceSnapshot = { resourceType: 'user_list', resourceId: '555', resourceName: 'X', campaignId: null, currency: 'USD', fields: {} }
    expect(customerMatchHandler.buildRollback(uploadCommand(), before, 'customers/1234567890/offlineUserDataJobs/777')).toBeNull()
  })
})

// ─── MCP tools ──────────────────────────────────────────────────────────────────

describe('ads_google_list_user_lists', () => {
  it('lists CRM-based lists with size and match rate', async () => {
    resolveAdAccountMock.mockResolvedValueOnce({ ok: true, accountId: '1234567890', accountName: 'Acct', token: TOKEN })
    runGaqlQueryMock.mockResolvedValueOnce([
      { userList: { id: '555', name: 'VIP', membershipStatus: 'OPEN', sizeForSearch: '1200', sizeForDisplay: '3400', matchRatePercentage: 62 } },
    ])
    const tool = adsGoogleCustomerMatchTools.find((t) => t.name === 'ads_google_list_user_lists')!
    const result = await tool.handler({ customer_id: undefined }, { auth })
    expect(result).toEqual({
      customer_id: '1234567890',
      user_lists: [{ user_list_id: '555', name: 'VIP', membership_status: 'OPEN', size_for_search: 1200, size_for_display: 3400, match_rate_percentage: 62 }],
    })
  })

  it('surfaces the account resolution error', async () => {
    resolveAdAccountMock.mockResolvedValueOnce({ ok: false, error: 'no_connection', detail: 'not connected' })
    const tool = adsGoogleCustomerMatchTools.find((t) => t.name === 'ads_google_list_user_lists')!
    const result = await tool.handler({ customer_id: undefined }, { auth })
    expect(result).toEqual({ error: 'no_connection', detail: 'not connected', available_accounts: undefined })
  })
})

describe('ads_google_user_list_upload_status', () => {
  it('returns status and failure_reason', async () => {
    resolveAdAccountMock.mockResolvedValueOnce({ ok: true, accountId: '1234567890', accountName: null, token: TOKEN })
    runGaqlQueryMock.mockResolvedValueOnce([{ offlineUserDataJob: { status: 'SUCCESS' } }])
    const tool = adsGoogleCustomerMatchTools.find((t) => t.name === 'ads_google_user_list_upload_status')!
    const result = await tool.handler({ customer_id: undefined, job_resource_name: 'customers/1234567890/offlineUserDataJobs/777' }, { auth })
    expect(result).toEqual({ customer_id: '1234567890', job_resource_name: 'customers/1234567890/offlineUserDataJobs/777', status: 'SUCCESS', failure_reason: null })
  })

  it('returns not_found when the job does not exist', async () => {
    resolveAdAccountMock.mockResolvedValueOnce({ ok: true, accountId: '1234567890', accountName: null, token: TOKEN })
    runGaqlQueryMock.mockResolvedValueOnce([])
    const tool = adsGoogleCustomerMatchTools.find((t) => t.name === 'ads_google_user_list_upload_status')!
    const result = await tool.handler({ customer_id: undefined, job_resource_name: 'customers/1234567890/offlineUserDataJobs/777' }, { auth })
    expect(result).toEqual({ error: 'not_found', detail: expect.any(String) })
  })
})

describe('ads_google_prepare_customer_match_upload', () => {
  function successfulPreview(overrides: Record<string, unknown> = {}) {
    return {
      ok: true as const,
      duplicate: false,
      confirmationToken: 'tok_abc',
      change: {
        id: 'change-1',
        platform: 'google' as const,
        ad_account_id: '1234567890',
        command_type: 'google.user_list.upload',
        label: 'Upload contacts to Customer Match list',
        command: { type: 'google.user_list.upload', user_list_id: '555' },
        resource_type: 'user_list',
        resource_id: '555',
        resource_name: 'VIP',
        campaign_id: null,
        status: 'awaiting_approval' as const,
        risk_level: 3,
        diff: [{ field: 'hashed_emails', label: 'Hashed emails to upload', before: null, after: 1, beforeDisplay: '—', afterDisplay: '1' }],
        warnings: ['Google Ads processes Customer Match uploads asynchronously.'],
        approval_required: true,
        approval_reasons: [],
        approval_expires_at: null,
        approved_by_label: null,
        approved_at: null,
        actor_type: 'ai',
        actor_label: 'mcp:xph_test',
        attempt_count: 0,
        next_attempt_at: null,
        error_code: null,
        error_message: null,
        verification: null,
        provider_ref: null,
        rollback_of: null,
        batch_id: null,
        created_at: '2026-01-01T00:00:00Z',
        executed_at: null,
        completed_at: null,
        external_drift: null,
        external_drift_detected_at: null,
        last_reconciled_at: null,
        ...overrides,
      },
    }
  }

  it('hashes explicit emails and previews an upload command, revealing only counts', async () => {
    resolveAdAccountMock.mockResolvedValueOnce({ ok: true, accountId: '1234567890', accountName: null, token: TOKEN })
    previewChangeMock.mockResolvedValueOnce(successfulPreview())
    loadEffectivePolicyMock.mockResolvedValueOnce({ aiMode: 'propose' })

    const tool = adsGoogleCustomerMatchTools.find((t) => t.name === 'ads_google_prepare_customer_match_upload')!
    const result = await tool.handler(
      {
        customer_id: undefined,
        user_list_id: '555',
        emails: ['Test@Example.com'],
        phones: undefined,
        crm_tag: undefined,
        default_country: undefined,
        consent_ad_user_data: 'GRANTED',
        consent_ad_personalization: 'UNSPECIFIED',
      },
      { auth },
    )

    expect(previewChangeMock).toHaveBeenCalledTimes(1)
    const [call] = previewChangeMock.mock.calls[0]
    expect(call.command).toEqual({
      platform: 'google',
      ad_account_id: '1234567890',
      type: 'google.user_list.upload',
      user_list_id: '555',
      hashed_emails: [sha256Hex('test@example.com')],
      hashed_phones: [],
      consent_ad_user_data: 'GRANTED',
      consent_ad_personalization: 'UNSPECIFIED',
    })

    expect(result).toMatchObject({ change_id: 'change-1', accepted_contacts: 1, rejected_contacts: 0 })
    const serialized = JSON.stringify(result)
    expect(serialized.toLowerCase()).not.toContain('test@example.com')
  })

  it('reads contacts by crm_tag from the CRM and hashes them, never returning the raw values', async () => {
    resolveAdAccountMock.mockResolvedValueOnce({ ok: true, accountId: '1234567890', accountName: null, token: TOKEN })
    contactsRows = [
      { email: 'vip1@example.com', phone_e164: '+14155552671', phone: null },
      { email: null, phone_e164: null, phone: '2025551234' },
    ]
    previewChangeMock.mockResolvedValueOnce(successfulPreview({ id: 'change-2', diff: [], warnings: [], approval_required: false }))
    loadEffectivePolicyMock.mockResolvedValueOnce({ aiMode: 'execute_with_confirmation' })

    const tool = adsGoogleCustomerMatchTools.find((t) => t.name === 'ads_google_prepare_customer_match_upload')!
    const result = await tool.handler(
      { customer_id: undefined, user_list_id: '555', emails: undefined, phones: undefined, crm_tag: 'vip', default_country: 'US', consent_ad_user_data: 'UNSPECIFIED', consent_ad_personalization: 'UNSPECIFIED' },
      { auth },
    )

    const [call] = previewChangeMock.mock.calls[0]
    expect(call.command.hashed_emails).toEqual([sha256Hex('vip1@example.com')])
    expect(call.command.hashed_phones).toHaveLength(2)

    const serialized = JSON.stringify(result) + JSON.stringify(previewChangeMock.mock.calls[0])
    expect(serialized).not.toContain('vip1@example.com')
    expect(serialized).not.toContain('2025551234')
    expect(serialized).not.toContain('+14155552671')
  })

  it('errors when no emails, phones or crm_tag are given, without resolving an account', async () => {
    const tool = adsGoogleCustomerMatchTools.find((t) => t.name === 'ads_google_prepare_customer_match_upload')!
    const result = await tool.handler(
      { customer_id: undefined, user_list_id: '555', emails: undefined, phones: undefined, crm_tag: undefined, default_country: undefined, consent_ad_user_data: 'UNSPECIFIED', consent_ad_personalization: 'UNSPECIFIED' },
      { auth },
    )
    expect(result).toEqual({ error: 'no_contacts', detail: expect.any(String) })
    expect(resolveAdAccountMock).not.toHaveBeenCalled()
  })

  it('errors when nothing normalises to a valid email or phone', async () => {
    resolveAdAccountMock.mockResolvedValueOnce({ ok: true, accountId: '1234567890', accountName: null, token: TOKEN })
    const tool = adsGoogleCustomerMatchTools.find((t) => t.name === 'ads_google_prepare_customer_match_upload')!
    const result = await tool.handler(
      { customer_id: undefined, user_list_id: '555', emails: ['not-an-email'], phones: ['abc'], crm_tag: undefined, default_country: undefined, consent_ad_user_data: 'UNSPECIFIED', consent_ad_personalization: 'UNSPECIFIED' },
      { auth },
    )
    expect(result).toEqual({ error: 'no_valid_contacts', detail: expect.any(String), rejected: 2 })
    expect(previewChangeMock).not.toHaveBeenCalled()
  })

  it('surfaces a preview failure as-is', async () => {
    resolveAdAccountMock.mockResolvedValueOnce({ ok: true, accountId: '1234567890', accountName: null, token: TOKEN })
    previewChangeMock.mockResolvedValueOnce({ ok: false, code: 'list_closed', message: 'This Customer Match list is CLOSED.' })
    const tool = adsGoogleCustomerMatchTools.find((t) => t.name === 'ads_google_prepare_customer_match_upload')!
    const result = await tool.handler(
      { customer_id: undefined, user_list_id: '555', emails: ['a@b.com'], phones: undefined, crm_tag: undefined, default_country: undefined, consent_ad_user_data: 'UNSPECIFIED', consent_ad_personalization: 'UNSPECIFIED' },
      { auth },
    )
    expect(result).toEqual({ error: 'list_closed', detail: 'This Customer Match list is CLOSED.' })
  })
})
