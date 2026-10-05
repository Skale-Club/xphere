import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/services/website-analyzer/concurrency', () => ({ withBrowserSlot: async (fn: () => unknown) => fn() }))
vi.mock('@/lib/email/resend', () => ({ sendTenantEmail: async () => ({}), sendPlatformEmail: async () => ({}) }))

import { computeAudit, extractWebsiteFacts, suspectedSpam, type AuditInput } from '@/lib/local-seo/audit-checks'
import { createShareLink, hashShareToken, resolveShareToken } from '@/lib/local-seo/reports'
import type { Database } from '@/types/database'

import { FakeDb } from './helpers/fake-supabase'

function input(over: Partial<AuditInput> = {}): AuditInput {
  return {
    now: new Date('2026-10-05T00:00:00Z'),
    businessName: 'Bigode Barbearia',
    profile: {
      connected: true,
      primaryCategory: 'Barber shop',
      additionalCategories: ['Hair salon'],
      description: 'x'.repeat(300),
      hoursSet: true,
      websiteUri: 'https://bigode.example/?utm_source=google',
      phone: '+55 11 3333-4444',
    },
    reviews: { rating: 4.8, count: 300, last30Days: 6, replyRate90Days: 95, unrepliedNegative: 0 },
    postsLast7Days: 1,
    postsLast30Days: 4,
    competitors: [
      { title: 'A', rating: 4.6, reviews: 200, category: 'Barber shop' },
      { title: 'B', rating: 4.5, reviews: 150, category: 'Barber shop' },
      { title: 'C', rating: 4.7, reviews: 90, category: 'Hair salon' },
    ],
    keywords: [{ keyword: 'barbearia', solv: 60, foundPct: 100, scannedAt: '2026-10-01T00:00:00Z' }],
    website: { url: 'https://bigode.example', ok: true, hasLocalBusinessSchema: true, phoneFound: true, addressFound: true, nameFound: true },
    spamSuspects: [],
    ...over,
  }
}

describe('computeAudit', () => {
  it('scores a healthy profile 100', () => {
    const res = computeAudit(input())
    expect(res.score).toBe(100)
    expect(res.checks.every((c) => c.status === 'good' || c.status === 'na')).toBe(true)
    expect(res.pillars.profile).toBe(100)
  })

  it('flags the category mismatch, weak reviews and missing website facts', () => {
    const res = computeAudit(
      input({
        profile: { ...input().profile, primaryCategory: 'Hair salon', description: '', hoursSet: false },
        reviews: { rating: 4.1, count: 40, last30Days: 0, replyRate90Days: 30, unrepliedNegative: 2 },
        website: { url: 'https://bigode.example', ok: true, hasLocalBusinessSchema: false, phoneFound: false, addressFound: false, nameFound: true },
        keywords: [{ keyword: 'barbearia', solv: 5, foundPct: 10, scannedAt: '2026-07-01T00:00:00Z' }],
      }),
    )
    const by = (id: string) => res.checks.find((c) => c.id === id)!
    expect(by('primary_category')).toMatchObject({ status: 'poor' })
    expect(by('primary_category').action).toContain('Barber shop')
    expect(by('description').status).toBe('poor')
    expect(by('hours').status).toBe('poor')
    expect(by('rating').status).toBe('poor')
    expect(by('review_count').status).toBe('poor')
    expect(by('negative_unreplied').status).toBe('poor')
    expect(by('nap_phone').status).toBe('poor')
    expect(by('invisible_keywords').detail).toContain('barbearia')
    expect(by('scan_freshness').status).toBe('poor')
    expect(res.score).toBeLessThan(40)
  })

  it('marks GBP-only checks N/A without a connection and keeps them out of the score', () => {
    const res = computeAudit(
      input({
        profile: { ...input().profile, connected: false, description: null, hoursSet: null },
        reviews: { rating: 4.8, count: 300, last30Days: null, replyRate90Days: null, unrepliedNegative: null },
        postsLast7Days: null,
        postsLast30Days: null,
      }),
    )
    for (const id of ['description', 'hours', 'posts', 'reply_rate', 'negative_unreplied']) {
      expect(res.checks.find((c) => c.id === id)?.status).toBe('na')
    }
    expect(res.score).toBe(100)
  })

  it('suggests UTM tags and spots keyword-stuffed competitor names', () => {
    const res = computeAudit(input({ profile: { ...input().profile, websiteUri: 'https://bigode.example' }, spamSuspects: ['Best Barbearia Centro SP 24h'] }))
    expect(res.checks.find((c) => c.id === 'website_link')?.status).toBe('ok')
    expect(res.checks.find((c) => c.id === 'spam')?.status).toBe('ok')
    expect(suspectedSpam(['Barbearia do Zé', 'Best Barbearia Perto de Mim Centro', 'Corte Fino'], ['barbearia'])).toEqual(['Best Barbearia Perto de Mim Centro'])
  })
})

describe('extractWebsiteFacts', () => {
  const html = `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"BarberShop","name":"Bigode"}</script></head>
    <body><h1>Bigode Barbearia</h1><p>Rua Augusta, 1200 - São Paulo - 01304-001</p><a href="tel:+551133334444">(11) 3333-4444</a></body></html>`

  it('finds schema, phone, address and name', () => {
    expect(extractWebsiteFacts(html, { name: 'Bigode Barbearia', phone: '+55 11 3333-4444', address: 'Rua Augusta, 1200, São Paulo, 01304-001' })).toEqual({
      hasLocalBusinessSchema: true,
      phoneFound: true,
      addressFound: true,
      nameFound: true,
    })
  })

  it('reports what is missing', () => {
    expect(extractWebsiteFacts('<html><body>Welcome</body></html>', { name: 'Bigode', phone: '+55 11 3333-4444', address: 'Rua Augusta, 1200' })).toEqual({
      hasLocalBusinessSchema: false,
      phoneFound: false,
      addressFound: false,
      nameFound: false,
    })
  })
})

describe('report share links', () => {
  const asAdmin = (db: FakeDb) => db as unknown as SupabaseClient<Database>

  it('stores only the hash and resolves live links', async () => {
    const db = new FakeDb((t, r) => (t === 'local_seo_report_shares' ? { view_count: 0, revoked_at: null, ...r } : r))
    db.rows('local_seo_reports').push({ id: 'rep', org_id: 'org', name: 'R' })
    const link = await createShareLink(asAdmin(db), { orgId: 'org', reportId: 'rep', expiresInDays: 30 })
    if ('error' in link) throw new Error(link.error)
    const stored = db.rows('local_seo_report_shares')[0]
    expect(stored.token_hash).toBe(hashShareToken(link.token))
    expect(JSON.stringify(stored)).not.toContain(link.token)

    expect((await resolveShareToken(asAdmin(db), link.token))?.id).toBe('rep')
    expect(db.rows('local_seo_report_shares')[0].view_count).toBe(1)
    expect(await resolveShareToken(asAdmin(db), 'lsr_wrongwrongwrongwrongwrongwrong')).toBeNull()
    expect(await resolveShareToken(asAdmin(db), 'not-a-token')).toBeNull()

    stored.revoked_at = new Date().toISOString()
    expect(await resolveShareToken(asAdmin(db), link.token)).toBeNull()
  })

  it('rejects expired links', async () => {
    const db = new FakeDb((t, r) => (t === 'local_seo_report_shares' ? { view_count: 0, revoked_at: null, ...r } : r))
    db.rows('local_seo_reports').push({ id: 'rep', org_id: 'org' })
    const link = await createShareLink(asAdmin(db), { orgId: 'org', reportId: 'rep', expiresInDays: 1 })
    if ('error' in link) throw new Error(link.error)
    db.rows('local_seo_report_shares')[0].expires_at = '2020-01-01T00:00:00Z'
    expect(await resolveShareToken(asAdmin(db), link.token)).toBeNull()
  })
})
