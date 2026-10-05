import 'server-only'

// Runs a Local SEO audit: gathers the inputs (profile snapshot or location
// row, reviews, posts, competitors from the latest scans, the website), runs
// the pure checks in audit-checks.ts and stores the result. Also turns the
// Poor/OK items into Tasks.

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Json } from '@/types/database'
import { SafeFetchError, safeFetchBytes } from '@/lib/ads/safe-fetch'
import type { FlatProfile } from '@/lib/gbp/profile'

import {
  computeAudit,
  extractWebsiteFacts,
  suspectedSpam,
  type AuditCheck,
  type AuditInput,
  type CompetitorSample,
  type WebsiteFacts,
} from './audit-checks'

type Admin = SupabaseClient<Database>
const DAY_MS = 86_400_000

export async function fetchWebsiteFacts(url: string, target: { name: string; phone: string | null; address: string | null }): Promise<WebsiteFacts> {
  // Only https, public addresses, re-checked on redirects (SSRF guard).
  const https = url.replace(/^http:\/\//i, 'https://')
  try {
    const { bytes, finalUrl } = await safeFetchBytes(https, { maxBytes: 3 * 1_048_576, timeoutMs: 15_000, accept: /^(text\/html|application\/xhtml\+xml|)$/ })
    const facts = extractWebsiteFacts(bytes.toString('utf8'), target)
    return { url: finalUrl, ok: true, ...facts }
  } catch (err) {
    return {
      url: https,
      ok: false,
      error: err instanceof SafeFetchError ? err.message : err instanceof Error ? err.message : 'fetch failed',
      hasLocalBusinessSchema: false,
      phoneFound: false,
      addressFound: false,
      nameFound: false,
    }
  }
}

export async function gatherAuditInput(admin: Admin, locationId: string, now = new Date()): Promise<AuditInput | null> {
  const { data: loc } = await admin.from('local_seo_locations').select('*').eq('id', locationId).maybeSingle()
  if (!loc) return null
  const connected = !!loc.gbp_location_name
  const since30 = new Date(now.getTime() - 30 * DAY_MS).toISOString()
  const since90 = new Date(now.getTime() - 90 * DAY_MS).toISOString()
  const since7 = new Date(now.getTime() - 7 * DAY_MS).toISOString()

  const [{ data: snap }, { data: scans }] = await Promise.all([
    connected
      ? admin.from('gbp_profile_snapshots').select('data').eq('location_id', locationId).order('taken_at', { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
    admin
      .from('local_seo_scans')
      .select('id, keyword, solv, found_pct, created_at')
      .eq('location_id', locationId)
      .in('status', ['completed', 'partial'])
      .order('created_at', { ascending: false })
      .limit(200),
  ])
  const flat = (snap?.data ?? null) as FlatProfile | null

  // Latest finished scan per keyword.
  const latest = new Map<string, { id: string; keyword: string; solv: number | null; found_pct: number | null; created_at: string }>()
  for (const s of scans ?? []) if (!latest.has(s.keyword)) latest.set(s.keyword, s)

  // Competitors: the top 3 non-target businesses of each keyword's latest scan.
  const scanIds = [...latest.values()].map((s) => s.id)
  const { data: comps } = scanIds.length
    ? await admin
        .from('local_seo_competitor_snapshots')
        .select('scan_id, competitor_key, title, rating, reviews, category, solv, is_target')
        .in('scan_id', scanIds)
        .eq('is_target', false)
        .order('solv', { ascending: false })
    : { data: [] }
  const perScan = new Map<string, number>()
  const seen = new Set<string>()
  const competitors: CompetitorSample[] = []
  const allTitles: string[] = []
  for (const c of comps ?? []) {
    allTitles.push(c.title)
    const n = perScan.get(c.scan_id) ?? 0
    if (n >= 3 || seen.has(c.competitor_key)) continue
    perScan.set(c.scan_id, n + 1)
    seen.add(c.competitor_key)
    competitors.push({ title: c.title, rating: c.rating === null ? null : Number(c.rating), reviews: c.reviews, category: c.category })
  }

  // Reviews: official when connected, else the scraped ones (no reply data).
  let reviews: AuditInput['reviews'] = { rating: loc.rating === null ? null : Number(loc.rating), count: loc.reviews_count, last30Days: null, replyRate90Days: null, unrepliedNegative: null }
  if (connected) {
    const [{ count: last30 }, { data: recent }, { count: negOpen }] = await Promise.all([
      admin.from('gbp_reviews').select('id', { count: 'exact', head: true }).eq('location_id', locationId).gte('create_time', since30),
      admin.from('gbp_reviews').select('reply_state').eq('location_id', locationId).gte('create_time', since90),
      admin.from('gbp_reviews').select('id', { count: 'exact', head: true }).eq('location_id', locationId).lte('rating', 3).eq('reply_state', 'none'),
    ])
    const n90 = recent?.length ?? 0
    reviews = {
      ...reviews,
      last30Days: last30 ?? 0,
      replyRate90Days: n90 ? ((recent ?? []).filter((r) => r.reply_state === 'replied').length / n90) * 100 : null,
      unrepliedNegative: negOpen ?? 0,
    }
  } else if (loc.google_business_profile_id) {
    const { count } = await admin
      .from('google_reviews')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', loc.google_business_profile_id)
      .eq('is_removed', false)
      .gte('date_iso', since30)
    reviews.last30Days = count ?? null
  }

  let postsLast7Days: number | null = null
  let postsLast30Days: number | null = null
  if (connected) {
    const { data: posts } = await admin.from('gbp_posts').select('published_at').eq('location_id', locationId).eq('status', 'live').gte('published_at', since30)
    postsLast30Days = posts?.length ?? 0
    postsLast7Days = (posts ?? []).filter((p) => (p.published_at ?? '') >= since7).length
  }

  const websiteUri = flat?.websiteUri ?? loc.website_url
  const phone = flat?.primaryPhone ?? loc.phone
  const website = websiteUri
    ? await fetchWebsiteFacts(websiteUri, { name: loc.business_name, phone, address: flat?.address ?? loc.address })
    : null

  return {
    now,
    businessName: loc.business_name,
    profile: {
      connected,
      primaryCategory: flat?.primaryCategory ?? loc.primary_category,
      additionalCategories: flat?.additionalCategories ?? [],
      description: flat?.description ?? null,
      hoursSet: flat ? flat.hours.length > 0 : null,
      websiteUri,
      phone,
    },
    reviews,
    postsLast7Days,
    postsLast30Days,
    competitors,
    keywords: [...latest.values()].map((s) => ({
      keyword: s.keyword,
      solv: s.solv === null ? null : Number(s.solv),
      foundPct: s.found_pct === null ? null : Number(s.found_pct),
      scannedAt: s.created_at,
    })),
    website,
    spamSuspects: suspectedSpam([...new Set(allTitles)], [...latest.keys()]),
  }
}

export async function runAudit(admin: Admin, input: { orgId: string; locationId: string; userId?: string | null }): Promise<{ ok: true; auditId: string; score: number } | { ok: false; error: string }> {
  const { data: loc } = await admin.from('local_seo_locations').select('id').eq('id', input.locationId).eq('org_id', input.orgId).maybeSingle()
  if (!loc) return { ok: false, error: 'Location not found.' }
  const gathered = await gatherAuditInput(admin, input.locationId)
  if (!gathered) return { ok: false, error: 'Location not found.' }
  const result = computeAudit(gathered)
  const { data, error } = await admin
    .from('local_seo_audits')
    .insert({
      org_id: input.orgId,
      location_id: input.locationId,
      score: result.score,
      pillar_scores: result.pillars as unknown as Json,
      checks: result.checks as unknown as Json,
      context: { website: gathered.website, competitors: gathered.competitors.length, keywords: gathered.keywords.length } as unknown as Json,
      created_by: input.userId ?? null,
    })
    .select('id')
    .single()
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not save the audit.' }
  return { ok: true, auditId: data.id, score: result.score }
}

/** Turn chosen checks of an audit into Tasks (module Tasks). */
export async function createTasksFromAudit(
  admin: Admin,
  input: { orgId: string; auditId: string; checkIds: string[]; userId: string; locationName: string; locationId: string },
): Promise<{ ok: true; created: number } | { ok: false; error: string }> {
  const { data: audit } = await admin.from('local_seo_audits').select('checks').eq('id', input.auditId).eq('org_id', input.orgId).maybeSingle()
  if (!audit) return { ok: false, error: 'Audit not found.' }
  const checks = (audit.checks as unknown as AuditCheck[]).filter((c) => input.checkIds.includes(c.id) && c.action)
  if (!checks.length) return { ok: false, error: 'Pick at least one item with a suggested action.' }
  const due = new Date(Date.now() + 7 * DAY_MS).toISOString()
  const { error } = await admin.from('tasks').insert(
    checks.map((c) => ({
      org_id: input.orgId,
      title: `[Local SEO] ${input.locationName}: ${c.label}`.slice(0, 255),
      description: `${c.detail}\n\nSuggested action: ${c.action}\n\nFrom the Local SEO audit: /local-seo/${input.locationId}/audit`,
      priority: (c.status === 'poor' ? 'high' : 'medium') as 'high' | 'medium',
      status: 'todo' as const,
      due_date: due,
      created_by: input.userId,
    })),
  )
  if (error) return { ok: false, error: error.message }
  await admin.from('local_seo_audits').update({ tasks_created_at: new Date().toISOString() }).eq('id', input.auditId)
  return { ok: true, created: checks.length }
}
