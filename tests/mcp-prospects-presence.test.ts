import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createServiceRoleClient } = vi.hoisted(() => ({
  createServiceRoleClient: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient }))
vi.mock('@/lib/prospects/outreach-eligibility', () => ({
  isDndBlocked: vi.fn(() => false),
  loadEmailSuppressions: vi.fn(async () => new Set<string>()),
  normalizeOutreachEmail: vi.fn((value: string | null) => value?.trim().toLowerCase() ?? null),
}))

import { prospectsTools } from '@/lib/mcp/tools/prospects'

function accountsQuery(rows: Array<Record<string, unknown>>) {
  const calls = { contains: vi.fn() }
  const query: Record<string, unknown> = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    gte: vi.fn(() => query),
    lte: vi.fn(() => query),
    ilike: vi.fn(() => query),
    contains: calls.contains.mockImplementation(() => query),
    limit: vi.fn(() => query),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
  }
  return { query, calls }
}

describe('prospects_list web-presence contract', () => {
  beforeEach(() => vi.clearAllMocks())

  it('accepts no_owned_website, filters the stored boolean, and exposes contactability/location fields', async () => {
    const row = {
      id: 'account-1',
      name: 'Buffalo Cuts',
      domain: null,
      website: null,
      phone: '+17165550123',
      address: null,
      score: 74,
      source_type: 'xcraper',
      engagement_status: 'not_contacted',
      custom_fields: {
        email: 'hello@buffalocuts.example',
        address: '123 Main St, Buffalo, NY 14201',
        city: 'Buffalo',
        has_owned_website: false,
        web_presence_type: 'booking_platform',
        web_presence_url: 'https://booksy.com/buffalo-cuts',
        booking_platform: 'Booksy',
        booking_url: 'https://booksy.com/buffalo-cuts',
      },
    }
    const { query, calls } = accountsQuery([row])
    createServiceRoleClient.mockReturnValue({ from: vi.fn(() => query) })
    const tool = prospectsTools.find((candidate) => candidate.name === 'prospects_list')!
    const input = tool.inputSchema.parse({ kind: 'company', web_presence: 'no_owned_website' })
    const result = await tool.handler(input, { auth: { orgId: 'org-1' } } as never) as Record<string, unknown>

    expect(calls.contains).toHaveBeenCalledWith('custom_fields', { has_owned_website: false })
    expect((result.prospects as Array<Record<string, unknown>>)[0]).toMatchObject({
      phone: '+17165550123',
      address: '123 Main St, Buffalo, NY 14201',
      location: '123 Main St, Buffalo, NY 14201',
      city: 'Buffalo',
      has_owned_website: false,
      web_presence_type: 'booking_platform',
      booking_platform: 'Booksy',
    })
  })

  it('reports the phone backlog next to the email backlog (every scraped business is kept)', async () => {
    const base = { domain: null, website: null, address: null, score: 50, source_type: 'xcraper', engagement_status: 'not_contacted' }
    const rows = [
      { ...base, id: 'a', name: 'Email and phone', phone: '+15085550001', custom_fields: { email: 'a@shop-a.example' } },
      { ...base, id: 'b', name: 'Phone only', phone: '+15085550002', custom_fields: {} },
      { ...base, id: 'c', name: 'Phone only too', phone: '+15085550003', custom_fields: {} },
      { ...base, id: 'd', name: 'Nothing', phone: null, custom_fields: {} },
    ]
    const { query } = accountsQuery(rows)
    createServiceRoleClient.mockReturnValue({ from: vi.fn(() => query) })
    const tool = prospectsTools.find((candidate) => candidate.name === 'prospects_list')!
    const all = await tool.handler(tool.inputSchema.parse({ kind: 'company' }), { auth: { orgId: 'org-1' } } as never) as Record<string, unknown>
    expect(all).toMatchObject({ total: 4, with_email: 1, with_phone: 3, phone_only: 2, capped: false })

    const phones = await tool.handler(tool.inputSchema.parse({ kind: 'company', has_phone: true }), { auth: { orgId: 'org-1' } } as never) as Record<string, unknown>
    expect((phones.prospects as Array<Record<string, unknown>>).map((p) => p.id)).toEqual(['a', 'b', 'c'])
  })
})
