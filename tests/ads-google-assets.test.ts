import { describe, expect, it, vi, beforeEach } from 'vitest'

// ─── Mocks ────────────────────────────────────────────────────────────────────
// Same approach as ads-google-create.test.ts: only the transport is faked.
// GoogleAdsError stays real (unused here, but kept for parity/import safety).

const runGaqlQueryMock = vi.fn()
const mutateResourcesMock = vi.fn()
const googleAdsMutateMock = vi.fn()

vi.mock('@/lib/ads/google-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ads/google-api')>('@/lib/ads/google-api')
  return {
    ...actual,
    runGaqlQuery: (...args: unknown[]) => runGaqlQueryMock(...args),
    mutateResources: (...args: unknown[]) => mutateResourcesMock(...args),
    googleAdsMutate: (...args: unknown[]) => googleAdsMutateMock(...args),
  }
})

import { assetsHandler } from '@/lib/ads/providers/google/assets'
import type { AdapterContext } from '@/lib/ads/providers/types'
import type { ResourceSnapshot } from '@/lib/ads/commands/types'
import type { AdsCommand } from '@/lib/ads/commands/catalog'

const ctx: AdapterContext = {
  orgId: 'org-1',
  adAccountId: '123',
  credential: JSON.stringify({ access_token: 'a', refresh_token: 'r' }),
}

beforeEach(() => {
  vi.clearAllMocks()
})

const g = (type: string, fields: Record<string, unknown>) =>
  ({ platform: 'google' as const, ad_account_id: '123', type, ...fields }) as AdsCommand

// ─── google.asset.add_sitelink ──────────────────────────────────────────────────

describe('snapshot + plan — add_sitelink (campaign level)', () => {
  const command = g('google.asset.add_sitelink', {
    level: 'campaign',
    campaign_id: '111',
    link_text: 'Shop Now',
    final_url: 'https://example.com/shop',
    description1: 'Great deals',
  })

  it('returns null when the parent campaign does not exist', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([])
    const before = await assetsHandler.snapshot(ctx, command)
    expect(before).toBeNull()
  })

  it('proposes the sitelink when nothing identical is linked', async () => {
    runGaqlQueryMock
      .mockResolvedValueOnce([{ campaign: { id: '111', name: 'Campaign A', status: 'ENABLED' }, customer: { currencyCode: 'USD' } }])
      .mockResolvedValueOnce([])
    const before = await assetsHandler.snapshot(ctx, command)
    expect(before?.campaignId).toBe('111')
    expect(before?.fields.existing_asset_id).toBeNull()
    expect(before?.fields.linked_count).toBe(0)

    const plan = assetsHandler.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.intended).toEqual({ link_text: 'Shop Now', final_url: 'https://example.com/shop', description1: 'Great deals', description2: null })
      expect(plan.warnings).toHaveLength(0)
    }
  })

  it('rejects a removed parent campaign', async () => {
    runGaqlQueryMock
      .mockResolvedValueOnce([{ campaign: { id: '111', name: 'Campaign A', status: 'REMOVED' }, customer: { currencyCode: 'USD' } }])
      .mockResolvedValueOnce([])
    const before = await assetsHandler.snapshot(ctx, command)
    const plan = assetsHandler.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('campaign_removed')
  })

  it('rejects an identical sitelink already linked (already_exists)', async () => {
    runGaqlQueryMock
      .mockResolvedValueOnce([{ campaign: { id: '111', name: 'Campaign A', status: 'ENABLED' }, customer: { currencyCode: 'USD' } }])
      .mockResolvedValueOnce([
        {
          campaign: { id: '111', name: 'Campaign A' },
          campaignAsset: { status: 'ENABLED', fieldType: 'SITELINK' },
          asset: { id: '999', finalUrls: ['https://example.com/shop'], sitelinkAsset: { linkText: 'Shop Now' } },
        },
      ])
    const before = await assetsHandler.snapshot(ctx, command)
    expect(before?.fields.existing_asset_id).toBe('999')
    const plan = assetsHandler.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('already_exists')
  })

  it('warns when the campaign would end up with more than 20 linked sitelinks', async () => {
    const links = Array.from({ length: 20 }, (_, i) => ({
      campaign: { id: '111', name: 'Campaign A' },
      campaignAsset: { status: 'ENABLED', fieldType: 'SITELINK' },
      asset: { id: String(i), finalUrls: [`https://example.com/${i}`], sitelinkAsset: { linkText: `Link ${i}` } },
    }))
    runGaqlQueryMock
      .mockResolvedValueOnce([{ campaign: { id: '111', name: 'Campaign A', status: 'ENABLED' }, customer: { currencyCode: 'USD' } }])
      .mockResolvedValueOnce(links)
    const before = await assetsHandler.snapshot(ctx, command)
    expect(before?.fields.linked_count).toBe(20)
    const plan = assetsHandler.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.warnings.some((w) => /more than the typical useful count/.test(w))).toBe(true)
  })
})

describe('snapshot + plan — add_sitelink (ad group level)', () => {
  const command = g('google.asset.add_sitelink', {
    level: 'ad_group',
    ad_group_id: '222',
    link_text: 'Shop Now',
    final_url: 'https://example.com/shop',
  })

  it('returns null when the parent ad group does not exist', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([])
    const before = await assetsHandler.snapshot(ctx, command)
    expect(before).toBeNull()
  })

  it('resolves the campaign id from the parent ad group', async () => {
    runGaqlQueryMock
      .mockResolvedValueOnce([{ adGroup: { id: '222', name: 'AG', status: 'ENABLED' }, campaign: { id: '111' }, customer: { currencyCode: 'USD' } }])
      .mockResolvedValueOnce([])
    const before = await assetsHandler.snapshot(ctx, command)
    expect(before?.campaignId).toBe('111')
    const plan = assetsHandler.plan(command, before!)
    expect(plan.ok).toBe(true)
  })

  it('rejects a removed parent ad group', async () => {
    runGaqlQueryMock
      .mockResolvedValueOnce([{ adGroup: { id: '222', name: 'AG', status: 'REMOVED' }, campaign: { id: '111' }, customer: { currencyCode: 'USD' } }])
      .mockResolvedValueOnce([])
    const before = await assetsHandler.snapshot(ctx, command)
    const plan = assetsHandler.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('ad_group_removed')
  })
})

// ─── google.asset.add_callout ───────────────────────────────────────────────────

describe('snapshot + plan — add_callout', () => {
  const command = g('google.asset.add_callout', { level: 'campaign', campaign_id: '111', text: 'Free shipping' })

  it('proposes the callout when none identical is linked', async () => {
    runGaqlQueryMock
      .mockResolvedValueOnce([{ campaign: { id: '111', name: 'Campaign A', status: 'ENABLED' }, customer: { currencyCode: 'USD' } }])
      .mockResolvedValueOnce([])
    const before = await assetsHandler.snapshot(ctx, command)
    const plan = assetsHandler.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.intended).toEqual({ text: 'Free shipping' })
  })

  it('rejects an identical callout already linked', async () => {
    runGaqlQueryMock
      .mockResolvedValueOnce([{ campaign: { id: '111', name: 'Campaign A', status: 'ENABLED' }, customer: { currencyCode: 'USD' } }])
      .mockResolvedValueOnce([
        {
          campaign: { id: '111' },
          campaignAsset: { status: 'ENABLED', fieldType: 'CALLOUT' },
          asset: { id: '5', calloutAsset: { calloutText: 'Free shipping' } },
        },
      ])
    const before = await assetsHandler.snapshot(ctx, command)
    const plan = assetsHandler.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('already_exists')
  })
})

// ─── google.asset.add_structured_snippet ────────────────────────────────────────

describe('snapshot + plan — add_structured_snippet', () => {
  it('rejects a header that is not one of Google\'s predefined headers', async () => {
    const command = g('google.asset.add_structured_snippet', {
      level: 'campaign',
      campaign_id: '111',
      header: 'Not A Real Header',
      values: ['A', 'B', 'C'],
    })
    runGaqlQueryMock
      .mockResolvedValueOnce([{ campaign: { id: '111', name: 'Campaign A', status: 'ENABLED' }, customer: { currencyCode: 'USD' } }])
      .mockResolvedValueOnce([])
    const before = await assetsHandler.snapshot(ctx, command)
    const plan = assetsHandler.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('invalid_header')
  })

  it('accepts a predefined header and proposes the snippet', async () => {
    const command = g('google.asset.add_structured_snippet', {
      level: 'campaign',
      campaign_id: '111',
      header: 'Brands',
      values: ['Acme', 'Globex', 'Initech'],
    })
    runGaqlQueryMock
      .mockResolvedValueOnce([{ campaign: { id: '111', name: 'Campaign A', status: 'ENABLED' }, customer: { currencyCode: 'USD' } }])
      .mockResolvedValueOnce([])
    const before = await assetsHandler.snapshot(ctx, command)
    const plan = assetsHandler.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.intended).toEqual({ header: 'Brands', values: ['Acme', 'Globex', 'Initech'] })
  })

  it('treats the same header + values in a different order as already existing', async () => {
    const command = g('google.asset.add_structured_snippet', {
      level: 'campaign',
      campaign_id: '111',
      header: 'Brands',
      values: ['Acme', 'Globex', 'Initech'],
    })
    runGaqlQueryMock
      .mockResolvedValueOnce([{ campaign: { id: '111', name: 'Campaign A', status: 'ENABLED' }, customer: { currencyCode: 'USD' } }])
      .mockResolvedValueOnce([
        {
          campaign: { id: '111' },
          campaignAsset: { status: 'ENABLED', fieldType: 'STRUCTURED_SNIPPET' },
          asset: { id: '7', structuredSnippetAsset: { header: 'Brands', values: ['Initech', 'Acme', 'Globex'] } },
        },
      ])
    const before = await assetsHandler.snapshot(ctx, command)
    const plan = assetsHandler.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('already_exists')
  })
})

// ─── google.asset.add_call ───────────────────────────────────────────────────────

describe('snapshot + plan — add_call', () => {
  const command = g('google.asset.add_call', { level: 'campaign', campaign_id: '111', country_code: 'US', phone_number: '2025550123' })

  it('proposes the call asset when none is linked', async () => {
    runGaqlQueryMock
      .mockResolvedValueOnce([{ campaign: { id: '111', name: 'Campaign A', status: 'ENABLED' }, customer: { currencyCode: 'USD' } }])
      .mockResolvedValueOnce([])
    const before = await assetsHandler.snapshot(ctx, command)
    const plan = assetsHandler.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.intended).toEqual({ country_code: 'US', phone_number: '2025550123' })
  })

  it('warns when a call asset is already linked here (typical count is 1)', async () => {
    runGaqlQueryMock
      .mockResolvedValueOnce([{ campaign: { id: '111', name: 'Campaign A', status: 'ENABLED' }, customer: { currencyCode: 'USD' } }])
      .mockResolvedValueOnce([
        {
          campaign: { id: '111' },
          campaignAsset: { status: 'ENABLED', fieldType: 'CALL' },
          asset: { id: '8', callAsset: { countryCode: 'PT', phoneNumber: '999999999' } },
        },
      ])
    const before = await assetsHandler.snapshot(ctx, command)
    expect(before?.fields.linked_count).toBe(1)
    const plan = assetsHandler.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.warnings.some((w) => /more than the typical useful count/.test(w))).toBe(true)
  })

  it('rejects an identical call asset already linked', async () => {
    runGaqlQueryMock
      .mockResolvedValueOnce([{ campaign: { id: '111', name: 'Campaign A', status: 'ENABLED' }, customer: { currencyCode: 'USD' } }])
      .mockResolvedValueOnce([
        {
          campaign: { id: '111' },
          campaignAsset: { status: 'ENABLED', fieldType: 'CALL' },
          asset: { id: '8', callAsset: { countryCode: 'US', phoneNumber: '2025550123' } },
        },
      ])
    const before = await assetsHandler.snapshot(ctx, command)
    const plan = assetsHandler.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('already_exists')
  })
})

// ─── google.asset.unlink ─────────────────────────────────────────────────────────

describe('snapshot + plan — unlink', () => {
  it('returns null when the asset is not linked at that field type', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([])
    const command = g('google.asset.unlink', { level: 'campaign', campaign_id: '111', asset_id: '999', field_type: 'SITELINK' })
    const before = await assetsHandler.snapshot(ctx, command)
    expect(before).toBeNull()
  })

  it('finds the linked sitelink and captures its content for a possible rollback', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      {
        campaign: { id: '111', name: 'Campaign A' },
        campaignAsset: { status: 'ENABLED', fieldType: 'SITELINK' },
        asset: { id: '999', finalUrls: ['https://example.com/shop'], sitelinkAsset: { linkText: 'Shop Now', description1: 'Great deals' } },
      },
    ])
    const command = g('google.asset.unlink', { level: 'campaign', campaign_id: '111', asset_id: '999', field_type: 'SITELINK' })
    const before = await assetsHandler.snapshot(ctx, command)
    expect(before?.resourceId).toBe('111~999~SITELINK')
    expect(before?.fields).toMatchObject({ exists: true, link_text: 'Shop Now', final_url: 'https://example.com/shop', description1: 'Great deals' })

    const plan = assetsHandler.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.intended).toEqual({ exists: false })
  })

  it('finds a linked ad-group-level asset', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      {
        adGroup: { id: '222', name: 'AG' },
        campaign: { id: '111' },
        adGroupAsset: { status: 'ENABLED', fieldType: 'CALLOUT' },
        asset: { id: '5', calloutAsset: { calloutText: 'Free shipping' } },
      },
    ])
    const command = g('google.asset.unlink', { level: 'ad_group', ad_group_id: '222', asset_id: '5', field_type: 'CALLOUT' })
    const before = await assetsHandler.snapshot(ctx, command)
    expect(before?.resourceId).toBe('222~5~CALLOUT')
    expect(before?.campaignId).toBe('111')
    expect(before?.fields).toMatchObject({ exists: true, text: 'Free shipping' })
  })
})

// ─── validate / execute — add_* ─────────────────────────────────────────────────

describe('validate + execute — add_sitelink', () => {
  const before: ResourceSnapshot = { resourceType: 'asset', resourceId: null, resourceName: 'Sitelink', campaignId: '111', currency: 'USD', fields: {} }

  it('sends one atomic googleAds:mutate batch: asset create + campaignAsset link, with a temp resource id', async () => {
    googleAdsMutateMock.mockResolvedValueOnce({
      mutateOperationResponses: [
        { assetResult: { resourceName: 'customers/123/assets/456' } },
        { campaignAssetResult: { resourceName: 'customers/123/campaignAssets/111~456~SITELINK' } },
      ],
    })
    const command = g('google.asset.add_sitelink', {
      level: 'campaign',
      campaign_id: '111',
      link_text: 'Shop Now',
      final_url: 'https://example.com/shop',
      description1: 'Great deals',
    })
    const result = await assetsHandler.execute(ctx, command, before)
    expect(googleAdsMutateMock).toHaveBeenCalledTimes(1)
    const [customerId, , operations, opts] = googleAdsMutateMock.mock.calls[0]
    expect(customerId).toBe('123')
    expect(opts).toBeUndefined()
    expect(operations).toEqual([
      {
        assetOperation: {
          create: {
            resourceName: 'customers/123/assets/-1',
            finalUrls: ['https://example.com/shop'],
            sitelinkAsset: { linkText: 'Shop Now', description1: 'Great deals' },
          },
        },
      },
      {
        campaignAssetOperation: {
          create: { campaign: 'customers/123/campaigns/111', asset: 'customers/123/assets/-1', fieldType: 'SITELINK' },
        },
      },
    ])
    expect(result.providerRef).toBe('customers/123/campaignAssets/111~456~SITELINK')
  })

  it('links at the ad group level with adGroupAssetOperation', async () => {
    googleAdsMutateMock.mockResolvedValueOnce({
      mutateOperationResponses: [
        { assetResult: { resourceName: 'customers/123/assets/456' } },
        { adGroupAssetResult: { resourceName: 'customers/123/adGroupAssets/222~456~CALLOUT' } },
      ],
    })
    const command = g('google.asset.add_callout', { level: 'ad_group', ad_group_id: '222', text: 'Free shipping' })
    const result = await assetsHandler.execute(ctx, command, before)
    const [, , operations] = googleAdsMutateMock.mock.calls[0]
    expect(operations).toEqual([
      { assetOperation: { create: { resourceName: 'customers/123/assets/-1', calloutAsset: { calloutText: 'Free shipping' } } } },
      { adGroupAssetOperation: { create: { adGroup: 'customers/123/adGroups/222', asset: 'customers/123/assets/-1', fieldType: 'CALLOUT' } } },
    ])
    expect(result.providerRef).toBe('customers/123/adGroupAssets/222~456~CALLOUT')
  })

  it('builds structured snippet and call payloads', async () => {
    googleAdsMutateMock.mockResolvedValueOnce({ mutateOperationResponses: [{ campaignAssetResult: { resourceName: 'x' } }] })
    const snippetCommand = g('google.asset.add_structured_snippet', { level: 'campaign', campaign_id: '111', header: 'Brands', values: ['A', 'B', 'C'] })
    await assetsHandler.execute(ctx, snippetCommand, before)
    const [, , snippetOps] = googleAdsMutateMock.mock.calls[0]
    expect((snippetOps as Array<{ assetOperation?: { create: Record<string, unknown> } }>)[0].assetOperation?.create).toMatchObject({
      structuredSnippetAsset: { header: 'Brands', values: ['A', 'B', 'C'] },
    })

    googleAdsMutateMock.mockResolvedValueOnce({ mutateOperationResponses: [{ campaignAssetResult: { resourceName: 'y' } }] })
    const callCommand = g('google.asset.add_call', { level: 'campaign', campaign_id: '111', country_code: 'US', phone_number: '2025550123' })
    await assetsHandler.execute(ctx, callCommand, before)
    const [, , callOps] = googleAdsMutateMock.mock.calls[1]
    expect((callOps as Array<{ assetOperation?: { create: Record<string, unknown> } }>)[0].assetOperation?.create).toMatchObject({
      callAsset: { countryCode: 'US', phoneNumber: '2025550123' },
    })
  })

  it('passes validateOnly through to googleAdsMutate for add_*', async () => {
    googleAdsMutateMock.mockResolvedValueOnce({})
    const command = g('google.asset.add_callout', { level: 'campaign', campaign_id: '111', text: 'Free shipping' })
    await assetsHandler.validate(ctx, command, before)
    const [, , , opts] = googleAdsMutateMock.mock.calls[0]
    expect(opts).toEqual({ validateOnly: true })
  })
})

// ─── validate / execute — unlink ────────────────────────────────────────────────

describe('validate + execute — unlink', () => {
  const before: ResourceSnapshot = {
    resourceType: 'asset',
    resourceId: '111~999~SITELINK',
    resourceName: 'Sitelink',
    campaignId: '111',
    currency: 'USD',
    fields: { exists: true, link_text: 'Shop Now', final_url: 'https://example.com/shop', description1: null, description2: null },
  }

  it('does nothing on validate — a pure remove has nothing left to check', async () => {
    const command = g('google.asset.unlink', { level: 'campaign', campaign_id: '111', asset_id: '999', field_type: 'SITELINK' })
    await assetsHandler.validate(ctx, command, before)
    expect(mutateResourcesMock).not.toHaveBeenCalled()
    expect(googleAdsMutateMock).not.toHaveBeenCalled()
  })

  it('removes the campaignAsset link by resource name', async () => {
    mutateResourcesMock.mockResolvedValueOnce({ results: [{ resourceName: 'customers/123/campaignAssets/111~999~SITELINK' }] })
    const command = g('google.asset.unlink', { level: 'campaign', campaign_id: '111', asset_id: '999', field_type: 'SITELINK' })
    const result = await assetsHandler.execute(ctx, command, before)
    const [customerId, , service, operations] = mutateResourcesMock.mock.calls[0]
    expect(customerId).toBe('123')
    expect(service).toBe('campaignAssets')
    expect(operations).toEqual([{ remove: 'customers/123/campaignAssets/111~999~SITELINK' }])
    expect(result.providerRef).toBe('customers/123/campaignAssets/111~999~SITELINK')
  })

  it('removes the adGroupAsset link by resource name', async () => {
    mutateResourcesMock.mockResolvedValueOnce({ results: [{ resourceName: 'customers/123/adGroupAssets/222~5~CALLOUT' }] })
    const command = g('google.asset.unlink', { level: 'ad_group', ad_group_id: '222', asset_id: '5', field_type: 'CALLOUT' })
    const result = await assetsHandler.execute(ctx, command, before)
    const [, , service, operations] = mutateResourcesMock.mock.calls[0]
    expect(service).toBe('adGroupAssets')
    expect(operations).toEqual([{ remove: 'customers/123/adGroupAssets/222~5~CALLOUT' }])
    expect(result.providerRef).toBe('customers/123/adGroupAssets/222~5~CALLOUT')
  })
})

// ─── verify ───────────────────────────────────────────────────────────────────

describe('verify — add_*', () => {
  const command = g('google.asset.add_sitelink', {
    level: 'campaign',
    campaign_id: '111',
    link_text: 'Shop Now',
    final_url: 'https://example.com/shop',
  })
  const intended = { link_text: 'Shop Now', final_url: 'https://example.com/shop', description1: null, description2: null }

  it('confirms the created link by re-reading it', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      {
        campaign: { id: '111' },
        campaignAsset: { status: 'ENABLED', fieldType: 'SITELINK' },
        asset: { id: '456', finalUrls: ['https://example.com/shop'], sitelinkAsset: { linkText: 'Shop Now' } },
      },
    ])
    const verdict = await assetsHandler.verify(ctx, command, intended, 'customers/123/campaignAssets/111~456~SITELINK')
    expect(verdict.ok).toBe(true)
  })

  it('fails when the providerRef cannot be parsed', async () => {
    const verdict = await assetsHandler.verify(ctx, command, intended, null)
    expect(verdict.ok).toBe(false)
  })

  it('fails when the linked asset cannot be found on re-read', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([])
    const verdict = await assetsHandler.verify(ctx, command, intended, 'customers/123/campaignAssets/111~456~SITELINK')
    expect(verdict.ok).toBe(false)
  })
})

describe('verify — unlink', () => {
  const command = g('google.asset.unlink', { level: 'campaign', campaign_id: '111', asset_id: '999', field_type: 'SITELINK' })

  it('confirms the link is gone', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([])
    const verdict = await assetsHandler.verify(ctx, command, { exists: false }, 'customers/123/campaignAssets/111~999~SITELINK')
    expect(verdict.ok).toBe(true)
  })

  it('fails when the link is still present', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      { campaign: { id: '111' }, campaignAsset: { status: 'ENABLED', fieldType: 'SITELINK' }, asset: { id: '999' } },
    ])
    const verdict = await assetsHandler.verify(ctx, command, { exists: false }, 'customers/123/campaignAssets/111~999~SITELINK')
    expect(verdict.ok).toBe(false)
  })
})

// ─── rollback ─────────────────────────────────────────────────────────────────

describe('buildRollback — add_* → unlink', () => {
  const before: ResourceSnapshot = { resourceType: 'asset', resourceId: null, resourceName: 'Sitelink', campaignId: '111', currency: 'USD', fields: {} }

  it('rolls back a campaign-level add_sitelink by unlinking the new asset', () => {
    const command = g('google.asset.add_sitelink', { level: 'campaign', campaign_id: '111', link_text: 'Shop Now', final_url: 'https://example.com/shop' })
    const rollback = assetsHandler.buildRollback(command, before, 'customers/123/campaignAssets/111~456~SITELINK')
    expect(rollback).toEqual({
      platform: 'google',
      ad_account_id: '123',
      type: 'google.asset.unlink',
      level: 'campaign',
      campaign_id: '111',
      ad_group_id: undefined,
      asset_id: '456',
      field_type: 'SITELINK',
    })
  })

  it('rolls back an ad-group-level add_callout by unlinking the new asset', () => {
    const command = g('google.asset.add_callout', { level: 'ad_group', ad_group_id: '222', text: 'Free shipping' })
    const rollback = assetsHandler.buildRollback(command, before, 'customers/123/adGroupAssets/222~5~CALLOUT')
    expect(rollback).toEqual({
      platform: 'google',
      ad_account_id: '123',
      type: 'google.asset.unlink',
      level: 'ad_group',
      campaign_id: undefined,
      ad_group_id: '222',
      asset_id: '5',
      field_type: 'CALLOUT',
    })
  })

  it('returns null when the providerRef cannot be parsed (write may not have landed)', () => {
    const command = g('google.asset.add_sitelink', { level: 'campaign', campaign_id: '111', link_text: 'Shop Now', final_url: 'https://example.com/shop' })
    expect(assetsHandler.buildRollback(command, before, null)).toBeNull()
  })
})

describe('buildRollback — unlink → add_*', () => {
  it('re-adds an identical sitelink from the captured content', () => {
    const command = g('google.asset.unlink', { level: 'campaign', campaign_id: '111', asset_id: '999', field_type: 'SITELINK' })
    const before: ResourceSnapshot = {
      resourceType: 'asset',
      resourceId: '111~999~SITELINK',
      resourceName: 'Sitelink',
      campaignId: '111',
      currency: 'USD',
      fields: { exists: true, link_text: 'Shop Now', final_url: 'https://example.com/shop', description1: 'Great deals', description2: null },
    }
    const rollback = assetsHandler.buildRollback(command, before, 'customers/123/campaignAssets/111~999~SITELINK')
    expect(rollback).toEqual({
      platform: 'google',
      ad_account_id: '123',
      type: 'google.asset.add_sitelink',
      level: 'campaign',
      campaign_id: '111',
      ad_group_id: undefined,
      link_text: 'Shop Now',
      final_url: 'https://example.com/shop',
      description1: 'Great deals',
    })
  })

  it('re-adds an identical structured snippet from the captured content', () => {
    const command = g('google.asset.unlink', { level: 'campaign', campaign_id: '111', asset_id: '7', field_type: 'STRUCTURED_SNIPPET' })
    const before: ResourceSnapshot = {
      resourceType: 'asset',
      resourceId: '111~7~STRUCTURED_SNIPPET',
      resourceName: 'Structured snippet',
      campaignId: '111',
      currency: 'USD',
      fields: { exists: true, header: 'Brands', values: ['Acme', 'Globex', 'Initech'] },
    }
    const rollback = assetsHandler.buildRollback(command, before, 'customers/123/campaignAssets/111~7~STRUCTURED_SNIPPET')
    expect(rollback).toEqual({
      platform: 'google',
      ad_account_id: '123',
      type: 'google.asset.add_structured_snippet',
      level: 'campaign',
      campaign_id: '111',
      ad_group_id: undefined,
      header: 'Brands',
      values: ['Acme', 'Globex', 'Initech'],
    })
  })

  it('re-adds an identical call asset from the captured content', () => {
    const command = g('google.asset.unlink', { level: 'campaign', campaign_id: '111', asset_id: '8', field_type: 'CALL' })
    const before: ResourceSnapshot = {
      resourceType: 'asset',
      resourceId: '111~8~CALL',
      resourceName: 'Call asset',
      campaignId: '111',
      currency: 'USD',
      fields: { exists: true, country_code: 'US', phone_number: '2025550123' },
    }
    const rollback = assetsHandler.buildRollback(command, before, 'customers/123/campaignAssets/111~8~CALL')
    expect(rollback).toEqual({
      platform: 'google',
      ad_account_id: '123',
      type: 'google.asset.add_call',
      level: 'campaign',
      campaign_id: '111',
      ad_group_id: undefined,
      country_code: 'US',
      phone_number: '2025550123',
    })
  })

  it('returns null when the captured content cannot support a re-add', () => {
    const command = g('google.asset.unlink', { level: 'campaign', campaign_id: '111', asset_id: '999', field_type: 'SITELINK' })
    const before: ResourceSnapshot = {
      resourceType: 'asset',
      resourceId: '111~999~SITELINK',
      resourceName: 'Sitelink',
      campaignId: '111',
      currency: 'USD',
      fields: { exists: false },
    }
    expect(assetsHandler.buildRollback(command, before, null)).toBeNull()
  })
})
