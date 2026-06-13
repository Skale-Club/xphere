// MCP tools for the prospecting "back of funnel": list/score-filter prospects and
// send them a marketing email on command (e.g. "email everyone I scraped above 50
// points"). The user's command IS the approval — but `prospects_send_email` is
// gated by an explicit `confirmed: true`, so the agent must preview with
// `prospects_list` and get the human's go-ahead before anything is sent.
//
// Compliance is delegated to sendTenantEmail({ kind: 'marketing' }): it honours the
// org suppression list and appends the CAN-SPAM footer + one-click List-Unsubscribe.

import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { sendTenantEmail } from '@/lib/email/resend'
import type { McpToolDef } from '../tool-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  return createServiceRoleClient()
}

// Batch sizing keeps us inside the serverless wall-clock budget and under Resend's
// default rate limit (~10 req/s): up to BATCH sends in parallel, then a short pause.
const SEND_BATCH = 10
const SEND_DELAY_MS = 1_100
const DEFAULT_MAX = 100
const HARD_MAX = 300

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const filterShape = {
  score_min: z.number().int().min(0).max(100).optional().describe('Only prospects with score >= this (lead score: higher = more site problems = hotter lead).'),
  score_max: z.number().int().min(0).max(100).optional(),
  source_type: z.string().max(60).optional().describe("Filter by ingestion source, e.g. 'xcraper' for Google-Maps scrapes."),
  kind: z.enum(['person', 'company', 'all']).optional().describe("'company' (scraped businesses), 'person', or 'all'. Default 'all'."),
  qualification: z.enum(['unqualified', 'needs_review', 'qualified']).optional(),
  engagement: z.string().max(40).optional().describe("e.g. 'not_contacted' to skip anyone already emailed."),
}

type Filters = {
  score_min?: number
  score_max?: number
  source_type?: string
  kind?: 'person' | 'company' | 'all'
  qualification?: 'unqualified' | 'needs_review' | 'qualified'
  engagement?: string
}

type ResolvedProspect = {
  kind: 'person' | 'company'
  id: string
  name: string | null
  email: string | null
  score: number
  source_type: string | null
  engagement_status: string
  website: string | null
}

function composeName(r: { first_name?: string | null; last_name?: string | null; name?: string | null }): string | null {
  const composed = [r.first_name, r.last_name].filter(Boolean).join(' ').trim()
  return composed || r.name?.trim() || null
}

/** Companies have no email column; the scraped email (enriched runs only) lives in custom_fields.email. */
function emailFromCustomFields(cf: unknown): string | null {
  if (!cf || typeof cf !== 'object') return null
  const e = (cf as Record<string, unknown>).email
  return typeof e === 'string' && e.includes('@') ? e.trim() : null
}

async function resolveProspects(
  orgId: string,
  f: Filters,
  opts: { requireEmail?: boolean; cap?: number } = {},
): Promise<ResolvedProspect[]> {
  const cap = opts.cap ?? 1000
  const kind = f.kind ?? 'all'
  const wantPeople = kind === 'all' || kind === 'person'
  const wantCompanies = kind === 'all' || kind === 'company'
  const out: ResolvedProspect[] = []

  if (wantPeople) {
    let q = db()
      .from('contacts')
      .select('id, first_name, last_name, name, email, score, source_type, engagement_status')
      .eq('org_id', orgId)
      .eq('lifecycle_stage', 'prospect')
      .limit(cap)
    if (f.score_min != null) q = q.gte('score', f.score_min)
    if (f.score_max != null) q = q.lte('score', f.score_max)
    if (f.source_type) q = q.eq('source_type', f.source_type)
    if (f.qualification) q = q.eq('qualification_status', f.qualification)
    if (f.engagement) q = q.eq('engagement_status', f.engagement)
    if (opts.requireEmail) q = q.not('email', 'is', null)
    const { data } = await q
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      out.push({
        kind: 'person',
        id: r.id as string,
        name: composeName(r as { first_name?: string | null; last_name?: string | null; name?: string | null }),
        email: (r.email as string | null) ?? null,
        score: (r.score as number | null) ?? 0,
        source_type: (r.source_type as string | null) ?? null,
        engagement_status: r.engagement_status as string,
        website: null,
      })
    }
  }

  if (wantCompanies) {
    let q = db()
      .from('accounts')
      .select('id, name, domain, website, score, source_type, engagement_status, custom_fields')
      .eq('org_id', orgId)
      .eq('lifecycle_stage', 'prospect')
      .limit(cap)
    if (f.score_min != null) q = q.gte('score', f.score_min)
    if (f.score_max != null) q = q.lte('score', f.score_max)
    if (f.source_type) q = q.eq('source_type', f.source_type)
    if (f.qualification) q = q.eq('qualification_status', f.qualification)
    if (f.engagement) q = q.eq('engagement_status', f.engagement)
    const { data } = await q
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      const email = emailFromCustomFields(r.custom_fields)
      if (opts.requireEmail && !email) continue
      out.push({
        kind: 'company',
        id: r.id as string,
        name: (r.name as string | null) ?? null,
        email,
        score: (r.score as number | null) ?? 0,
        source_type: (r.source_type as string | null) ?? null,
        engagement_status: r.engagement_status as string,
        website: (r.domain as string | null) ?? (r.website as string | null) ?? null,
      })
    }
  }

  out.sort((a, b) => b.score - a.score)
  return out
}

/** Is the org's outbound email (Resend) integration connected? */
async function emailSenderReady(orgId: string): Promise<boolean> {
  const { data } = await db()
    .from('tenant_email_integrations')
    .select('status')
    .eq('org_id', orgId)
    .eq('status', 'connected')
    .maybeSingle()
  return Boolean(data)
}

export const prospectsTools: McpToolDef[] = [
  {
    name: 'prospects_list',
    title: 'List / preview prospects',
    description:
      "List prospects (lifecycle_stage='prospect') with score/source filters, sorted by score (hottest first). Use this to PREVIEW an outreach audience before sending — it reports how many match and how many have a usable email. Always run this first and show the human the count before calling prospects_send_email.",
    area: 'general_xphere',
    inputSchema: z
      .object({
        ...filterShape,
        has_email: z.boolean().optional().describe('Only count/return prospects that have a usable email address.'),
        limit: z.number().int().positive().max(200).optional(),
        offset: z.number().int().nonnegative().optional(),
      })
      .strict(),
    handler: async (input, { auth }) => {
      const all = await resolveProspects(auth.orgId, input)
      const withEmail = all.filter((p) => p.email)
      const pool = input.has_email ? withEmail : all
      const limit = input.limit ?? 50
      const offset = input.offset ?? 0
      return {
        total: all.length,
        with_email: withEmail.length,
        emailable_note:
          withEmail.length === 0 && all.length > 0
            ? 'None of these have an email — they were scraped "standard" (no email extraction). Re-scrape with scrapeType "enriched" to get emails before emailing.'
            : undefined,
        prospects: pool.slice(offset, offset + limit),
        limit,
        offset,
      }
    },
  },
  {
    name: 'prospects_send_email',
    title: 'Send a marketing email to matching prospects',
    description:
      "Send a one-off marketing email to every prospect matching the filters that has an email. SAFETY: this only sends when confirmed:true — first call prospects_list, tell the human how many will be emailed and show the subject/body, and only set confirmed:true after they approve. Suppression list + CAN-SPAM footer + unsubscribe are applied automatically. Body is HTML. Caps at " + HARD_MAX + ' recipients per call.',
    area: 'general_xphere',
    annotations: { destructiveHint: true, idempotentHint: false },
    inputSchema: z
      .object({
        ...filterShape,
        subject: z.string().min(1).max(200),
        body_html: z.string().min(1).max(50_000).describe('Email body as HTML. A compliance footer + unsubscribe link are appended automatically.'),
        max: z.number().int().positive().max(HARD_MAX).optional().describe(`Hard cap on recipients (default ${DEFAULT_MAX}).`),
        confirmed: z.boolean().optional().describe('Must be true to actually send. Leave false/absent for a dry run.'),
      })
      .strict(),
    handler: async (input, { auth }) => {
      const { subject, body_html, max, confirmed, ...filters } = input

      // Dry-run guard — never sends unless explicitly confirmed by the human.
      if (!confirmed) {
        const preview = await resolveProspects(auth.orgId, filters, { requireEmail: true })
        return {
          dry_run: true,
          would_email: Math.min(preview.length, max ?? DEFAULT_MAX),
          matched_with_email: preview.length,
          message:
            'Nothing was sent (confirmed was not true). Show the human these numbers and the subject/body, then call again with confirmed:true to send.',
          sample: preview.slice(0, 5).map((p) => ({ name: p.name, email: p.email, score: p.score })),
        }
      }

      if (!(await emailSenderReady(auth.orgId))) {
        return {
          error:
            'Outbound email is not connected for this workspace. Connect a Resend key in Xphere → Settings → Email, then retry.',
        }
      }

      const cap = Math.min(max ?? DEFAULT_MAX, HARD_MAX)
      const allWithEmail = await resolveProspects(auth.orgId, filters, { requireEmail: true })
      const recipients = allWithEmail.slice(0, cap)

      if (recipients.length === 0) {
        return { sent: 0, skipped: 0, failed: 0, matched: 0, message: 'No matching prospects have an email to send to.' }
      }

      let sent = 0
      let skipped = 0
      let failed = 0
      const errors: Array<{ email: string; error: string }> = []
      const nowIso = new Date().toISOString()

      for (let i = 0; i < recipients.length; i += SEND_BATCH) {
        const batch = recipients.slice(i, i + SEND_BATCH)
        await Promise.all(
          batch.map(async (p) => {
            const email = p.email as string
            const res = await sendTenantEmail(auth.orgId, email, subject, body_html, undefined, { kind: 'marketing' })
            if (res.skipped) {
              skipped += 1
              return
            }
            if (res.error) {
              failed += 1
              if (errors.length < 5) errors.push({ email, error: res.error })
              return
            }
            sent += 1
            // Record engagement on the source row + the prospect timeline.
            const table = p.kind === 'person' ? 'contacts' : 'accounts'
            await db()
              .from(table)
              .update({ engagement_status: 'contacted', last_contacted_at: nowIso, updated_at: nowIso })
              .eq('id', p.id)
            await db()
              .from('prospect_engagement_events')
              .insert({
                org_id: auth.orgId,
                entity_type: p.kind === 'person' ? 'contact' : 'account',
                entity_id: p.id,
                event_type: 'sent',
                source_platform: 'email',
                payload: { subject, message_id: res.id ?? null },
              })
          }),
        )
        if (i + SEND_BATCH < recipients.length) await sleep(SEND_DELAY_MS)
      }

      return {
        matched: recipients.length,
        sent,
        skipped,
        failed,
        capped:
          allWithEmail.length > cap
            ? { total_matched: allWithEmail.length, cap, remaining: allWithEmail.length - cap }
            : undefined,
        errors: errors.length ? errors : undefined,
        message: `Sent ${sent} email(s)${skipped ? `, skipped ${skipped} (unsubscribed)` : ''}${failed ? `, ${failed} failed` : ''}.`,
      }
    },
  },
]
