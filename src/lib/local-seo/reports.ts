import 'server-only'

// White-label Local SEO reports (Phase 6).
//
//   buildReportData   everything a report shows, for one period, read with the
//                     service-role client and scoped to the report's org
//   share links       /r/local-seo/<token>; only the SHA-256 is stored
//   renderReportPdf   Chromium prints the public page (?print=1), inside the
//                     website-analyzer slot gate so the box never runs two
//                     uncoordinated Chromium pools (2026-08-30 incident)
//   sendDueReports    monthly email with the PDF attached and a 30-day link

import { createHash, randomBytes } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'
import { resolveOrgBranding, type OrgBranding } from '@/lib/branding'
import { sendTenantEmail, sendPlatformEmail } from '@/lib/email/resend'
import { createLogger } from '@/lib/obs/logger'
import { withBrowserSlot } from '@/services/website-analyzer/concurrency'

import type { AuditCheck, Pillar } from './audit-checks'
import { REPORT_SECTIONS, type ReportSection } from './report-sections'

export { REPORT_SECTIONS, type ReportSection }

type Admin = SupabaseClient<Database>
type ReportRow = Database['public']['Tables']['local_seo_reports']['Row']

const DAY_MS = 86_400_000
const log = createLogger({ module: 'local-seo/reports' })


export type ReportGridPoint = { row: number; col: number; rank: number | null; status: string }

export type ReportKeyword = {
  keyword: string
  scanAt: string | null
  gridSize: number | null
  solv: number | null
  arp: number | null
  foundPct: number | null
  previous: { solv: number | null; arp: number | null; at: string } | null
  points: ReportGridPoint[]
  trend: { at: string; solv: number | null }[]
  competitors: { title: string; solv: number | null; avgRank: number | null; rating: number | null; reviews: number | null; isTarget: boolean }[]
}

export type ReportLocation = {
  id: string
  name: string
  address: string | null
  rating: number | null
  reviewsCount: number | null
  keywords: ReportKeyword[]
  reviews: { newInPeriod: number; avgRatingInPeriod: number | null; replyRate: number | null } | null
  performance: { metric: string; label: string; current: number; previous: number }[] | null
  audit: { score: number; pillars: Record<Pillar, number | null>; top: Pick<AuditCheck, 'label' | 'status' | 'action'>[]; at: string } | null
}

export type ReportData = {
  title: string
  intro: string | null
  orgName: string
  branding: OrgBranding
  periodDays: number
  from: string
  to: string
  sections: ReportSection[]
  locations: ReportLocation[]
}

const PERF_LABELS: { label: string; match: (m: string) => boolean }[] = [
  { label: 'Profile views', match: (m) => m.startsWith('BUSINESS_IMPRESSIONS') },
  { label: 'Calls', match: (m) => m === 'CALL_CLICKS' },
  { label: 'Website clicks', match: (m) => m === 'WEBSITE_CLICKS' },
  { label: 'Direction requests', match: (m) => m === 'BUSINESS_DIRECTION_REQUESTS' },
]

const num = (v: number | string | null | undefined) => (v === null || v === undefined ? null : Number(v))

export async function buildReportData(admin: Admin, report: ReportRow, now = new Date()): Promise<ReportData> {
  const to = now
  const from = new Date(now.getTime() - report.period_days * DAY_MS)
  const prevFrom = new Date(from.getTime() - report.period_days * DAY_MS)
  const sections = report.sections.filter((s): s is ReportSection => (REPORT_SECTIONS as readonly string[]).includes(s))

  const [{ data: org }, { data: locations }] = await Promise.all([
    admin.from('organizations').select('name, logo_url, accent_color, brand_name').eq('id', report.org_id).maybeSingle(),
    report.location_ids.length
      ? admin.from('local_seo_locations').select('*').eq('org_id', report.org_id).in('id', report.location_ids)
      : admin.from('local_seo_locations').select('*').eq('org_id', report.org_id).eq('is_active', true),
  ])

  const out: ReportLocation[] = []
  for (const loc of locations ?? []) {
    const { data: scans } = await admin
      .from('local_seo_scans')
      .select('id, keyword, comparable_key, created_at, grid_size, solv, arp, found_pct')
      .eq('location_id', loc.id)
      .in('status', ['completed', 'partial'])
      .gte('created_at', prevFrom.toISOString())
      .order('created_at', { ascending: false })
      .limit(500)

    const latestByKeyword = new Map<string, NonNullable<typeof scans>[number]>()
    for (const s of scans ?? []) if (!latestByKeyword.has(s.keyword) && s.created_at >= from.toISOString()) latestByKeyword.set(s.keyword, s)

    const keywords: ReportKeyword[] = []
    for (const s of latestByKeyword.values()) {
      const same = (scans ?? []).filter((x) => x.comparable_key === s.comparable_key)
      const prev = same.find((x) => x.created_at < from.toISOString()) ?? same[same.length - 1]
      const [{ data: points }, { data: comps }] = await Promise.all([
        sections.includes('rankings')
          ? admin.from('local_seo_scan_points').select('row_idx, col_idx, rank, status').eq('scan_id', s.id)
          : Promise.resolve({ data: [] as { row_idx: number; col_idx: number; rank: number | null; status: string }[] }),
        sections.includes('competitors')
          ? admin
              .from('local_seo_competitor_snapshots')
              .select('title, solv, avg_rank, rating, reviews, is_target')
              .eq('scan_id', s.id)
              .order('solv', { ascending: false })
              .limit(6)
          : Promise.resolve({ data: [] as { title: string; solv: number | null; avg_rank: number | null; rating: number | null; reviews: number | null; is_target: boolean }[] }),
      ])
      keywords.push({
        keyword: s.keyword,
        scanAt: s.created_at,
        gridSize: s.grid_size,
        solv: num(s.solv),
        arp: num(s.arp),
        foundPct: num(s.found_pct),
        previous: prev && prev.id !== s.id ? { solv: num(prev.solv), arp: num(prev.arp), at: prev.created_at } : null,
        points: (points ?? []).map((p) => ({ row: p.row_idx, col: p.col_idx, rank: p.rank, status: p.status })),
        trend: same
          .filter((x) => x.created_at >= from.toISOString())
          .map((x) => ({ at: x.created_at, solv: num(x.solv) }))
          .reverse(),
        competitors: (comps ?? []).map((c) => ({ title: c.title, solv: num(c.solv), avgRank: num(c.avg_rank), rating: num(c.rating), reviews: c.reviews, isTarget: c.is_target })),
      })
    }

    let reviews: ReportLocation['reviews'] = null
    if (sections.includes('reviews') && loc.gbp_location_name) {
      const { data: rv } = await admin.from('gbp_reviews').select('rating, reply_state').eq('location_id', loc.id).gte('create_time', from.toISOString())
      const rated = (rv ?? []).map((r) => r.rating).filter((n): n is number => n !== null)
      reviews = {
        newInPeriod: rv?.length ?? 0,
        avgRatingInPeriod: rated.length ? Math.round((rated.reduce((a, b) => a + b, 0) / rated.length) * 10) / 10 : null,
        replyRate: rv?.length ? Math.round(((rv ?? []).filter((r) => r.reply_state === 'replied').length / rv.length) * 100) : null,
      }
    }

    let performance: ReportLocation['performance'] = null
    if (sections.includes('performance') && loc.gbp_location_name) {
      const { data: perf } = await admin
        .from('gbp_performance_daily')
        .select('date, metric, value')
        .eq('location_id', loc.id)
        .gte('date', prevFrom.toISOString().slice(0, 10))
        .limit(10_000)
      const fromDay = from.toISOString().slice(0, 10)
      performance = PERF_LABELS.map((p) => ({
        metric: p.label,
        label: p.label,
        current: (perf ?? []).filter((r) => p.match(r.metric) && r.date >= fromDay).reduce((a, r) => a + Number(r.value), 0),
        previous: (perf ?? []).filter((r) => p.match(r.metric) && r.date < fromDay).reduce((a, r) => a + Number(r.value), 0),
      }))
      if (performance.every((p) => p.current === 0 && p.previous === 0)) performance = null
    }

    let audit: ReportLocation['audit'] = null
    if (sections.includes('audit')) {
      const { data: a } = await admin
        .from('local_seo_audits')
        .select('score, pillar_scores, checks, created_at')
        .eq('location_id', loc.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (a) {
        const checks = (a.checks as unknown as AuditCheck[]) ?? []
        audit = {
          score: a.score,
          pillars: a.pillar_scores as unknown as Record<Pillar, number | null>,
          top: checks.filter((c) => c.status === 'poor').slice(0, 5).map((c) => ({ label: c.label, status: c.status, action: c.action })),
          at: a.created_at,
        }
      }
    }

    out.push({
      id: loc.id,
      name: loc.name,
      address: loc.address,
      rating: num(loc.rating),
      reviewsCount: loc.reviews_count,
      keywords: keywords.sort((a, b) => a.keyword.localeCompare(b.keyword)),
      reviews,
      performance,
      audit,
    })
  }

  return {
    title: report.name,
    intro: report.intro,
    orgName: org?.brand_name ?? org?.name ?? 'Local SEO',
    branding: resolveOrgBranding(org),
    periodDays: report.period_days,
    from: from.toISOString(),
    to: to.toISOString(),
    sections,
    locations: out,
  }
}

// ── Share links ───────────────────────────────────────────────────────────

export function hashShareToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function createShareLink(
  admin: Admin,
  input: { orgId: string; reportId: string; expiresInDays: number | null; userId?: string | null },
): Promise<{ token: string; id: string } | { error: string }> {
  const token = `lsr_${randomBytes(24).toString('base64url')}`
  const { data, error } = await admin
    .from('local_seo_report_shares')
    .insert({
      org_id: input.orgId,
      report_id: input.reportId,
      token_hash: hashShareToken(token),
      token_hint: token.slice(0, 10),
      expires_at: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * DAY_MS).toISOString() : null,
      created_by: input.userId ?? null,
    })
    .select('id')
    .single()
  if (error || !data) return { error: error?.message ?? 'Could not create the link.' }
  return { token, id: data.id }
}

export async function resolveShareToken(admin: Admin, token: string, countView = true): Promise<ReportRow | null> {
  if (!/^lsr_[A-Za-z0-9_-]{20,64}$/.test(token)) return null
  const { data: share } = await admin
    .from('local_seo_report_shares')
    .select('id, report_id, expires_at, revoked_at, view_count')
    .eq('token_hash', hashShareToken(token))
    .maybeSingle()
  if (!share || share.revoked_at) return null
  if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) return null
  const { data: report } = await admin.from('local_seo_reports').select('*').eq('id', share.report_id).maybeSingle()
  if (!report) return null
  if (countView) {
    await admin
      .from('local_seo_report_shares')
      .update({ view_count: share.view_count + 1, last_viewed_at: new Date().toISOString() })
      .eq('id', share.id)
  }
  return report
}

// ── PDF ───────────────────────────────────────────────────────────────────

/** Where the server reaches its own public pages (the container itself by default). */
function internalOrigin(): string {
  return (process.env.LOCAL_SEO_PDF_ORIGIN ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`).replace(/\/+$/, '')
}

export async function renderReportPdf(admin: Admin, report: ReportRow): Promise<Buffer> {
  // A short-lived link just for the renderer.
  const share = await createShareLink(admin, { orgId: report.org_id, reportId: report.id, expiresInDays: 1 })
  if ('error' in share) throw new Error(share.error)
  try {
    return await withBrowserSlot(async () => {
      const { chromium } = await import('playwright')
      const browser = await chromium.launch({
        headless: true,
        executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      })
      try {
        const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } })
        await page.goto(`${internalOrigin()}/r/local-seo/${share.token}?print=1`, { waitUntil: 'networkidle', timeout: 60_000 })
        return await page.pdf({ format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' } })
      } finally {
        await browser.close().catch(() => {})
      }
    })
  } finally {
    await admin.from('local_seo_report_shares').update({ revoked_at: new Date().toISOString() }).eq('id', share.id)
  }
}

// ── Monthly email ─────────────────────────────────────────────────────────

function siteOrigin(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://xphere.app').replace(/\/+$/, '')
}

export async function sendReport(admin: Admin, report: ReportRow): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!report.recipients.length) return { ok: false, error: 'The report has no recipients.' }
  const [pdf, link] = await Promise.all([
    renderReportPdf(admin, report),
    createShareLink(admin, { orgId: report.org_id, reportId: report.id, expiresInDays: 30 }),
  ])
  if ('error' in link) return { ok: false, error: link.error }
  const url = `${siteOrigin()}/r/local-seo/${link.token}`
  const { data: org } = await admin.from('organizations').select('name, brand_name').eq('id', report.org_id).maybeSingle()
  const sender = org?.brand_name ?? org?.name ?? 'Local SEO'
  const month = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const subject = `${report.name} — ${month}`
  const html = `<p>Hello,</p><p>Your Local SEO report for ${month} is attached as a PDF.</p><p><a href="${url}">Open the interactive report</a> (link valid for 30 days).</p><p>— ${sender}</p>`
  const attachments = [{ filename: `${report.name.replace(/[^\w-]+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 7)}.pdf`, content: pdf.toString('base64') }]

  const errors: string[] = []
  for (const to of report.recipients) {
    const res = await sendTenantEmail(report.org_id, to, subject, html, undefined, { kind: 'transactional', source: 'local_seo_report', attachments })
    if (res.error) {
      // Orgs without their own email integration fall back to the platform sender.
      const fb = await sendPlatformEmail(to, subject, html, undefined, { source: 'local_seo_report', attachments })
      if (fb.error) errors.push(`${to}: ${fb.error}`)
    }
  }
  await admin
    .from('local_seo_reports')
    .update({ last_sent_at: new Date().toISOString(), last_error: errors.length ? errors.join('; ').slice(0, 500) : null })
    .eq('id', report.id)
  return errors.length === report.recipients.length ? { ok: false, error: errors.join('; ') } : { ok: true }
}

/** Monthly reports whose send day is today and that were not sent today. */
export async function sendDueReports(admin: Admin, now = new Date()): Promise<{ sent: number; failed: number }> {
  const { data: due } = await admin
    .from('local_seo_reports')
    .select('*')
    .eq('schedule', 'monthly')
    .eq('send_day', now.getUTCDate())
  let sent = 0
  let failed = 0
  const today = now.toISOString().slice(0, 10)
  for (const report of due ?? []) {
    if (report.last_sent_at && report.last_sent_at.slice(0, 10) === today) continue
    try {
      const res = await sendReport(admin, report)
      if (res.ok) sent++
      else failed++
    } catch (err) {
      failed++
      log.warn('local_seo_report_send_failed', { reportId: report.id, error: (err as Error).message })
      await admin.from('local_seo_reports').update({ last_error: (err as Error).message.slice(0, 500) }).eq('id', report.id)
    }
  }
  return { sent, failed }
}
