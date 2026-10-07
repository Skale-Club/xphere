// MCP tools for the prospecting "back of funnel": list/score-filter prospects and
// enrol them into an Xmail outreach campaign on command (e.g. "email everyone I
// scraped above 50 points"). The user's command IS the approval — but
// `prospects_enroll_in_campaign` is gated by `confirmed:true`, so the agent must
// preview with `prospects_list` and get the human's go-ahead before enrolling.
//
// Sending is owned by XMAIL's outreach engine (verified domains, sequences,
// sending limits, open/click/reply tracking). Xphere only orchestrates: push the
// prospects in as leads and enrol them in a pre-built campaign, then activate it.
// Engagement flows back to Xphere via the /api/integrations/xmail/events webhook.

import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import {
  isXmailConfigured,
  xmailBulkImportLeads,
  xmailListCampaigns,
  xmailListEmailAccounts,
  xmailAddLeadsToCampaign,
  xmailActivateCampaign,
  xmailNotifyVerificationComplete,
  type XmailLead,
} from '@/lib/xmail/client'
import { loadWebsiteInsightsForAccounts } from '@/lib/xmail/website-insights'
import { loadSourceRunIdsForEntities } from '@/lib/xmail/source-runs'
import { isDndBlocked, loadEmailSuppressions, normalizeOutreachEmail } from '@/lib/prospects/outreach-eligibility'
import { matchesFranchiseBrand } from '@/lib/prospects/franchise-brands'
import { isPlatformEmail } from '@/lib/prospects/platform-emails'
import type { WebsiteInsights } from '@/services/website-analyzer/outreach-insights'
import {
  verifyProspectsBatch,
  riskForStatus,
  type BatchAggregate,
  type EmailVerified,
  type EmailRisk,
  type EmailStatus,
  type ProspectKind,
  type VerificationProvider,
  type VerifyEmailResult,
} from '@/lib/email-verification/verify'
import { getMillionVerifierCredits } from '@/lib/email-verification/credits'
import type { McpToolDef } from '../tool-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  return createServiceRoleClient()
}

const DEFAULT_MAX = 100
const HARD_MAX = 300

// prospects_verify (Fase 34) has its own, larger cap: it's read/verify-only
// (no lead import, no Xmail campaign write), so a bigger batch is cheap.
const VERIFY_DEFAULT_MAX = 100
const VERIFY_HARD_MAX = 500

const filterShape = {
  score_min: z.number().int().min(0).max(100).optional().describe('Only prospects with score >= this (lead score: higher = more site problems = hotter lead).'),
  score_max: z.number().int().min(0).max(100).optional(),
  source_type: z.string().max(60).optional().describe("Filter by ingestion source, e.g. 'xcraper' for Google-Maps scrapes."),
  kind: z.enum(['person', 'company', 'all']).optional().describe("'company' (scraped businesses), 'person', or 'all'. Default 'all'."),
  qualification: z.enum(['unqualified', 'needs_review', 'qualified']).optional(),
  engagement: z.string().max(40).optional().describe("e.g. 'not_contacted' to skip anyone already enrolled/contacted."),
  web_presence: z.enum(['owned_website', 'no_owned_website', 'booking_platform', 'social_profile', 'directory_listing', 'link_hub', 'none']).optional()
    .describe("Company web presence. Use 'no_owned_website' for every business without an independent domain, or an exact type such as 'booking_platform' or 'none'."),
  booking_platform: z.string().trim().min(1).max(80).optional()
    .describe("Only companies using this booking provider, e.g. 'Booksy', 'TheCut', or 'GlossGenius'."),
}

type Filters = {
  score_min?: number
  score_max?: number
  source_type?: string
  kind?: 'person' | 'company' | 'all'
  qualification?: 'unqualified' | 'needs_review' | 'qualified'
  engagement?: string
  web_presence?: 'owned_website' | 'no_owned_website' | 'booking_platform' | 'social_profile' | 'directory_listing' | 'link_hub' | 'none'
  booking_platform?: string
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
  phone: string | null
  address: string | null
  location: string | null
  city: string | null
  has_owned_website?: boolean | null
  web_presence_type?: string | null
  web_presence_url?: string | null
  web_presence_platform?: string | null
  booking_platform?: string | null
  booking_url?: string | null
  emailDndBlocked?: boolean
  /** Persisted verification (migration 1264) — read directly, never re-verified by the import tool. */
  email_status?: string | null
  email_verified_at?: string | null
  email_verification_provider?: string | null
  email_risk?: string | null
  /** Import-staging marker (migration 1299) — set once prospects_import_to_xmail pushes this row into Xmail. */
  xmail_imported_at?: string | null
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function presenceSummary(prospects: ResolvedProspect[]) {
  const companies = prospects.filter((prospect) => prospect.kind === 'company')
  const byType: Record<string, number> = {}
  const bookingPlatforms: Record<string, number> = {}
  for (const prospect of companies) {
    const type = prospect.web_presence_type ?? 'unclassified'
    byType[type] = (byType[type] ?? 0) + 1
    if (prospect.booking_platform) {
      bookingPlatforms[prospect.booking_platform] = (bookingPlatforms[prospect.booking_platform] ?? 0) + 1
    }
  }
  const owned = companies.filter((prospect) => prospect.has_owned_website === true).length
  return {
    companies: companies.length,
    owned_website: owned,
    no_owned_website: companies.filter((prospect) => prospect.has_owned_website === false).length,
    unclassified: companies.filter((prospect) => prospect.has_owned_website === null).length,
    by_type: byType,
    booking_platforms: bookingPlatforms,
  }
}

function composeName(r: { first_name?: string | null; last_name?: string | null; name?: string | null }): string | null {
  const composed = [r.first_name, r.last_name].filter(Boolean).join(' ').trim()
  return composed || r.name?.trim() || null
}

function splitName(name: string | null): { firstName: string | null; lastName: string | null } {
  if (!name) return { firstName: null, lastName: null }
  const parts = name.trim().split(/\s+/)
  return { firstName: parts[0] ?? null, lastName: parts.slice(1).join(' ') || null }
}

/** Companies have no email column; the scraped email (enriched runs only) lives in custom_fields.email. */
export function emailFromCustomFields(cf: unknown): string | null {
  if (!cf || typeof cf !== 'object') return null
  const e = (cf as Record<string, unknown>).email
  return typeof e === 'string' && e.includes('@') ? e.trim() : null
}

/** ResolvedProspect.kind ('person'|'company') -> the verification/resolver vocabulary ('contact'|'account'). */
function verificationKind(kind: 'person' | 'company'): ProspectKind {
  return kind === 'company' ? 'account' : 'contact'
}

export function toXmailLead(
  p: ResolvedProspect,
  verification: EmailVerified,
  websiteInsights?: WebsiteInsights,
  sourceRunId?: string,
): XmailLead {
  // xphere_kind must use the resolver's vocabulary ('contact' | 'account'), not
  // the prospect's own 'person' | 'company' kind — see resolveProspectEntity in
  // src/lib/prospects/events.ts.
  const xphereKind = verificationKind(p.kind)
  // Contract with Xmail: these 4 fields map onto leads.emailVerificationStatus
  // (ok -> verified; catch_all|unknown -> likely; invalid|disposable|bounced -> invalid).
  const customFields = {
    xphere_id: p.id,
    xphere_kind: xphereKind,
    score: p.score,
    source_type: p.source_type,
    email_status: verification.status,
    email_verified_at: verification.verifiedAt,
    email_verification_provider: verification.provider,
    email_risk: verification.risk,
    // Web-presence + booking signal (Fase 37): always sent, even when null,
    // so Xmail's sequence copy can distinguish "no owned website" (send the
    // "no website" pitch) from "we never looked" (both are p.* null for a
    // person, since these are company-only fields).
    has_owned_website: p.has_owned_website ?? null,
    web_presence_type: p.web_presence_type ?? null,
    booking_platform: p.booking_platform ?? null,
    booking_url: p.booking_url ?? null,
    ...(websiteInsights ? { websiteInsights } : {}),
    // Lets Xmail attribute outcomes for this lead back to the prospecting run
    // that sourced it (see xmailRegisterExternalRun). Omitted entirely — not
    // sent as null — when no run could be resolved.
    ...(sourceRunId ? { source_run_id: sourceRunId } : {}),
  }
  if (p.kind === 'company') {
    return {
      email: p.email as string,
      companyName: p.name ?? undefined,
      phone: p.phone ?? undefined,
      location: p.location ?? undefined,
      website: p.website ?? undefined,
      customFields,
    }
  }
  const { firstName, lastName } = splitName(p.name)
  return {
    email: p.email as string,
    firstName: firstName ?? undefined,
    lastName: lastName ?? undefined,
    phone: p.phone ?? undefined,
    location: p.location ?? undefined,
    website: p.website ?? undefined,
    customFields,
  }
}

/** Shape the enroll/dry-run response's verification breakdown from a batch aggregate. */
function summarizeAggregate(aggregate: BatchAggregate) {
  return {
    verified_ok: aggregate.ok,
    catch_all: aggregate.catch_all,
    unknown: aggregate.unknown,
    blocked_invalid: aggregate.invalid + aggregate.disposable + aggregate.bounced,
    // Booking-platform address (help.us@booksy.com...): skipped by rule, no credit spent.
    blocked_platform_email: aggregate.platform_email,
    blocked_no_credits: aggregate.blocked,
  }
}

async function resolveProspects(
  orgId: string,
  f: Filters,
  opts: { requireEmail?: boolean; cap?: number; sourceIds?: string[] | null } = {},
): Promise<ResolvedProspect[]> {
  const cap = opts.cap ?? 1000
  const kind = f.kind ?? 'all'
  const presenceFilterActive = Boolean(f.web_presence || f.booking_platform)
  const wantPeople = !presenceFilterActive && (kind === 'all' || kind === 'person')
  const wantCompanies = kind === 'all' || kind === 'company'
  const out: ResolvedProspect[] = []

  if (wantPeople) {
    let q = db()
      .from('contacts')
      .select('id, first_name, last_name, name, email, phone, custom_fields, score, source_type, engagement_status, dnd_enabled, dnd_channels, email_status, email_verified_at, email_verification_provider, email_risk, xmail_imported_at')
      .eq('org_id', orgId)
      .eq('lifecycle_stage', 'prospect')
      .limit(cap)
    if (f.score_min != null) q = q.gte('score', f.score_min)
    if (f.score_max != null) q = q.lte('score', f.score_max)
    if (f.source_type) q = q.eq('source_type', f.source_type)
    if (f.qualification) q = q.eq('qualification_status', f.qualification)
    if (f.engagement) q = q.eq('engagement_status', f.engagement)
    if (opts.requireEmail) q = q.not('email', 'is', null)
    if (opts.sourceIds) q = q.in('prospect_source_id', opts.sourceIds)
    const { data } = await q
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      const customFields = r.custom_fields && typeof r.custom_fields === 'object' && !Array.isArray(r.custom_fields)
        ? r.custom_fields as Record<string, unknown>
        : {}
      const address = stringField(customFields.address) ?? stringField(customFields.location)
      out.push({
        kind: 'person',
        id: r.id as string,
        name: composeName(r as { first_name?: string | null; last_name?: string | null; name?: string | null }),
        email: (r.email as string | null) ?? null,
        score: (r.score as number | null) ?? 0,
        source_type: (r.source_type as string | null) ?? null,
        engagement_status: r.engagement_status as string,
        website: null,
        phone: stringField(r.phone),
        address,
        location: address,
        city: stringField(customFields.city),
        has_owned_website: null,
        web_presence_type: null,
        web_presence_url: null,
        web_presence_platform: null,
        booking_platform: null,
        booking_url: null,
        emailDndBlocked: isDndBlocked(
          r.dnd_enabled as boolean | null,
          r.dnd_channels as string[] | null,
          'email',
        ),
        email_status: (r.email_status as string | null) ?? null,
        email_verified_at: (r.email_verified_at as string | null) ?? null,
        email_verification_provider: (r.email_verification_provider as string | null) ?? null,
        email_risk: (r.email_risk as string | null) ?? null,
        xmail_imported_at: (r.xmail_imported_at as string | null) ?? null,
      })
    }
  }

  if (wantCompanies) {
    let q = db()
      .from('accounts')
      .select('id, name, domain, website, phone, address, score, source_type, engagement_status, custom_fields, email_status, email_verified_at, email_verification_provider, email_risk, xmail_imported_at')
      .eq('org_id', orgId)
      .eq('lifecycle_stage', 'prospect')
      .limit(cap)
    if (f.score_min != null) q = q.gte('score', f.score_min)
    if (f.score_max != null) q = q.lte('score', f.score_max)
    if (f.source_type) q = q.eq('source_type', f.source_type)
    if (f.qualification) q = q.eq('qualification_status', f.qualification)
    if (f.engagement) q = q.eq('engagement_status', f.engagement)
    if (f.web_presence === 'no_owned_website') {
      q = q.contains('custom_fields', { has_owned_website: false })
    } else if (f.web_presence) {
      q = q.eq('custom_fields->>web_presence_type', f.web_presence)
    }
    if (f.booking_platform) q = q.ilike('custom_fields->>booking_platform', f.booking_platform)
    if (opts.sourceIds) q = q.in('prospect_source_id', opts.sourceIds)
    const { data } = await q
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      const email = emailFromCustomFields(r.custom_fields)
      const customFields = r.custom_fields && typeof r.custom_fields === 'object' && !Array.isArray(r.custom_fields)
        ? r.custom_fields as Record<string, unknown>
        : {}
      const storedWebsite = (r.domain as string | null) ?? (r.website as string | null) ?? null
      const address = stringField(r.address) ?? stringField(customFields.address) ?? stringField(customFields.location)
      const hasOwnedWebsite = typeof customFields.has_owned_website === 'boolean'
        ? customFields.has_owned_website
        : storedWebsite
          ? true
          : null
      if (opts.requireEmail && !email) continue
      out.push({
        kind: 'company',
        id: r.id as string,
        name: (r.name as string | null) ?? null,
        email,
        score: (r.score as number | null) ?? 0,
        source_type: (r.source_type as string | null) ?? null,
        engagement_status: r.engagement_status as string,
        website: storedWebsite,
        phone: stringField(r.phone),
        address,
        location: address,
        city: stringField(customFields.city),
        has_owned_website: hasOwnedWebsite,
        web_presence_type: stringField(customFields.web_presence_type) ?? (hasOwnedWebsite ? 'owned_website' : null),
        web_presence_url: stringField(customFields.web_presence_url) ?? storedWebsite,
        web_presence_platform: stringField(customFields.web_presence_platform),
        booking_platform: stringField(customFields.booking_platform),
        booking_url: stringField(customFields.booking_url),
        emailDndBlocked: false,
        email_status: (r.email_status as string | null) ?? null,
        email_verified_at: (r.email_verified_at as string | null) ?? null,
        email_verification_provider: (r.email_verification_provider as string | null) ?? null,
        email_risk: (r.email_risk as string | null) ?? null,
        xmail_imported_at: (r.xmail_imported_at as string | null) ?? null,
      })
    }
  }

  out.sort((a, b) => b.score - a.score)
  if (!opts.requireEmail) return out

  const suppressedEmails = await loadEmailSuppressions(db(), orgId, out.map((prospect) => prospect.email))
  return out.filter((prospect) => {
    const email = normalizeOutreachEmail(prospect.email)
    return Boolean(email && !prospect.emailDndBlocked && !suppressedEmails.has(email))
  })
}

/** Mark enrolled prospects as contacted + log a timeline event (bulk). */
async function markEnrolled(orgId: string, recipients: ResolvedProspect[], campaignId: string): Promise<void> {
  const nowIso = new Date().toISOString()
  const contactIds = recipients.filter((p) => p.kind === 'person').map((p) => p.id)
  const accountIds = recipients.filter((p) => p.kind === 'company').map((p) => p.id)
  if (contactIds.length) {
    await db().from('contacts').update({ engagement_status: 'contacted', last_contacted_at: nowIso, updated_at: nowIso }).in('id', contactIds)
  }
  if (accountIds.length) {
    await db().from('accounts').update({ engagement_status: 'contacted', last_contacted_at: nowIso, updated_at: nowIso }).in('id', accountIds)
  }
  await db()
    .from('prospect_engagement_events')
    .insert(
      recipients.map((p) => ({
        org_id: orgId,
        entity_type: p.kind === 'person' ? 'contact' : 'account',
        entity_id: p.id,
        event_type: 'contacted',
        source_platform: 'xmail',
        payload: { xmail_campaign: campaignId, action: 'enrolled' },
      })),
    )
}

// ── prospects_verify (Fase 34) ──────────────────────────────────────────────
//
// Verification-only: filters by external_run_id and/or source_type (never
// campaign_id), reuses verifyProspectsBatch, and never enrolls or sends.
// Before this, the only thing that verified anything was
// prospects_enroll_in_campaign's dry run (confirmed omitted) — it has no
// per-run filter, so a 98-prospect verification across three runs had to be
// split back apart by created_at window in the database.

type VerifiableProspect = { kind: 'person' | 'company'; id: string; email: string }

/**
 * Resolves `external_run_id` (+ optional `source_type`) to the matching
 * `prospect_sources` row(s) (id + metadata) for this org. Returns `null` when
 * `external_run_id` was given but nothing matches -- the caller distinguishes
 * "no such run" from "run exists, nothing eligible in it".
 *
 * Fetches `metadata` alongside `id` so callers needing xcraper-reported run
 * metadata (e.g. `emails_lost_to_placeholder`, see `extractPlaceholdersRejected`)
 * can reuse this lookup instead of re-querying `prospect_sources`.
 */
async function resolveProspectSources(
  orgId: string,
  externalRunId: string,
  sourceType?: string,
): Promise<Array<{ id: string; metadata: unknown }> | null> {
  let q = db().from('prospect_sources').select('id, metadata').eq('org_id', orgId).eq('external_run_id', externalRunId)
  if (sourceType) q = q.eq('source_type', sourceType)
  const { data } = await q
  const rows = (data ?? []) as Array<{ id: string; metadata: unknown }>
  return rows.length > 0 ? rows : null
}

/**
 * Reads xcraper's `emails_lost_to_placeholder` metric (businesses that ended
 * up with NO contact email because the only address on offer was
 * website-template filler, e.g. `filler@godaddy.com`) from a resolved
 * `prospect_sources` row's metadata. Renamed from `emails_rejected_as_placeholder`
 * on the Xcraper side -- do not look for the old key.
 *
 * Returns `undefined` (not 0) when the key is absent or not a finite number,
 * so "not measured" stays distinguishable from a measured zero -- the caller
 * must omit `placeholdersRejected` from the Xmail payload in that case, never
 * send a fabricated 0.
 */
function extractPlaceholdersRejected(rows: Array<{ metadata: unknown }>): number | undefined {
  for (const row of rows) {
    const metadata = row.metadata
    if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
      const value = (metadata as Record<string, unknown>).emails_lost_to_placeholder
      if (typeof value === 'number' && Number.isFinite(value)) return value
    }
  }
  return undefined
}

/**
 * Loads up to `cap` prospects (contacts + accounts) with a usable email,
 * filtered by run and/or source type.
 *
 * Filtering by run uses `contacts.prospect_source_id` / `accounts.
 * prospect_source_id` (migration 1298) directly -- a straight `IN` filter,
 * not the entity -> event -> source indirection `loadSourceRunIdsForEntities`
 * (src/lib/xmail/source-runs.ts) needs for the reverse direction (one
 * prospect -> its run). Rows ingested before migration 1298 have a NULL
 * `prospect_source_id` and are only reachable via `source_type`.
 */
async function loadVerifiableProspects(
  orgId: string,
  filters: { externalRunId?: string; sourceType?: string },
  cap: number,
): Promise<{ prospects: VerifiableProspect[]; placeholdersRejected?: number } | { notFound: true }> {
  let sourceIds: string[] | null = null
  let placeholdersRejected: number | undefined
  if (filters.externalRunId) {
    const sources = await resolveProspectSources(orgId, filters.externalRunId, filters.sourceType)
    if (!sources) return { notFound: true }
    sourceIds = sources.map((row) => row.id)
    placeholdersRejected = extractPlaceholdersRejected(sources)
  }

  let contactsQuery = db()
    .from('contacts')
    .select('id, email, created_at')
    .eq('org_id', orgId)
    .eq('lifecycle_stage', 'prospect')
    .not('email', 'is', null)
  let accountsQuery = db()
    .from('accounts')
    .select('id, custom_fields, created_at')
    .eq('org_id', orgId)
    .eq('lifecycle_stage', 'prospect')

  if (sourceIds) {
    contactsQuery = contactsQuery.in('prospect_source_id', sourceIds)
    accountsQuery = accountsQuery.in('prospect_source_id', sourceIds)
  } else if (filters.sourceType) {
    contactsQuery = contactsQuery.eq('source_type', filters.sourceType)
    accountsQuery = accountsQuery.eq('source_type', filters.sourceType)
  }

  const [{ data: contactRows }, { data: accountRows }] = await Promise.all([
    contactsQuery.order('created_at', { ascending: true }).limit(cap),
    accountsQuery.order('created_at', { ascending: true }).limit(cap),
  ])

  const withCreatedAt: Array<VerifiableProspect & { createdAt: string }> = []
  for (const row of (contactRows ?? []) as Array<{ id: string; email: string | null; created_at: string }>) {
    if (row.email) withCreatedAt.push({ kind: 'person', id: row.id, email: row.email, createdAt: row.created_at })
  }
  for (const row of (accountRows ?? []) as Array<{ id: string; custom_fields: unknown; created_at: string }>) {
    const email = emailFromCustomFields(row.custom_fields)
    if (email) withCreatedAt.push({ kind: 'company', id: row.id, email, createdAt: row.created_at })
  }

  withCreatedAt.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return {
    prospects: withCreatedAt.slice(0, cap).map(({ kind, id, email }) => ({ kind, id, email })),
    placeholdersRejected,
  }
}

/** batch.aggregate breakdown -> the exact field names prospects_verify returns. */
export function verifyOutputCounts(aggregate: BatchAggregate) {
  return {
    ok: aggregate.ok,
    catch_all: aggregate.catch_all,
    unknown: aggregate.unknown,
    invalid: aggregate.invalid,
    disposable: aggregate.disposable,
    bounced: aggregate.bounced,
    // Booksy/Vagaro/... support addresses recorded as the shop's own email: never sent to a
    // provider (no credit), persisted as invalid/platform_rule. Not included in `invalid`.
    platform_email: aggregate.platform_email,
    blocked_no_credits: aggregate.blocked,
  }
}

/** Every non-blocked result's provider -> 'millionverifier' | 'neverbounce' | 'mixed'.
 *  Defaults to 'millionverifier' (the primary provider) when nothing verified at all —
 *  the field is required downstream (Xmail's contract) and there is no "none" value. */
export function resolveVerificationProvider(results: Array<{ result: VerifyEmailResult }>): 'millionverifier' | 'neverbounce' | 'mixed' {
  const providers = new Set<string>()
  for (const r of results) {
    // 'platform_rule' is our own rule, not a vendor: Xmail's contract only knows the two providers.
    if (!('blocked' in r.result) && r.result.provider !== 'platform_rule') providers.add(r.result.provider)
  }
  if (providers.size === 0) return 'millionverifier'
  if (providers.size === 1) return [...providers][0] as 'millionverifier' | 'neverbounce'
  return 'mixed'
}

// ── prospects_import_to_xmail core (Fase 37, extracted for reuse) ──────────
//
// Factored out of the tool handler so src/app/api/cron/prospect-verify-tick's
// auto-import step (Item 1, 2026-09-30: verified prospects were sitting in
// Xphere with email_status='ok' waiting for someone to run this tool by
// hand) calls the SAME rules instead of re-implementing them: only
// email_status='ok' is ever imported, catch_all/unknown/unverified/invalid
// are held back and counted (never silently dropped), and an already-staged
// prospect (xmail_imported_at set) is skipped.

type HeldBack = {
  catch_all: number
  unknown: number
  unverified: number
  invalid: number
  /** Item 3(a), 2026-09-30. */
  shared_email: number
  /** Item 3(b), 2026-09-30. */
  franchise: number
  /** 2026-10-07: booking-platform address (booksy.com...), held back whatever its email_status. */
  platform_email: number
}

type RetainedForReview = {
  name: string | null
  email: string
  reason: 'platform_email' | 'shared_email' | 'franchise'
  matched_brand?: string
  distinct_businesses?: number
}

type ImportCandidates = {
  matched: ResolvedProspect[]
  alreadyImported: ResolvedProspect[]
  importable: ResolvedProspect[]
  heldBack: HeldBack
  capped: ResolvedProspect[]
  retained: RetainedForReview[]
}

// ── Item 3(a): shared_email — retain a platform/franchise-style support
// address used by 3+ distinct businesses ─────────────────────────────────
//
// Measured (2026-09-30): help.us@booksy.com was recorded as the contact
// email of 11 DIFFERENT scraped barbershops (already blocked as a platform
// domain elsewhere in the pipeline — Xmail's bulk-import platform-email
// filter and Xcraper's own filter both catch booksy.com support addresses —
// but the underlying "one email, many businesses" pattern isn't specific to
// booksy.com; a self-hosted shared address, e.g. a franchisor's or a
// management company's, would slip past a domain-based filter entirely).
// Threshold is 3, not 2, because two DIFFERENT listings for the SAME
// business must not count as two distinct businesses: "ATM (Roslindale
// Barbershop)" and "Roslindale Barbershop" are one shop recorded twice under
// slightly different names, both sharing roslindalebarbershop@live.com — at
// a threshold of 2 that single business would itself trip the "shared"
// flag and get blocked from ever importing normally. 3 is the smallest
// threshold clear of that false positive while still catching genuinely
// shared addresses.
//
// businessIdentityKey() is what makes the Roslindale case collapse to one
// business: it prefers the site/domain (most reliable) and only falls back
// to a normalized name — with a preference for whatever is inside
// parentheses, since Google Maps listings sometimes record a business as
// "OLD NAME (CURRENT NAME)" — when neither record has a site on file, which
// is the common case for these small businesses (see `no_owned_website` in
// prospects_list's web_presence filter).

function normalizeBusinessName(raw: string | null): string {
  if (!raw) return ''
  const paren = raw.match(/\(([^)]+)\)/)
  const core = paren ? paren[1] : raw
  return core.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function normalizeSite(site: string | null): string {
  if (!site) return ''
  return site
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
}

/** Identifies a "business" for shared-email counting: same site/domain (when
 *  either record has one) always wins over name text, so differently-spelled
 *  listings of the same shop collapse into one. Falls back to the normalized
 *  (parenthetical-preferring) name only when neither has a site on file. */
function businessIdentityKey(name: string | null, site: string | null): string {
  const normalizedSite = normalizeSite(site)
  return normalizedSite ? `site:${normalizedSite}` : `name:${normalizeBusinessName(name)}`
}

/**
 * Counts, for each candidate email (lowercased), how many DISTINCT businesses
 * in this org have that email on file — scoped to company (account)
 * prospects, since the measured pattern (Booksy, franchise HQs) is a
 * business-support address, not a person's. Looks at every company prospect
 * in the org, not just the current filtered batch: a shared address can
 * appear across many different scrape runs, so counting only within one
 * run's batch would undercount it (exactly the Booksy case — no single run
 * scraped all 11 shops at once). Returns only the emails whose count meets
 * the >=3 threshold — see the comment above this function for why.
 */
async function detectSharedEmailCounts(orgId: string, candidateEmails: string[]): Promise<Map<string, number>> {
  const candidateSet = new Set(candidateEmails.map((email) => email.toLowerCase()))
  if (candidateSet.size === 0) return new Map()

  const { data } = await db()
    .from('accounts')
    .select('name, website, domain, custom_fields')
    .eq('org_id', orgId)
    .eq('lifecycle_stage', 'prospect')

  const businessKeysByEmail = new Map<string, Set<string>>()
  for (const row of (data ?? []) as Array<{ name: string | null; website: string | null; domain: string | null; custom_fields: unknown }>) {
    const email = emailFromCustomFields(row.custom_fields)
    if (!email) continue
    const normalizedEmail = email.toLowerCase()
    if (!candidateSet.has(normalizedEmail)) continue
    const key = businessIdentityKey(row.name, row.domain ?? row.website)
    const keys = businessKeysByEmail.get(normalizedEmail) ?? new Set<string>()
    keys.add(key)
    businessKeysByEmail.set(normalizedEmail, keys)
  }

  const result = new Map<string, number>()
  for (const [email, keys] of businessKeysByEmail) {
    if (keys.size >= 3) result.set(email, keys.size)
  }
  return result
}

/** Resolves the matched/held-back/importable/capped sets for one import call — no
 *  Xmail call, no DB write. Shared by the dry-run preview, the confirmed handler
 *  branch, and importVerifiedProspectsToXmail below. */
async function resolveImportCandidates(
  orgId: string,
  filters: Filters,
  externalRunId: string | undefined,
  cap: number,
): Promise<ImportCandidates | { notFound: true }> {
  let sourceIds: string[] | null = null
  if (externalRunId) {
    const sources = await resolveProspectSources(orgId, externalRunId, filters.source_type)
    if (!sources) return { notFound: true }
    sourceIds = sources.map((row) => row.id)
  }

  // requireEmail: true reuses the same DND/suppression exclusion prospects_
  // enroll_in_campaign relies on for outreach — a suppressed/DND'd address
  // is not worth staging as a lead either.
  const matched = await resolveProspects(orgId, filters, { requireEmail: true, cap: 2000, sourceIds })

  const heldBack: HeldBack = { catch_all: 0, unknown: 0, unverified: 0, invalid: 0, shared_email: 0, franchise: 0, platform_email: 0 }
  const alreadyImported: ResolvedProspect[] = []
  const retained: RetainedForReview[] = []

  // Pass 0 (2026-10-07): platform address (help.us@booksy.com, ...) — checked before everything
  // else and regardless of email_status, so even a row already verified 'ok' (12 of the 40
  // measured had spent MillionVerifier credits) is held back. A pure domain check, no query;
  // it never touches xmail_imported_at.
  // Pass 1: franchise recognition (company-kind only, no query) — cheaper
  // than the shared-email query below, so it runs first and franchise
  // matches never also occupy a shared-email slot.
  const afterFranchise: ResolvedProspect[] = []
  for (const p of matched) {
    if (isPlatformEmail(p.email)) {
      heldBack.platform_email++
      retained.push({ name: p.name, email: p.email as string, reason: 'platform_email' })
      continue
    }
    if (p.xmail_imported_at) {
      alreadyImported.push(p)
      continue
    }
    const brand = p.kind === 'company' ? matchesFranchiseBrand(p.name, p.email, p.website) : null
    if (brand) {
      heldBack.franchise++
      retained.push({ name: p.name, email: p.email as string, reason: 'franchise', matched_brand: brand })
      continue
    }
    afterFranchise.push(p)
  }

  // Pass 2: shared-email recognition (company-kind only, one query for the
  // whole batch — see detectSharedEmailCounts).
  const companyEmails = afterFranchise
    .filter((p): p is ResolvedProspect & { email: string } => p.kind === 'company' && Boolean(p.email))
    .map((p) => p.email)
  const sharedEmailCounts = await detectSharedEmailCounts(orgId, companyEmails)

  const importable: ResolvedProspect[] = []
  for (const p of afterFranchise) {
    const sharedCount = p.kind === 'company' && p.email ? sharedEmailCounts.get(p.email.toLowerCase()) : undefined
    if (sharedCount) {
      heldBack.shared_email++
      retained.push({ name: p.name, email: p.email as string, reason: 'shared_email', distinct_businesses: sharedCount })
      continue
    }
    switch (p.email_status) {
      case 'ok':
        importable.push(p)
        break
      case 'catch_all':
        heldBack.catch_all++
        break
      case 'unknown':
        heldBack.unknown++
        break
      case 'invalid':
      case 'disposable':
      case 'bounced':
        heldBack.invalid++
        break
      default:
        // null/undefined: never verified.
        heldBack.unverified++
    }
  }

  const capped = importable.slice(0, cap)
  return { matched, alreadyImported, importable, heldBack, capped, retained }
}

/** Shapes the resolveImportCandidates result into the response `summary` fields
 *  (matched/already_imported/importable/held_back/capped/sample) shared by the
 *  dry-run and confirmed responses, plus the held-back note appended to messages. */
function buildImportSummary(candidates: ImportCandidates, cap: number) {
  const { matched, alreadyImported, importable, heldBack, capped: cappedList, retained } = candidates
  const heldBackNotes: string[] = []
  if (heldBack.platform_email) {
    heldBackNotes.push(`${heldBack.platform_email} platform_email (booking-platform address such as booksy.com, never the business's own) held back and never verified — see retained_for_review`)
  }
  if (heldBack.catch_all || heldBack.unknown) {
    heldBackNotes.push(`${heldBack.catch_all} catch_all and ${heldBack.unknown} unknown held back for a human decision`)
  }
  if (heldBack.unverified) {
    heldBackNotes.push(`${heldBack.unverified} never verified — run prospects_verify first`)
  }
  if (heldBack.invalid) {
    heldBackNotes.push(`${heldBack.invalid} invalid/disposable/bounced excluded`)
  }
  if (heldBack.shared_email) {
    heldBackNotes.push(`${heldBack.shared_email} shared_email (same address on 3+ distinct businesses) held back for a human decision — see retained_for_review`)
  }
  if (heldBack.franchise) {
    heldBackNotes.push(`${heldBack.franchise} franchise location(s) held back — see retained_for_review`)
  }
  const heldBackSuffix = heldBackNotes.length ? ` ${heldBackNotes.join('; ')}.` : ''
  return {
    summary: {
      matched: matched.length,
      already_imported: alreadyImported.length,
      importable: importable.length,
      held_back: heldBack,
      capped:
        importable.length > cap
          ? { total_importable: importable.length, cap, remaining: importable.length - cap }
          : undefined,
      sample: cappedList.slice(0, 5).map((p) => ({ name: p.name, email: p.email, score: p.score, email_status: p.email_status })),
      // Item 3, 2026-09-30: never a silent drop, same as catch_all/unknown —
      // capped so a large shared-email/franchise batch doesn't blow up the response.
      retained_for_review: retained.length > 0 ? retained.slice(0, 10) : undefined,
    },
    heldBackSuffix,
  }
}

/** Pushes an already-resolved, already-capped set of email_status='ok' prospects to
 *  Xmail and stamps xmail_imported_at on the affected rows. Never enrols, never
 *  activates a campaign. */
async function pushCappedToXmail(
  orgId: string,
  capped: ResolvedProspect[],
  externalRunId: string | undefined,
): Promise<{ error: string } | { imported: number; retainedPlatformEmail: number }> {
  const service = db()
  const websiteInsights = await loadWebsiteInsightsForAccounts(
    service,
    orgId,
    capped.filter((p) => p.kind === 'company').map((p) => p.id),
  )
  // When filtering by a specific external_run_id, that IS the source run
  // for every prospect returned — more reliable than the indirect
  // event-based join, and skips a query. Only fall back to the indirect
  // lookup when filtering by source_type alone (many runs possible).
  const sourceRunIds = externalRunId
    ? new Map(capped.map((p) => [p.id, externalRunId] as const))
    : await loadSourceRunIdsForEntities(service, orgId, capped.map((p) => p.id))

  const leads = capped.map((p) => {
    const verification: EmailVerified = {
      status: (p.email_status as EmailStatus) ?? 'ok',
      risk: (p.email_risk as EmailRisk) ?? riskForStatus('ok'),
      provider: (p.email_verification_provider as VerificationProvider) ?? 'millionverifier',
      verifiedAt: p.email_verified_at ?? new Date().toISOString(),
      cached: true,
    }
    return toXmailLead(p, verification, websiteInsights.get(p.id), sourceRunIds.get(p.id))
  })

  const imp = await xmailBulkImportLeads(leads)
  if (!imp.ok) return { error: `Xmail lead import failed: ${imp.error}` }

  // Item 4 (2026-09-30): xmail_imported_at used to get stamped on every
  // submitted prospect, INCLUDING the ones Xmail itself rejected as a
  // platform email (skippedPlatformEmails) — marking a prospect "imported"
  // when Xmail never actually accepted it. Only stamp the ones Xmail
  // accepted or already had (leads[i] <-> capped[i] by index; Xmail
  // lowercases at its boundary, so compare case-insensitively).
  const skippedPlatform = new Set(imp.skippedPlatformEmails.map((email) => email.toLowerCase()))
  const accepted = capped.filter((p, i) => !skippedPlatform.has(leads[i].email.toLowerCase()))
  const retainedPlatformEmail = capped.length - accepted.length

  const nowIso = new Date().toISOString()
  const contactIds = accepted.filter((p) => p.kind === 'person').map((p) => p.id)
  const accountIds = accepted.filter((p) => p.kind === 'company').map((p) => p.id)
  if (contactIds.length) await service.from('contacts').update({ xmail_imported_at: nowIso }).in('id', contactIds)
  if (accountIds.length) await service.from('accounts').update({ xmail_imported_at: nowIso }).in('id', accountIds)

  return { imported: imp.imported, retainedPlatformEmail }
}

/**
 * The confirmed-import core of prospects_import_to_xmail — resolves candidates,
 * pushes the email_status='ok' ones to Xmail, and stamps xmail_imported_at.
 * Exported so src/app/api/cron/prospect-verify-tick/route.ts can call it right
 * after verifying a run (Item 1, 2026-09-30) with the exact same rules the MCP
 * tool enforces: only 'ok' is imported automatically, catch_all/unknown are
 * always retained for a human, and nothing is ever enrolled or activated here.
 */
export async function importVerifiedProspectsToXmail(
  orgId: string,
  filters: Filters,
  opts: { externalRunId?: string; max?: number } = {},
): Promise<Record<string, unknown>> {
  const cap = Math.min(opts.max ?? DEFAULT_MAX, HARD_MAX)
  const resolved = await resolveImportCandidates(orgId, filters, opts.externalRunId, cap)
  if ('notFound' in resolved) {
    return {
      error: 'external_run_not_found',
      detail:
        `No prospect_sources row matches external_run_id "${opts.externalRunId}"` +
        (filters.source_type ? ` with source_type "${filters.source_type}"` : '') +
        ' in this org.',
    }
  }
  const { matched, capped } = resolved
  const { summary, heldBackSuffix } = buildImportSummary(resolved, cap)

  if (capped.length === 0) {
    return {
      imported: 0,
      ...summary,
      message:
        matched.length === 0
          ? 'No prospects matched these filters.'
          : `Nothing to import: no prospects in this selection have email_status="ok".${heldBackSuffix}`,
    }
  }

  if (!isXmailConfigured()) {
    return { error: 'Xmail outreach is not wired up (XMAIL_API_URL / XMAIL_USER_ID / XMAIL_ORG_ID / XMAIL_SERVICE_KEY not set).' }
  }

  const pushed = await pushCappedToXmail(orgId, capped, opts.externalRunId)
  if ('error' in pushed) return { error: pushed.error, ...summary }

  // Item 4 (2026-09-30): a submitted prospect Xmail itself rejected as a
  // platform email is retained (no xmail_imported_at) rather than counted
  // as imported — reported here the same way catch_all/unknown are, never
  // silently folded into `imported`.
  const platformSuffix = pushed.retainedPlatformEmail > 0
    ? ` ${pushed.retainedPlatformEmail} retained as platform_email (Xmail rejected the address) — held back, not counted as imported.`
    : ''

  return {
    imported: pushed.imported,
    ...summary,
    ...(pushed.retainedPlatformEmail > 0 ? { retained_platform_email: pushed.retainedPlatformEmail } : {}),
    message:
      `Imported ${pushed.imported} prospect(s) into Xmail as lead(s). Nothing was enrolled or activated — call prospects_enroll_in_campaign next (with its own confirmed:true) to start outreach.${heldBackSuffix}${platformSuffix}`,
  }
}

export const prospectsTools: McpToolDef[] = [
  {
    name: 'prospects_list',
    title: 'List / preview prospects',
    description:
      "List prospects (lifecycle_stage='prospect') with score/source filters, sorted by score (hottest first). Use this to PREVIEW an outreach audience before enrolling — it reports how many match and how many have a usable email. Always run this first and show the human the count before calling prospects_enroll_in_campaign. Rows whose email belongs to a booking platform (booksy.com, vagaro.com, ...) carry platform_email:true and are counted in the top-level platform_email: that is the platform's support address, not the business's, so it is never verified, imported or enrolled.",
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
      const rawWithEmail = all.filter((p) => p.email)
      const withEmail = await resolveProspects(auth.orgId, input, { requireEmail: true })
      const pool = input.has_email ? withEmail : all
      const limit = input.limit ?? 50
      const offset = input.offset ?? 0
      return {
        total: all.length,
        with_email: withEmail.length,
        blocked_from_email: rawWithEmail.length - withEmail.length,
        // Subset of with_email whose address belongs to a booking platform (booksy.com...): not the
        // business's own mailbox, so it is never verified, imported or enrolled. Each row below
        // carries the same flag as `platform_email`.
        platform_email: withEmail.filter((p) => isPlatformEmail(p.email)).length,
        web_presence_summary: presenceSummary(all),
        emailable_note:
          withEmail.length === 0 && all.length > 0
            ? rawWithEmail.length > 0
              ? 'Every prospect with an email is blocked by Xphere DND or email suppression. Nothing can be enrolled.'
              : 'None of these have an email — they were scraped "standard" (no email extraction). Re-scrape with scrapeType "enriched" to get emails before outreach.'
            : undefined,
        prospects: pool.slice(offset, offset + limit).map((p) => ({ ...p, platform_email: isPlatformEmail(p.email) })),
        limit,
        offset,
      }
    },
  },
  {
    name: 'xmail_outreach_status',
    title: 'List Xmail campaigns + sending inboxes',
    description:
      'List the Xmail outreach campaigns (id, name, status) and verified sending inboxes (email accounts) available to enrol prospects into. Use this to pick a campaign_id (and optionally an email_account_id) before calling prospects_enroll_in_campaign. If it returns no campaigns or no inboxes, the human still has to set those up in Xmail.',
    area: 'general_xphere',
    inputSchema: z.object({}).strict(),
    handler: async () => {
      if (!isXmailConfigured()) {
        return { error: 'Xmail outreach is not wired up (XMAIL_API_URL / XMAIL_USER_ID / XMAIL_ORG_ID not set).' }
      }
      const [camps, accts] = await Promise.all([xmailListCampaigns(), xmailListEmailAccounts()])
      return {
        campaigns: camps.ok ? camps.campaigns : [],
        campaigns_error: camps.ok ? undefined : camps.error,
        email_accounts: accts.ok ? accts.accounts : [],
        email_accounts_error: accts.ok ? undefined : accts.error,
        note:
          (camps.ok && camps.campaigns.length === 0 ? 'No campaigns yet — create one in Xmail (with a sequence). ' : '') +
          (accts.ok && accts.accounts.length === 0 ? 'No sending inbox yet — add a verified email account in Xmail.' : '') || undefined,
      }
    },
  },
  {
    name: 'prospects_enroll_in_campaign',
    title: 'Enrol already-imported prospects into an Xmail campaign (starts sending)',
    description:
      "Enrol prospects matching the filters into an existing Xmail outreach campaign, and activate it so Xmail STARTS SENDING REAL EMAIL. This is the only tool that can start outreach — it requires the matching prospects to already be staged in Xmail (via prospects_import_to_xmail); prospects that have not been imported yet are skipped, not auto-imported, and both the dry run and the confirmed result report how many were skipped for that reason and name prospects_import_to_xmail as the step to run first. SAFETY: only runs when confirmed:true — first call prospects_list to preview the count and xmail_outreach_status to pick the campaign, tell the human, and only set confirmed:true after they approve. Xmail handles the actual sending, sequences, suppression and tracking. Caps at " + HARD_MAX + " prospects per call. NOTE: the dry run (confirmed omitted) DOES verify emails as a side effect, but it has no per-run filter and never persists a verification summary against a run — for verification-only work (nothing to enrol yet, or you just want the numbers for one scrape run), use prospects_verify instead.",
    area: 'general_xphere',
    annotations: { destructiveHint: true, idempotentHint: false },
    inputSchema: z
      .object({
        ...filterShape,
        campaign_id: z.string().uuid().describe('The Xmail campaign id to enrol into (from xmail_outreach_status).'),
        email_account_id: z.string().uuid().optional().describe('Sending inbox id. If omitted, the first available inbox is used.'),
        max: z.number().int().positive().max(HARD_MAX).optional().describe(`Hard cap on prospects (default ${DEFAULT_MAX}).`),
        confirmed: z.boolean().optional().describe('Must be true to actually enrol + activate. Leave false/absent for a dry run.'),
      })
      .strict(),
    handler: async (input, { auth }) => {
      const { campaign_id, email_account_id, max, confirmed, ...filters } = input
      // Outreach is intentionally one-way: callers may narrow the selection,
      // but they cannot re-enrol a prospect whose CRM engagement has already
      // advanced beyond the initial not_contacted state.
      const outreachFilters = { ...filters, engagement: 'not_contacted' as const }

      if (!confirmed) {
        const preview = await resolveProspects(auth.orgId, outreachFilters, { requireEmail: true })
        const capped = preview.slice(0, max ?? DEFAULT_MAX)
        // Enrolment now requires staged leads (Fase 37): a prospect that was
        // never pushed through prospects_import_to_xmail cannot be enrolled,
        // it must be reported instead — see the confirmed branch below for
        // why the underlying xmailBulkImportLeads call still has to run for
        // already-staged leads (Xmail has no lookup-lead-id-by-email endpoint).
        // A platform address is never staged (import holds it back), so it is not "waiting for
        // import" — it is reported on its own below.
        const platformEmail = capped.filter((p) => isPlatformEmail(p.email)).length
        const notYetImported = capped.filter((p) => !p.xmail_imported_at && !isPlatformEmail(p.email)).length
        const batch = await verifyProspectsBatch(
          auth.orgId,
          capped.map((p) => ({ kind: verificationKind(p.kind), id: p.id, email: p.email as string })),
        )
        const verification = summarizeAggregate(batch.aggregate)
        let wouldEnroll = 0
        capped.forEach((p, i) => {
          if (p.xmail_imported_at && !isPlatformEmail(p.email) && batch.results[i].sendable) wouldEnroll++
        })
        return {
          dry_run: true,
          would_enroll: wouldEnroll,
          matched_with_email: preview.length,
          staged: capped.length - notYetImported - platformEmail,
          not_yet_imported: notYetImported,
          platform_email: platformEmail,
          verification: { total_checked: capped.length, ...verification },
          verification_unavailable: verification.blocked_no_credits > 0 ? true : undefined,
          message:
            verification.blocked_no_credits > 0
              ? `WARNING: email verification is unavailable (no verification credits) for ${verification.blocked_no_credits} of ${capped.length} matching prospect(s) — they will be skipped, not sent unverified. Nothing was enrolled (confirmed was not true).`
              : (notYetImported > 0
                  ? `${notYetImported} of ${capped.length} matching prospect(s) have not been imported into Xmail yet — run prospects_import_to_xmail first (this tool only enrols already-staged leads; it will not import them for you). Nothing was enrolled (confirmed was not true).`
                  : 'Nothing was enrolled (confirmed was not true). Show the human the count and which campaign, then call again with confirmed:true. (Only verifying, with no intent to enrol yet? Use prospects_verify instead — it filters by run and records the result against it.)') +
                (platformEmail > 0
                  ? ` ${platformEmail} of ${capped.length} matching prospect(s) have a booking-platform address (platform_email): they will never be enrolled, and were marked invalid without spending credits.`
                  : ''),
          sample: preview.slice(0, 5).map((p) => ({ name: p.name, email: p.email, score: p.score })),
        }
      }

      if (!isXmailConfigured()) {
        return { error: 'Xmail outreach is not wired up (XMAIL_API_URL / XMAIL_USER_ID / XMAIL_ORG_ID not set).' }
      }

      const cap = Math.min(max ?? DEFAULT_MAX, HARD_MAX)
      const allWithEmail = await resolveProspects(auth.orgId, outreachFilters, { requireEmail: true })
      const candidates = allWithEmail.slice(0, cap)
      if (candidates.length === 0) {
        return { enrolled: 0, message: 'No matching uncontacted prospects have an email to enrol.' }
      }

      // Fase 37: only prospects already staged by prospects_import_to_xmail
      // (xmail_imported_at set) are eligible for enrolment. Anyone matching
      // the filters who has not been imported yet is reported, never
      // auto-imported here — importing used to be this tool's silent side
      // effect and is exactly what let a human approve sending just to get
      // leads staged.
      // A platform address (booksy.com...) is never enrolled, even if it was staged before the rule
      // existed: it is dropped here, before verification, and reported as platform_email.
      const platformEmail = candidates.filter((p) => isPlatformEmail(p.email)).length
      const staged = candidates.filter((p) => p.xmail_imported_at && !isPlatformEmail(p.email))
      const notYetImported = candidates.length - platformEmail - staged.length
      if (staged.length === 0) {
        return {
          enrolled: 0,
          not_yet_imported: notYetImported,
          platform_email: platformEmail || undefined,
          message: `${notYetImported} matching prospect(s) have not been imported into Xmail yet. Run prospects_import_to_xmail first, then retry prospects_enroll_in_campaign with confirmed:true.` +
            (platformEmail > 0 ? ` ${platformEmail} more were skipped as platform_email (booking-platform address, never enrolled).` : ''),
        }
      }

      // Verify every staged candidate's email before it ever reaches Xmail —
      // this is the prospect's source of truth, checked (and cached) once here.
      const batch = await verifyProspectsBatch(
        auth.orgId,
        staged.map((p) => ({ kind: verificationKind(p.kind), id: p.id, email: p.email as string })),
      )
      const verification = summarizeAggregate(batch.aggregate)
      const recipients: Array<{ prospect: ResolvedProspect; verified: EmailVerified }> = []
      staged.forEach((p, i) => {
        const r = batch.results[i]
        if (r.sendable) recipients.push({ prospect: p, verified: r.result as EmailVerified })
      })

      if (recipients.length === 0) {
        return {
          enrolled: 0,
          not_yet_imported: notYetImported || undefined,
          platform_email: platformEmail || undefined,
          verification: { total_checked: staged.length, ...verification },
          verification_unavailable: verification.blocked_no_credits > 0 ? true : undefined,
          message:
            verification.blocked_no_credits > 0
              ? `No prospects were enrolled: email verification is unavailable (no verification credits) for ${verification.blocked_no_credits} of ${staged.length} staged prospect(s), and none of the remainder verified as sendable.`
              : 'No staged prospects passed email verification as sendable (all invalid/disposable/bounced).',
        }
      }

      // Resolve a sending inbox if none was provided (Xmail requires one to
      // activate) — Item 2 (2026-09-30): "the first available inbox" used to
      // mean literally the first row Xmail returned, which could be a work
      // inbox (e.g. info@) that Xmail itself refuses as a campaign sender
      // with 422. Xmail now reports `campaignSenderEligible` per account;
      // only choose among accounts where that is exactly `true` — never
      // guess when it's absent (older Xmail) or when nothing qualifies.
      let inboxId = email_account_id
      if (!inboxId) {
        const accts = await xmailListEmailAccounts()
        if (!accts.ok) {
          return { error: `Could not list Xmail email accounts to pick a sending inbox: ${accts.error}` }
        }
        const eligible = accts.accounts.filter((a) => a.campaignSenderEligible === true)
        if (eligible.length === 0) {
          const fieldReported = accts.accounts.some((a) => a.campaignSenderEligible !== undefined)
          return {
            error: 'no_eligible_sending_inbox',
            detail: fieldReported
              ? "None of this org's email accounts are eligible campaign senders (campaignSenderEligible=false for all of them). Pass email_account_id explicitly once one is eligible."
              : "Xmail did not report campaignSenderEligible for any account (older Xmail?) — cannot safely auto-pick a sending inbox. Pass email_account_id explicitly.",
            email_accounts: accts.accounts.map((a) => ({ id: a.id, email: a.email, campaignSenderEligible: a.campaignSenderEligible })),
          }
        }
        inboxId = eligible[0].id
      } else {
        // email_account_id was given explicitly — refuse up front if Xmail
        // already knows it's not eligible, instead of letting Xmail's own
        // 422 surface later. Best-effort: if the list call itself fails,
        // proceed with the id as given rather than blocking on an unrelated
        // read failure.
        const accts = await xmailListEmailAccounts()
        if (accts.ok) {
          const chosen = accts.accounts.find((a) => a.id === inboxId)
          if (chosen?.campaignSenderEligible === false) {
            return {
              error: 'email_account_not_campaign_eligible',
              detail: `email_account_id ${inboxId} (${chosen.email}) is not eligible to send campaigns (campaignSenderEligible=false) — Xmail would reject this with 422. Pick a different email_account_id.`,
            }
          }
        }
      }

      const service = db()
      const websiteInsights = await loadWebsiteInsightsForAccounts(
        service,
        auth.orgId,
        recipients.filter(r => r.prospect.kind === 'company').map(r => r.prospect.id),
      )
      const sourceRunIds = await loadSourceRunIdsForEntities(
        service,
        auth.orgId,
        recipients.map(r => r.prospect.id),
      )
      // NOTE on why this still calls xmailBulkImportLeads: every recipient
      // here was already staged by prospects_import_to_xmail, so this call
      // is not expected to create any NEW Xmail lead — it upserts by email
      // (idempotent) and is the only way this client can resolve a staged
      // prospect's Xmail lead id, since Xmail exposes no separate
      // "look up lead id by email" endpoint. A clean split (enrol calling
      // only an add-to-campaign-by-email endpoint) would need Xmail to add
      // one — see this phase's report for the exact shape that would need.
      const imp = await xmailBulkImportLeads(recipients.map((r) =>
        toXmailLead(r.prospect, r.verified, websiteInsights.get(r.prospect.id), sourceRunIds.get(r.prospect.id))))
      if (!imp.ok) return { error: `Xmail lead import failed: ${imp.error}` }

      const add = await xmailAddLeadsToCampaign(campaign_id, imp.leadIds, inboxId)
      if (!add.ok) return { error: `Enrolment failed: ${add.error}`, imported: imp.imported }

      const act = await xmailActivateCampaign(campaign_id)
      if (act.ok) await markEnrolled(auth.orgId, recipients.map((r) => r.prospect), campaign_id)

      return {
        matched: recipients.length,
        imported: imp.imported,
        enrolled: add.added,
        campaign_activated: act.ok,
        activation_note: act.ok
          ? undefined
          : `Leads enrolled, but the campaign could not be activated: ${act.error}. Fix it in Xmail (needs a sequence + a sending inbox per lead), then activate.`,
        not_yet_imported: notYetImported || undefined,
        platform_email: platformEmail || undefined,
        verification: { total_checked: staged.length, ...verification },
        verification_unavailable: verification.blocked_no_credits > 0 ? true : undefined,
        capped:
          allWithEmail.length > cap
            ? { total_matched: allWithEmail.length, cap, remaining: allWithEmail.length - cap }
            : undefined,
        message:
          `Enrolled ${add.added} prospect(s) into the campaign${act.ok ? ' and activated it — Xmail will start sending.' : ' (activation pending — see activation_note).'}` +
          (notYetImported > 0
            ? ` ${notYetImported} matching prospect(s) were skipped because they have not been imported yet — run prospects_import_to_xmail for them.`
            : '') +
          (platformEmail > 0
            ? ` ${platformEmail} matching prospect(s) were skipped as platform_email (booking-platform address, never the business's own).`
            : '') +
          (verification.blocked_no_credits > 0
            ? ` WARNING: ${verification.blocked_no_credits} matching prospect(s) were skipped — email verification is unavailable (no verification credits).`
            : ''),
      }
    },
  },
  // ── prospects_import_to_xmail (Fase 37) ─────────────────────────────────
  //
  // Splits "push into Xmail as a lead" apart from "enrol in a campaign and
  // maybe activate it". Evidence (2026-09-08): three production runs
  // verified 80 sendable addresses (69 ok, 9 catch_all, 2 unknown) and NONE
  // reached Xmail, because prospects_enroll_in_campaign's confirmed:true was
  // the only path that ever imported anything — and it also enrols and can
  // activate sending in the same call. This tool imports ONLY prospects with
  // email_status='ok' (verified, persisted by prospects_verify or a prior
  // enroll dry run — never re-verified here), never enrols, never touches
  // campaign state, and is a no-op for anything already staged.
  //
  // The actual matching/import logic lives in resolveImportCandidates /
  // buildImportSummary / pushCappedToXmail / importVerifiedProspectsToXmail
  // above the tools array — extracted so the auto-import step of
  // src/app/api/cron/prospect-verify-tick/route.ts (which verifies a run and
  // then must import whatever came back 'ok') reuses the exact same rules
  // instead of re-implementing them.
  {
    name: 'prospects_import_to_xmail',
    title: 'Stage verified prospects as Xmail leads (imports nothing to a campaign, sends nothing)',
    description:
      "Import prospects matching the filters into Xmail as leads — REVERSIBLE, sends nothing, never enrols into a campaign, never touches campaign state. Only prospects with a persisted email_status of exactly 'ok' are imported automatically; 'catch_all' and 'unknown' are deliberately held back for a human decision (their counts are always reported, never silently dropped), prospects whose email belongs to a booking platform (platform_email, e.g. help.us@booksy.com) are held back whatever their email_status, and prospects that were never verified (email_status is null) are reported too with a nudge to run prospects_verify first — this tool never verifies as a side effect. Already-imported prospects (tracked internally) are skipped on a repeat call, so it's safe to call again after a fresh scrape or verification pass. Requires at least one of external_run_id or source_type. SAFETY: without confirmed:true this only previews the counts — nothing is imported. Once staged here, call prospects_enroll_in_campaign (its own confirmed:true, separately) to actually start outreach — that is the only tool that sends anything. Caps at " + HARD_MAX + ' prospects per call.',
    area: 'general_xphere',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: z
      .object({
        ...filterShape,
        external_run_id: z.string().trim().min(1).max(200).optional()
          .describe('The xcraper/Apify run id to import (resolved via prospect_sources.external_run_id).'),
        max: z.number().int().positive().max(HARD_MAX).optional().describe(`Hard cap on prospects imported per call (default ${DEFAULT_MAX}, max ${HARD_MAX}).`),
        confirmed: z.boolean().optional().describe('Must be true to actually import into Xmail. Leave false/absent for a dry-run preview that imports nothing.'),
      })
      .strict()
      .refine((value) => Boolean(value.external_run_id || value.source_type), {
        message: 'At least one of external_run_id or source_type is required.',
        path: ['external_run_id'],
      }),
    handler: async (input, { auth }) => {
      const { external_run_id: externalRunId, max, confirmed, ...filters } = input
      const cap = Math.min(max ?? DEFAULT_MAX, HARD_MAX)

      if (!confirmed) {
        const resolved = await resolveImportCandidates(auth.orgId, filters, externalRunId, cap)
        if ('notFound' in resolved) {
          return {
            error: 'external_run_not_found',
            detail:
              `No prospect_sources row matches external_run_id "${externalRunId}"` +
              (filters.source_type ? ` with source_type "${filters.source_type}"` : '') +
              ' in this org.',
          }
        }
        const { matched, capped } = resolved
        const { summary, heldBackSuffix } = buildImportSummary(resolved, cap)
        return {
          dry_run: true,
          would_import: capped.length,
          ...summary,
          message:
            capped.length === 0
              ? (matched.length === 0
                  ? 'No prospects matched these filters.'
                  : `No importable prospects (email_status="ok") in this selection.${heldBackSuffix}`)
              : `${capped.length} prospect(s) with a verified ("ok") email would be imported into Xmail as leads — nothing is enrolled or sent.${heldBackSuffix} Nothing was imported (confirmed was not true).`,
        }
      }

      return importVerifiedProspectsToXmail(auth.orgId, filters, { externalRunId, max })
    },
  },
  {
    name: 'prospects_verify',
    title: 'Verify prospect emails for one run (no enrolment)',
    description:
      "Verify (or reuse fresh cached verification for) prospect emails, filtered by external_run_id and/or source_type. Never accepts a campaign_id and never enrols or sends anything — use this instead of prospects_enroll_in_campaign's unconfirmed dry run for verification-only work, since that tool has no per-run filter and doesn't persist a verification summary against the run. Booking-platform addresses (booksy.com, vagaro.com, ...) are never sent to a provider: they cost no credit, are persisted as invalid (provider 'platform_rule') and counted in platform_email. Reads the MillionVerifier balance before/after to report the real credits spent, and — when external_run_id is given — pushes the summary to Xmail's Journey for that run. Requires at least one of external_run_id or source_type. Caps at " + VERIFY_HARD_MAX + ' prospects per call.',
    area: 'general_xphere',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: z
      .object({
        external_run_id: z.string().trim().min(1).max(200).optional()
          .describe('The xcraper/Apify run id to verify (resolved via prospect_sources.external_run_id). When set, the summary is also pushed to Xmail for this run.'),
        source_type: z.string().max(60).optional().describe("Filter by ingestion source, e.g. 'xcraper'. Can be combined with external_run_id to disambiguate, or used alone to verify across a whole source with no specific run."),
        max: z.number().int().positive().max(VERIFY_HARD_MAX).optional().describe(`Max prospects to verify (default ${VERIFY_DEFAULT_MAX}, hard cap ${VERIFY_HARD_MAX}).`),
        force: z.boolean().optional().describe('Bypass the 90-day verification cache and re-check every email against the provider. Default false (reuse fresh cached results).'),
      })
      .strict()
      .refine((value) => Boolean(value.external_run_id || value.source_type), {
        message: 'At least one of external_run_id or source_type is required.',
        path: ['external_run_id'],
      }),
    handler: async (input, { auth }) => {
      const externalRunId = input.external_run_id
      const sourceType = input.source_type
      const cap = Math.min(input.max ?? VERIFY_DEFAULT_MAX, VERIFY_HARD_MAX)

      const resolved = await loadVerifiableProspects(auth.orgId, { externalRunId, sourceType }, cap)
      if ('notFound' in resolved) {
        return {
          error: 'external_run_not_found',
          detail:
            `No prospect_sources row matches external_run_id "${externalRunId}"` +
            (sourceType ? ` with source_type "${sourceType}"` : '') +
            ' in this org.',
        }
      }

      const { prospects, placeholdersRejected } = resolved
      const verifiedAt = new Date().toISOString()
      if (prospects.length === 0) {
        return {
          external_run_id: externalRunId ?? null,
          checked: 0,
          ok: 0,
          catch_all: 0,
          unknown: 0,
          invalid: 0,
          disposable: 0,
          bounced: 0,
          platform_email: 0,
          blocked_no_credits: 0,
          credits_used: null,
          verification_provider: 'millionverifier' as const,
          results: [],
          verified_at: verifiedAt,
          message: 'No prospects with a usable email matched these filters.',
        }
      }

      // Measured, not counted (Fase 34 evidence: 24 persisted verifications only
      // debited 6 credits, unexplained by a per-call count). A cache-hit-heavy
      // batch costs ~0 real credits; the before/after delta reports that honestly.
      const creditsBefore = await getMillionVerifierCredits()
      const batch = await verifyProspectsBatch(
        auth.orgId,
        prospects.map((p) => ({ kind: verificationKind(p.kind), id: p.id, email: p.email })),
        { force: input.force },
      )
      const creditsAfter = await getMillionVerifierCredits()
      const rawCreditsDelta =
        creditsBefore.credits != null && creditsAfter.credits != null
          ? creditsBefore.credits - creditsAfter.credits
          : null
      // MillionVerifier supports auto top-up (a documented +10% refill when the
      // balance runs low). If a refill lands mid-batch, the balance goes UP
      // between the before/after reads and this delta goes negative -- at that
      // point the delta is contaminated by an unknown top-up amount, so we
      // genuinely do not know how many credits this batch consumed.
      //
      // Do NOT clamp to 0: 0 is a distinct, real claim in this contract ("this
      // batch measurably cost nothing", e.g. an all-cache-hit batch), while
      // `null` already means "we could not measure it" (see the balance-read
      // failure above). Reporting a contaminated negative delta as 0 would
      // assert a measured-zero-cost claim about a batch we could not actually
      // measure -- a clamp would be a lie. Emit `null` instead, mirroring the
      // `cost_usd` semantics documented in Xcraper's `buildSourceMetadata`.
      const creditsUsed = rawCreditsDelta != null && rawCreditsDelta < 0 ? null : rawCreditsDelta

      const verificationProvider = resolveVerificationProvider(batch.results)
      const results = prospects.map((p, i) => {
        const r = batch.results[i]
        const status = 'blocked' in r.result
          ? 'blocked_no_credits'
          : r.result.provider === 'platform_rule'
            ? 'platform_email'
            : r.result.status
        return { prospect_id: p.id, kind: p.kind, email: p.email, status }
      })

      const output = {
        external_run_id: externalRunId ?? null,
        checked: prospects.length,
        ...verifyOutputCounts(batch.aggregate),
        credits_used: creditsUsed,
        verification_provider: verificationProvider,
        results,
        verified_at: verifiedAt,
      }

      // Push to Xmail's Journey for this run — best-effort, never fails the
      // verification itself (it already happened and was persisted onto the
      // contacts/accounts rows above).
      if (!externalRunId) return output
      if (!isXmailConfigured()) {
        return { ...output, xmail_notified: false, xmail_error: 'Xmail outreach is not wired up (XMAIL_API_URL / XMAIL_USER_ID / XMAIL_ORG_ID / XMAIL_SERVICE_KEY not set).' }
      }
      try {
        const notify = await xmailNotifyVerificationComplete(externalRunId, {
          provider: 'xcraper',
          checked: output.checked,
          ok: output.ok,
          catchAll: output.catch_all,
          unknown: output.unknown,
          // Xmail requires checked == ok + catchAll + unknown + invalid, so a platform address
          // (persisted as invalid/platform_rule) travels as invalid in the notification.
          invalid: output.invalid + output.platform_email,
          creditsUsed: output.credits_used,
          verificationProvider: output.verification_provider,
          // Absent must stay distinguishable from zero -- only sent when
          // prospect_sources.metadata.emails_lost_to_placeholder was present
          // and finite (extractPlaceholdersRejected), zero included.
          ...(placeholdersRejected !== undefined ? { placeholdersRejected } : {}),
          verifiedAt: output.verified_at,
        })
        if (!notify.ok) {
          console.error('[prospects_verify] xmailNotifyVerificationComplete failed:', notify.error)
          return { ...output, xmail_notified: false, xmail_error: notify.error }
        }
        return {
          ...output,
          xmail_notified: true,
          xmail_run_id: notify.runId,
          xmail_idempotent_replay: notify.idempotentReplay,
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error('[prospects_verify] xmailNotifyVerificationComplete threw:', err)
        return { ...output, xmail_notified: false, xmail_error: message }
      }
    },
  },
]
