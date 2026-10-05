import { beforeEach, describe, expect, it, vi } from 'vitest'

const getLocationMock = vi.fn()
const patchLocationMock = vi.fn()
const getAttributesMock = vi.fn()
const updateAttributesMock = vi.fn()

vi.mock('@/lib/google-business/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/google-business/api')>('@/lib/google-business/api')
  return {
    ...actual,
    getGoogleBusinessLocation: (...args: unknown[]) => getLocationMock(...args),
    patchGoogleBusinessLocation: (...args: unknown[]) => patchLocationMock(...args),
    getGoogleBusinessAttributes: (...args: unknown[]) => getAttributesMock(...args),
    updateGoogleBusinessAttributes: (...args: unknown[]) => updateAttributesMock(...args),
  }
})

vi.mock('@/lib/ads/safe-fetch', () => ({ assertPublicHttpsUrl: vi.fn() }))

import { COMMAND_CATALOG, parseCommand } from '@/lib/ads/commands/catalog'
import { googleBusinessAdapter } from '@/lib/ads/providers/google-business-adapter'
import type { AdapterContext } from '@/lib/ads/providers/types'

const ctx: AdapterContext = {
  orgId: 'org-1',
  adAccountId: 'accounts/123/locations/456',
  credential: JSON.stringify({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 }),
}

beforeEach(() => vi.clearAllMocks())

describe('Google Business Profile command catalog', () => {
  it('exposes all 13 Windsor write actions through the guarded catalog', () => {
    const types = Object.entries(COMMAND_CATALOG).filter(([, entry]) => entry.platform === 'google_business').map(([type]) => type)
    expect(Object.keys(COMMAND_CATALOG)).toHaveLength(96)
    expect(types).toHaveLength(13)
    expect(types).toContain('google_business.review.reply')
    expect(types).toContain('google_business.location.update_attributes')
    expect(types).toContain('google_business.location.set_open_status')
  })

  it('requires the composite account/location target and explicit address risk acknowledgement', () => {
    expect(parseCommand({
      platform: 'google_business',
      ad_account_id: 'locations/456',
      type: 'google_business.review.reply',
      review_id: 'review-1',
      comment: 'Obrigado!',
    }).ok).toBe(false)

    expect(parseCommand({
      platform: 'google_business',
      ad_account_id: 'accounts/123/locations/456',
      type: 'google_business.location.update_address',
      region_code: 'BR',
      address_lines: ['Rua A, 10'],
      acknowledge_reverification_risk: false,
    }).ok).toBe(false)
  })

  it('validates CTA and replacement-list coherence before a provider call', () => {
    const post = parseCommand({
      platform: 'google_business',
      ad_account_id: 'accounts/123/locations/456',
      type: 'google_business.local_post.create',
      summary: 'Agende hoje',
      cta_type: 'BOOK',
    })
    expect(post).toMatchObject({ ok: false })

    const service = parseCommand({
      platform: 'google_business',
      ad_account_id: 'accounts/123/locations/456',
      type: 'google_business.location.update_service_items',
      service_items: [{ service_type_id: 'job_type_id:x', category_id: 'gcid:plumber', display_name: 'Duplicated shape' }],
    })
    expect(service).toMatchObject({ ok: false })
  })
})

describe('Google Business Profile adapter', () => {
  const command = {
    platform: 'google_business' as const,
    ad_account_id: 'accounts/123/locations/456',
    type: 'google_business.location.update_info' as const,
    description: 'Nova descrição',
    primary_phone: '+55 11 99999-0000',
    website_url: 'https://example.com/location',
  }

  it('previews a field-level diff and uses validateOnly before writing', async () => {
    getLocationMock.mockResolvedValue({
      name: 'locations/456',
      title: 'Loja Centro',
      profile: { description: 'Descrição antiga' },
      phoneNumbers: { primaryPhone: '+55 11 1111-1111' },
      websiteUri: 'https://example.com',
    })
    const before = await googleBusinessAdapter.snapshot(ctx, command)
    const plan = googleBusinessAdapter.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.diff.map((entry) => entry.field)).toEqual(['description', 'primary_phone', 'website_url'])

    patchLocationMock.mockResolvedValue({ name: 'locations/456' })
    await googleBusinessAdapter.validate(ctx, command, before!)
    expect(patchLocationMock).toHaveBeenNthCalledWith(
      1,
      ctx.adAccountId,
      ctx.credential,
      {
        profile: { description: 'Nova descrição' },
        phoneNumbers: { primaryPhone: '+55 11 99999-0000' },
        websiteUri: 'https://example.com/location',
      },
      ['profile.description', 'phoneNumbers.primaryPhone', 'websiteUri'],
      true,
    )

    const executed = await googleBusinessAdapter.execute(ctx, command, before!)
    expect(executed.providerRef).toBe(ctx.adAccountId)
    expect(patchLocationMock).toHaveBeenLastCalledWith(
      ctx.adAccountId,
      ctx.credential,
      expect.any(Object),
      ['profile.description', 'phoneNumbers.primaryPhone', 'websiteUri'],
    )
  })

  it('reads the location back and verifies the intended values', async () => {
    getLocationMock.mockResolvedValue({
      name: 'locations/456',
      title: 'Loja Centro',
      profile: { description: 'Nova descrição' },
      phoneNumbers: { primaryPhone: '+55 11 99999-0000' },
      websiteUri: 'https://example.com/location',
    })
    const verdict = await googleBusinessAdapter.verify(ctx, command, {
      description: 'Nova descrição',
      primary_phone: '+55 11 99999-0000',
      website_url: 'https://example.com/location',
    }, ctx.adAccountId)
    expect(verdict).toMatchObject({ ok: true, mismatches: [] })
  })

  it('only offers a rollback when every touched field has a restorable value', () => {
    const rollback = googleBusinessAdapter.buildRollback(command, {
      resourceType: 'location',
      resourceId: ctx.adAccountId,
      resourceName: 'Loja Centro',
      campaignId: null,
      currency: 'USD',
      fields: {
        description: 'Descrição antiga',
        primary_phone: '+55 11 1111-1111',
        website_url: 'https://example.com',
      },
    })
    expect(rollback && parseCommand(rollback)).toMatchObject({ ok: true })

    const unsafeRollback = googleBusinessAdapter.buildRollback(command, {
      resourceType: 'location',
      resourceId: ctx.adAccountId,
      resourceName: 'Loja Centro',
      campaignId: null,
      currency: 'USD',
      fields: {
        description: null,
        primary_phone: '+55 11 1111-1111',
        website_url: 'https://example.com',
      },
    })
    expect(unsafeRollback).toBeNull()
  })
})
