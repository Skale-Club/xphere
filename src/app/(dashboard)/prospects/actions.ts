'use server'

import { revalidatePath } from 'next/cache'

import { createClient, getUser } from '@/lib/supabase/server'
import { getRbacContext } from '@/lib/rbac/server'
import { parseCsv } from '@/lib/contacts/csv'
import { normaliseEmail, normalisePhone } from '@/lib/contacts/zod-schemas'
import type {
  CrmEngagementStatus,
  CrmIntentLevel,
  CrmQualificationStatus,
  CrmRecommendedChannel,
  Database,
  Json,
  ProspectEntityType,
} from '@/types/database'

export type ProspectKind = 'person' | 'company'

export type ProspectRow = {
  id: string
  kind: ProspectKind
  name: string | null
  email: string | null
  phone: string | null
  company: string | null
  source: string
  sourceType: string | null
  sourceId: string | null
  engagementStatus: CrmEngagementStatus
  intentLevel: CrmIntentLevel
  qualificationStatus: CrmQualificationStatus
  recommendedChannel: CrmRecommendedChannel | null
  score: number
  lastContactedAt: string | null
  lastRepliedAt: string | null
  createdAt: string
  updatedAt: string
  tags: string[]
}

export type ProspectListResult =
  | { ok: true; rows: ProspectRow[]; total: number }
  | { ok: false; error: string; forbidden?: boolean }

export type ProspectSort = 'recent' | 'score' | 'name'

export type ProspectFilters = {
  q?: string
  kind?: 'all' | ProspectKind
  engagement?: CrmEngagementStatus
  intent?: CrmIntentLevel
  qualification?: CrmQualificationStatus
  listId?: string
  sort?: ProspectSort
  page?: number
  pageSize?: number
}

export type ProspectsPageResult =
  | {
      ok: true
      rows: ProspectRow[]
      total: number
      page: number
      pageSize: number
      lists: { id: string; name: string }[]
    }
  | { ok: false; error: string; forbidden?: boolean }

// How many records we pull from each table before merging/sorting/paginating in
// memory. Prospects are admin-only and early-stage, so volumes stay modest; if a
// workspace ever exceeds this the list silently caps (documented for callers).
const PROSPECT_FETCH_CAP = 1000

export type ProspectRef = { kind: ProspectKind; id: string }
export type BulkResult =
  | { ok: true; affected: number }
  | { ok: false; error: string; forbidden?: boolean }

export type ProspectActionResult =
  | { ok: true }
  | { ok: false; error: string; forbidden?: boolean }

export type ProspectImportResult =
  | { ok: true; inserted: number; skipped: number }
  | { ok: false; error: string; forbidden?: boolean }

async function requireProspectsAdmin(): Promise<ProspectActionResult> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated', forbidden: true }

  const ctx = await getRbacContext()
  if (ctx.isPlatformAdmin || ctx.role === 'owner' || ctx.role === 'admin') {
    return { ok: true }
  }

  return { ok: false, error: 'Prospects are available to workspace admins only.', forbidden: true }
}

function contactName(row: {
  first_name?: string | null
  last_name?: string | null
  name?: string | null
}): string | null {
  const composed = [row.first_name, row.last_name].filter(Boolean).join(' ').trim()
  return composed || row.name?.trim() || null
}

export async function getProspects(filters: ProspectFilters = {}): Promise<ProspectsPageResult> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard

  const supabase = await createClient()

  const page = Math.max(1, filters.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 25))
  const kind = filters.kind ?? 'all'
  const q = (filters.q ?? '').trim()
  // Strip characters that would break PostgREST's `or(...)` filter grammar.
  const safeQ = q.replace(/[,()%]/g, ' ').trim()

  // List-membership filter → restrict each table to the ids in that list.
  let listContactIds: string[] | null = null
  let listAccountIds: string[] | null = null
  if (filters.listId) {
    const { data: members } = await supabase
      .from('prospect_list_members')
      .select('contact_id, account_id')
      .eq('list_id', filters.listId)
    listContactIds = []
    listAccountIds = []
    for (const m of (members ?? []) as Array<{ contact_id: string | null; account_id: string | null }>) {
      if (m.contact_id) listContactIds.push(m.contact_id)
      if (m.account_id) listAccountIds.push(m.account_id)
    }
  }

  const NONE = '00000000-0000-0000-0000-000000000000'
  const wantPeople = kind === 'all' || kind === 'person'
  const wantCompanies = kind === 'all' || kind === 'company'

  const [contactsResult, accountsResult, listsResult] = await Promise.all([
    wantPeople
      ? (() => {
          let query = supabase
            .from('contacts')
            .select(
              'id, first_name, last_name, name, email, phone, company, tags, source, source_type, source_id, engagement_status, intent_level, qualification_status, recommended_channel, score, last_contacted_at, last_replied_at, created_at, updated_at, account:account_id(name)',
            )
            .eq('lifecycle_stage', 'prospect')
            .limit(PROSPECT_FETCH_CAP)
          if (filters.engagement) query = query.eq('engagement_status', filters.engagement)
          if (filters.intent) query = query.eq('intent_level', filters.intent)
          if (filters.qualification) query = query.eq('qualification_status', filters.qualification)
          if (safeQ)
            query = query.or(
              `name.ilike.%${safeQ}%,email.ilike.%${safeQ}%,company.ilike.%${safeQ}%,phone.ilike.%${safeQ}%`,
            )
          if (listContactIds) query = query.in('id', listContactIds.length ? listContactIds : [NONE])
          return query
        })()
      : Promise.resolve({ data: [], error: null }),
    wantCompanies
      ? (() => {
          let query = supabase
            .from('accounts')
            .select(
              'id, name, domain, website, phone, tags, source, source_type, source_id, engagement_status, intent_level, qualification_status, recommended_channel, score, last_contacted_at, last_replied_at, created_at, updated_at',
            )
            .eq('lifecycle_stage', 'prospect')
            .limit(PROSPECT_FETCH_CAP)
          if (filters.engagement) query = query.eq('engagement_status', filters.engagement)
          if (filters.intent) query = query.eq('intent_level', filters.intent)
          if (filters.qualification) query = query.eq('qualification_status', filters.qualification)
          if (safeQ)
            query = query.or(`name.ilike.%${safeQ}%,domain.ilike.%${safeQ}%,phone.ilike.%${safeQ}%`)
          if (listAccountIds) query = query.in('id', listAccountIds.length ? listAccountIds : [NONE])
          return query
        })()
      : Promise.resolve({ data: [], error: null }),
    supabase.from('prospect_lists').select('id, name').order('name', { ascending: true }),
  ])

  const error = contactsResult.error ?? accountsResult.error
  if (error) return { ok: false, error: error.message }

  const contactRows: ProspectRow[] = ((contactsResult.data ?? []) as Array<Record<string, unknown>>).map(
    (row) => {
      const account = row.account as { name?: string | null } | null
      return {
        id: row.id as string,
        kind: 'person' as const,
        name: contactName(row as { first_name?: string | null; last_name?: string | null; name?: string | null }),
        email: (row.email as string | null) ?? null,
        phone: (row.phone as string | null) ?? null,
        company: account?.name ?? (row.company as string | null) ?? null,
        source: (row.source as string | null) ?? 'manual',
        sourceType: (row.source_type as string | null) ?? null,
        sourceId: (row.source_id as string | null) ?? null,
        engagementStatus: row.engagement_status as CrmEngagementStatus,
        intentLevel: row.intent_level as CrmIntentLevel,
        qualificationStatus: row.qualification_status as CrmQualificationStatus,
        recommendedChannel: (row.recommended_channel as CrmRecommendedChannel | null) ?? null,
        score: (row.score as number | null) ?? 0,
        lastContactedAt: (row.last_contacted_at as string | null) ?? null,
        lastRepliedAt: (row.last_replied_at as string | null) ?? null,
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string,
        tags: (row.tags as string[] | null) ?? [],
      }
    },
  )

  const accountRows: ProspectRow[] = ((accountsResult.data ?? []) as Array<Record<string, unknown>>).map(
    (row) => ({
      id: row.id as string,
      kind: 'company' as const,
      name: (row.name as string | null) ?? null,
      email: null,
      phone: (row.phone as string | null) ?? null,
      company: (row.domain as string | null) ?? (row.website as string | null) ?? null,
      source: (row.source as string | null) ?? 'manual',
      sourceType: (row.source_type as string | null) ?? null,
      sourceId: (row.source_id as string | null) ?? null,
      engagementStatus: row.engagement_status as CrmEngagementStatus,
      intentLevel: row.intent_level as CrmIntentLevel,
      qualificationStatus: row.qualification_status as CrmQualificationStatus,
      recommendedChannel: (row.recommended_channel as CrmRecommendedChannel | null) ?? null,
      score: (row.score as number | null) ?? 0,
      lastContactedAt: (row.last_contacted_at as string | null) ?? null,
      lastRepliedAt: (row.last_replied_at as string | null) ?? null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      tags: (row.tags as string[] | null) ?? [],
    }),
  )

  const merged = [...contactRows, ...accountRows]
  const sort = filters.sort ?? 'recent'
  merged.sort((a, b) => {
    if (sort === 'score') return b.score - a.score || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    if (sort === 'name') return (a.name ?? '').localeCompare(b.name ?? '')
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })

  const total = merged.length
  const start = (page - 1) * pageSize
  const rows = merged.slice(start, start + pageSize)
  const lists = ((listsResult.data ?? []) as Array<{ id: string; name: string }>).map((l) => ({
    id: l.id,
    name: l.name,
  }))

  return { ok: true, rows, total, page, pageSize, lists }
}

export async function createProspect(input: {
  kind: ProspectKind
  name: string
  email?: string | null
  phone?: string | null
  company?: string | null
  sourceType?: string | null
  sourceId?: string | null
  sourcePayload?: Json
}): Promise<ProspectActionResult> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard

  const name = input.name.trim()
  if (!name) return { ok: false, error: 'Name is required.' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No active workspace found.' }

  if (input.kind === 'company') {
    const { error } = await supabase.from('accounts').insert({
      org_id: orgId as string,
      name,
      phone: input.phone?.trim() || null,
      source: 'manual',
      lifecycle_stage: 'prospect',
      engagement_status: 'not_contacted',
      intent_level: 'none',
      qualification_status: 'needs_review',
      source_type: input.sourceType?.trim() || null,
      source_id: input.sourceId?.trim() || null,
      source_payload: input.sourcePayload ?? {},
    })
    if (error) return { ok: false, error: error.message }
  } else {
    const { error } = await supabase.from('contacts').insert({
      org_id: orgId as string,
      name,
      email: input.email?.trim() || null,
      phone: input.phone?.trim() || null,
      company: input.company?.trim() || null,
      source: 'manual',
      lifecycle_stage: 'prospect',
      engagement_status: 'not_contacted',
      intent_level: 'none',
      qualification_status: 'needs_review',
      source_type: input.sourceType?.trim() || null,
      source_id: input.sourceId?.trim() || null,
      source_payload: input.sourcePayload ?? {},
    })
    if (error) return { ok: false, error: error.message }
  }

  revalidatePath('/prospects')
  return { ok: true }
}

type ServerClient = Awaited<ReturnType<typeof createClient>>

/**
 * Promote a single prospect-stage record to `lead`, recording the conversion and
 * a timeline event. Returns false when the record was not in the prospect stage
 * (already promoted) so callers can report it as skipped. Never pulls a non-
 * prospect record back.
 */
async function applyConversion(
  supabase: ServerClient,
  orgId: string,
  userId: string | null,
  kind: ProspectKind,
  id: string,
): Promise<boolean> {
  const table = kind === 'company' ? 'accounts' : 'contacts'
  const entityType: ProspectEntityType = kind === 'company' ? 'account' : 'contact'

  const { data, error } = await supabase
    .from(table)
    .update({
      lifecycle_stage: 'lead',
      qualification_status: 'qualified',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('lifecycle_stage', 'prospect')
    .select('id')

  if (error || !data || data.length === 0) return false

  await supabase.from('prospect_conversions').insert({
    org_id: orgId,
    entity_type: entityType,
    entity_id: id,
    from_stage: 'prospect',
    to_stage: 'lead',
    converted_by: userId,
    payload: {},
  })
  await supabase.from('prospect_engagement_events').insert({
    org_id: orgId,
    entity_type: entityType,
    entity_id: id,
    event_type: 'converted',
    source_platform: 'xphere',
    payload: { to_stage: 'lead' } as Json,
  })
  return true
}

function splitRefs(refs: ProspectRef[]): { contactIds: string[]; accountIds: string[] } {
  const contactIds: string[] = []
  const accountIds: string[] = []
  for (const ref of refs) {
    if (ref.kind === 'company') accountIds.push(ref.id)
    else contactIds.push(ref.id)
  }
  return { contactIds, accountIds }
}

export async function convertProspectToContact(
  kind: ProspectKind,
  id: string,
): Promise<ProspectActionResult> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard

  const user = await getUser()
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No active workspace found.' }

  const converted = await applyConversion(supabase, orgId as string, user?.id ?? null, kind, id)
  if (!converted) return { ok: false, error: 'This record is no longer a prospect.' }

  revalidatePath('/prospects')
  revalidatePath('/contacts')
  revalidatePath('/companies')
  return { ok: true }
}

// ─── Bulk actions ────────────────────────────────────────────────────────────

export async function bulkConvertProspects(refs: ProspectRef[]): Promise<BulkResult> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard
  if (refs.length === 0) return { ok: true, affected: 0 }

  const user = await getUser()
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No active workspace found.' }

  let affected = 0
  for (const ref of refs) {
    const ok = await applyConversion(supabase, orgId as string, user?.id ?? null, ref.kind, ref.id)
    if (ok) affected += 1
  }

  revalidatePath('/prospects')
  revalidatePath('/contacts')
  revalidatePath('/companies')
  return { ok: true, affected }
}

export async function bulkSetQualification(
  refs: ProspectRef[],
  qualification: CrmQualificationStatus,
): Promise<BulkResult> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard
  if (refs.length === 0) return { ok: true, affected: 0 }

  const supabase = await createClient()
  const { contactIds, accountIds } = splitRefs(refs)
  const patch = { qualification_status: qualification, updated_at: new Date().toISOString() }

  if (contactIds.length) {
    const { error } = await supabase.from('contacts').update(patch).in('id', contactIds).eq('lifecycle_stage', 'prospect')
    if (error) return { ok: false, error: error.message }
  }
  if (accountIds.length) {
    const { error } = await supabase.from('accounts').update(patch).in('id', accountIds).eq('lifecycle_stage', 'prospect')
    if (error) return { ok: false, error: error.message }
  }

  revalidatePath('/prospects')
  return { ok: true, affected: refs.length }
}

export async function bulkSetIntent(refs: ProspectRef[], intent: CrmIntentLevel): Promise<BulkResult> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard
  if (refs.length === 0) return { ok: true, affected: 0 }

  const supabase = await createClient()
  const { contactIds, accountIds } = splitRefs(refs)
  const patch = { intent_level: intent, updated_at: new Date().toISOString() }

  if (contactIds.length) {
    const { error } = await supabase.from('contacts').update(patch).in('id', contactIds).eq('lifecycle_stage', 'prospect')
    if (error) return { ok: false, error: error.message }
  }
  if (accountIds.length) {
    const { error } = await supabase.from('accounts').update(patch).in('id', accountIds).eq('lifecycle_stage', 'prospect')
    if (error) return { ok: false, error: error.message }
  }

  revalidatePath('/prospects')
  return { ok: true, affected: refs.length }
}

export async function bulkAssignToList(refs: ProspectRef[], listId: string): Promise<BulkResult> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard
  if (refs.length === 0) return { ok: true, affected: 0 }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No active workspace found.' }

  // Skip members already in the list so re-assigning is idempotent (the table has
  // partial unique indexes per kind that make upsert onConflict awkward).
  const { data: current } = await supabase
    .from('prospect_list_members')
    .select('contact_id, account_id')
    .eq('list_id', listId)
  const existingContacts = new Set<string>()
  const existingAccounts = new Set<string>()
  for (const m of (current ?? []) as Array<{ contact_id: string | null; account_id: string | null }>) {
    if (m.contact_id) existingContacts.add(m.contact_id)
    if (m.account_id) existingAccounts.add(m.account_id)
  }

  const rows = refs
    .filter((ref) =>
      ref.kind === 'person' ? !existingContacts.has(ref.id) : !existingAccounts.has(ref.id),
    )
    .map((ref) => ({
      org_id: orgId as string,
      list_id: listId,
      contact_id: ref.kind === 'person' ? ref.id : null,
      account_id: ref.kind === 'company' ? ref.id : null,
    }))

  if (rows.length === 0) return { ok: true, affected: 0 }

  const { error } = await supabase.from('prospect_list_members').insert(rows)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/prospects')
  revalidatePath('/prospects/lists')
  return { ok: true, affected: rows.length }
}

export async function bulkDeleteProspects(refs: ProspectRef[]): Promise<BulkResult> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard
  if (refs.length === 0) return { ok: true, affected: 0 }

  const supabase = await createClient()
  const { contactIds, accountIds } = splitRefs(refs)

  // Only delete records still in the prospect stage — never a promoted CRM record.
  if (contactIds.length) {
    const { error } = await supabase.from('contacts').delete().in('id', contactIds).eq('lifecycle_stage', 'prospect')
    if (error) return { ok: false, error: error.message }
  }
  if (accountIds.length) {
    const { error } = await supabase.from('accounts').delete().in('id', accountIds).eq('lifecycle_stage', 'prospect')
    if (error) return { ok: false, error: error.message }
  }

  revalidatePath('/prospects')
  return { ok: true, affected: refs.length }
}

export async function importProspectsCsv(csv: string): Promise<ProspectImportResult> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard

  const parsed = parseCsv(csv)
  if (parsed.headers.length === 0) return { ok: false, error: 'CSV must include a header row.' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No active workspace found.' }

  const headerIndex = new Map(parsed.headers.map((header, index) => [header.trim().toLowerCase(), index]))
  const indexOf = (...names: string[]) => {
    for (const name of names) {
      const idx = headerIndex.get(name)
      if (idx !== undefined) return idx
    }
    return -1
  }

  const nameIdx = indexOf('name', 'full name', 'contact', 'nome')
  const firstIdx = indexOf('first_name', 'first name', 'firstname')
  const lastIdx = indexOf('last_name', 'last name', 'lastname')
  const emailIdx = indexOf('email', 'e-mail')
  const phoneIdx = indexOf('phone', 'telephone', 'mobile', 'whatsapp')
  const companyIdx = indexOf('company', 'organization', 'empresa')
  const sourceIdIdx = indexOf('source_id', 'source id', 'external_id', 'external id')

  const rows = parsed.rows.slice(0, 500)
  type ProspectContactInsert = Database['public']['Tables']['contacts']['Insert']

  const inserts: ProspectContactInsert[] = []
  for (const row of rows) {
    const first = firstIdx >= 0 ? row[firstIdx]?.trim() : ''
    const last = lastIdx >= 0 ? row[lastIdx]?.trim() : ''
    const explicitName = nameIdx >= 0 ? row[nameIdx]?.trim() : ''
    const name = explicitName || [first, last].filter(Boolean).join(' ')
    const email = normaliseEmail(emailIdx >= 0 ? row[emailIdx] : null)
    const phone = normalisePhone(phoneIdx >= 0 ? row[phoneIdx] : null)
    const company = companyIdx >= 0 ? row[companyIdx]?.trim() : ''
    const sourceId = sourceIdIdx >= 0 ? row[sourceIdIdx]?.trim() : ''

    if (!name && !email && !phone) continue

    inserts.push({
      org_id: orgId as string,
      name: name || null,
      email,
      phone,
      company: company || null,
      source: 'csv_import',
      lifecycle_stage: 'prospect',
      engagement_status: 'not_contacted',
      intent_level: 'none',
      qualification_status: 'needs_review',
      source_type: 'csv',
      source_id: sourceId || null,
      source_payload: {
        headers: parsed.headers,
        row,
      },
    })
  }

  if (inserts.length === 0) return { ok: false, error: 'No importable prospect rows found.' }

  const { error } = await supabase.from('contacts').insert(inserts)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/prospects')
  return { ok: true, inserted: inserts.length, skipped: rows.length - inserts.length }
}

// ─── Lists ─────────────────────────────────────────────────────────────────────

export type ProspectListRow = {
  id: string
  name: string
  description: string | null
  color: string | null
  memberCount: number
  createdAt: string
}

export async function getProspectLists(): Promise<
  { ok: true; lists: ProspectListRow[] } | { ok: false; error: string; forbidden?: boolean }
> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard

  const supabase = await createClient()
  const [listsResult, membersResult] = await Promise.all([
    supabase
      .from('prospect_lists')
      .select('id, name, description, color, created_at')
      .order('created_at', { ascending: false }),
    supabase.from('prospect_list_members').select('list_id'),
  ])

  if (listsResult.error) return { ok: false, error: listsResult.error.message }

  const counts = new Map<string, number>()
  for (const row of (membersResult.data ?? []) as Array<{ list_id: string }>) {
    counts.set(row.list_id, (counts.get(row.list_id) ?? 0) + 1)
  }

  const lists = ((listsResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    color: (row.color as string | null) ?? null,
    memberCount: counts.get(row.id as string) ?? 0,
    createdAt: row.created_at as string,
  }))

  return { ok: true, lists }
}

export async function createProspectList(input: {
  name: string
  description?: string | null
  color?: string | null
}): Promise<ProspectActionResult> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard

  const name = input.name.trim()
  if (!name) return { ok: false, error: 'List name is required.' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No active workspace found.' }

  const { error } = await supabase.from('prospect_lists').insert({
    org_id: orgId as string,
    name,
    description: input.description?.trim() || null,
    color: input.color?.trim() || null,
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath('/prospects/lists')
  return { ok: true }
}

export async function deleteProspectList(id: string): Promise<ProspectActionResult> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard

  const supabase = await createClient()
  const { error } = await supabase.from('prospect_lists').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/prospects/lists')
  return { ok: true }
}

// ─── Sources ───────────────────────────────────────────────────────────────────

export type ProspectSourceRow = {
  id: string
  sourceType: string
  sourceKey: string | null
  label: string | null
  externalRunId: string | null
  status: string
  totalCount: number
  importedCount: number
  createdAt: string
}

export async function getProspectSources(): Promise<
  { ok: true; sources: ProspectSourceRow[] } | { ok: false; error: string; forbidden?: boolean }
> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('prospect_sources')
    .select('id, source_type, source_key, label, external_run_id, status, total_count, imported_count, created_at')
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) return { ok: false, error: error.message }

  const sources = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    sourceType: row.source_type as string,
    sourceKey: (row.source_key as string | null) ?? null,
    label: (row.label as string | null) ?? null,
    externalRunId: (row.external_run_id as string | null) ?? null,
    status: row.status as string,
    totalCount: (row.total_count as number) ?? 0,
    importedCount: (row.imported_count as number) ?? 0,
    createdAt: row.created_at as string,
  }))

  return { ok: true, sources }
}

// ─── Audiences ─────────────────────────────────────────────────────────────────

export type ProspectAudienceRow = {
  id: string
  name: string
  description: string | null
  syncedPlatforms: string[]
  createdAt: string
}

export async function getProspectAudiences(): Promise<
  { ok: true; audiences: ProspectAudienceRow[] } | { ok: false; error: string; forbidden?: boolean }
> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('prospect_audiences')
    .select('id, name, description, synced_platforms, created_at')
    .order('created_at', { ascending: false })

  if (error) return { ok: false, error: error.message }

  const audiences = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    syncedPlatforms: (row.synced_platforms as string[] | null) ?? [],
    createdAt: row.created_at as string,
  }))

  return { ok: true, audiences }
}

export async function createProspectAudience(input: {
  name: string
  description?: string | null
}): Promise<ProspectActionResult> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard

  const name = input.name.trim()
  if (!name) return { ok: false, error: 'Audience name is required.' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No active workspace found.' }

  const { error } = await supabase.from('prospect_audiences').insert({
    org_id: orgId as string,
    name,
    description: input.description?.trim() || null,
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath('/prospects/audiences')
  return { ok: true }
}

export async function deleteProspectAudience(id: string): Promise<ProspectActionResult> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard

  const supabase = await createClient()
  const { error } = await supabase.from('prospect_audiences').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/prospects/audiences')
  return { ok: true }
}

// ─── Replies ───────────────────────────────────────────────────────────────────

const REPLY_STATUSES: CrmEngagementStatus[] = ['replied', 'engaged', 'interested', 'needs_follow_up']

export async function getProspectReplies(): Promise<ProspectListResult> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('contacts')
    .select('id, first_name, last_name, name, email, phone, company, tags, source, source_type, source_id, engagement_status, intent_level, qualification_status, recommended_channel, score, last_contacted_at, last_replied_at, created_at, updated_at')
    .eq('lifecycle_stage', 'prospect')
    .in('engagement_status', REPLY_STATUSES)
    .order('last_replied_at', { ascending: false, nullsFirst: false })
    .limit(250)

  if (error) return { ok: false, error: error.message }

  const rows: ProspectRow[] = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    kind: 'person' as const,
    name: contactName(row as { first_name?: string | null; last_name?: string | null; name?: string | null }),
    email: (row.email as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    company: (row.company as string | null) ?? null,
    source: (row.source as string | null) ?? 'manual',
    sourceType: (row.source_type as string | null) ?? null,
    sourceId: (row.source_id as string | null) ?? null,
    engagementStatus: row.engagement_status as CrmEngagementStatus,
    intentLevel: row.intent_level as CrmIntentLevel,
    qualificationStatus: row.qualification_status as CrmQualificationStatus,
    recommendedChannel: (row.recommended_channel as CrmRecommendedChannel | null) ?? null,
    score: (row.score as number | null) ?? 0,
    lastContactedAt: (row.last_contacted_at as string | null) ?? null,
    lastRepliedAt: (row.last_replied_at as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    tags: (row.tags as string[] | null) ?? [],
  }))

  return { ok: true, rows, total: rows.length }
}

// ─── Conversions ───────────────────────────────────────────────────────────────

export type ProspectConversionRow = {
  id: string
  entityType: ProspectEntityType
  entityId: string
  entityName: string | null
  fromStage: string
  toStage: string
  createdAt: string
}

export async function getProspectConversions(): Promise<
  { ok: true; conversions: ProspectConversionRow[] } | { ok: false; error: string; forbidden?: boolean }
> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('prospect_conversions')
    .select('id, entity_type, entity_id, from_stage, to_stage, created_at')
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) return { ok: false, error: error.message }

  const rows = (data ?? []) as Array<Record<string, unknown>>

  // Resolve entity names in two grouped lookups.
  const contactIds = rows.filter((r) => r.entity_type === 'contact').map((r) => r.entity_id as string)
  const accountIds = rows.filter((r) => r.entity_type === 'account').map((r) => r.entity_id as string)
  const names = new Map<string, string>()

  if (contactIds.length) {
    const { data: contacts } = await supabase.from('contacts').select('id, name').in('id', contactIds)
    for (const c of (contacts ?? []) as Array<{ id: string; name: string | null }>) {
      if (c.name) names.set(c.id, c.name)
    }
  }
  if (accountIds.length) {
    const { data: accounts } = await supabase.from('accounts').select('id, name').in('id', accountIds)
    for (const a of (accounts ?? []) as Array<{ id: string; name: string | null }>) {
      if (a.name) names.set(a.id, a.name)
    }
  }

  const conversions = rows.map((row) => ({
    id: row.id as string,
    entityType: row.entity_type as ProspectEntityType,
    entityId: row.entity_id as string,
    entityName: names.get(row.entity_id as string) ?? null,
    fromStage: row.from_stage as string,
    toStage: row.to_stage as string,
    createdAt: row.created_at as string,
  }))

  return { ok: true, conversions }
}

// ─── Detail ────────────────────────────────────────────────────────────────────

export type ProspectEvent = {
  id: string
  eventType: string
  channel: string | null
  sourcePlatform: string | null
  occurredAt: string
  payload: Json
}
export type ProspectNote = { id: string; content: string; createdAt: string }
export type ProspectTask = { id: string; title: string; status: string; dueDate: string | null }

export type ProspectDetail = ProspectRow & {
  sourcePayload: Json
  events: ProspectEvent[]
  notes: ProspectNote[]
  tasks: ProspectTask[]
  conversationCount: number
}

export async function getProspectDetail(
  kind: ProspectKind,
  id: string,
): Promise<{ ok: true; detail: ProspectDetail } | { ok: false; error: string; forbidden?: boolean }> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard

  const supabase = await createClient()
  const entityType: ProspectEntityType = kind === 'company' ? 'account' : 'contact'

  const base =
    kind === 'company'
      ? await supabase
          .from('accounts')
          .select('id, name, domain, website, phone, tags, source, source_type, source_id, source_payload, engagement_status, intent_level, qualification_status, recommended_channel, score, last_contacted_at, last_replied_at, created_at, updated_at')
          .eq('id', id)
          .eq('lifecycle_stage', 'prospect')
          .maybeSingle()
      : await supabase
          .from('contacts')
          .select('id, first_name, last_name, name, email, phone, company, tags, source, source_type, source_id, source_payload, engagement_status, intent_level, qualification_status, recommended_channel, score, last_contacted_at, last_replied_at, created_at, updated_at')
          .eq('id', id)
          .eq('lifecycle_stage', 'prospect')
          .maybeSingle()

  if (base.error) return { ok: false, error: base.error.message }
  if (!base.data) return { ok: false, error: 'Prospect not found.' }
  const row = base.data as Record<string, unknown>

  const [eventsResult, notesResult, tasksResult, convResult] = await Promise.all([
    supabase
      .from('prospect_engagement_events')
      .select('id, event_type, channel, source_platform, occurred_at, payload')
      .eq('entity_type', entityType)
      .eq('entity_id', id)
      .order('occurred_at', { ascending: false })
      .limit(50),
    supabase
      .from('notes')
      .select('id, content, created_at')
      .eq('entity_type', entityType)
      .eq('entity_id', id)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('tasks')
      .select('id, title, status, due_date')
      .eq('entity_type', entityType)
      .eq('entity_id', id)
      .order('created_at', { ascending: false })
      .limit(50),
    kind === 'person'
      ? supabase.from('conversations').select('id', { count: 'exact', head: true }).eq('contact_id', id)
      : Promise.resolve({ count: 0 }),
  ])

  const detail: ProspectDetail = {
    id: row.id as string,
    kind,
    name:
      kind === 'company'
        ? ((row.name as string | null) ?? null)
        : contactName(row as { first_name?: string | null; last_name?: string | null; name?: string | null }),
    email: (row.email as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    company:
      kind === 'company'
        ? (row.domain as string | null) ?? (row.website as string | null) ?? null
        : (row.company as string | null) ?? null,
    source: (row.source as string | null) ?? 'manual',
    sourceType: (row.source_type as string | null) ?? null,
    sourceId: (row.source_id as string | null) ?? null,
    sourcePayload: (row.source_payload as Json) ?? {},
    engagementStatus: row.engagement_status as CrmEngagementStatus,
    intentLevel: row.intent_level as CrmIntentLevel,
    qualificationStatus: row.qualification_status as CrmQualificationStatus,
    recommendedChannel: (row.recommended_channel as CrmRecommendedChannel | null) ?? null,
    score: (row.score as number | null) ?? 0,
    lastContactedAt: (row.last_contacted_at as string | null) ?? null,
    lastRepliedAt: (row.last_replied_at as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    tags: (row.tags as string[] | null) ?? [],
    events: ((eventsResult.data ?? []) as Array<Record<string, unknown>>).map((e) => ({
      id: e.id as string,
      eventType: e.event_type as string,
      channel: (e.channel as string | null) ?? null,
      sourcePlatform: (e.source_platform as string | null) ?? null,
      occurredAt: e.occurred_at as string,
      payload: (e.payload as Json) ?? {},
    })),
    notes: ((notesResult.data ?? []) as Array<Record<string, unknown>>).map((n) => ({
      id: n.id as string,
      content: n.content as string,
      createdAt: n.created_at as string,
    })),
    tasks: ((tasksResult.data ?? []) as Array<Record<string, unknown>>).map((t) => ({
      id: t.id as string,
      title: t.title as string,
      status: t.status as string,
      dueDate: (t.due_date as string | null) ?? null,
    })),
    conversationCount: (convResult as { count: number | null }).count ?? 0,
  }

  return { ok: true, detail }
}

export async function addProspectNote(
  kind: ProspectKind,
  id: string,
  content: string,
): Promise<ProspectActionResult> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard

  const text = content.trim()
  if (!text) return { ok: false, error: 'Note cannot be empty.' }

  const user = await getUser()
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No active workspace found.' }

  const entityType: ProspectEntityType = kind === 'company' ? 'account' : 'contact'
  const { error } = await supabase.from('notes').insert({
    org_id: orgId as string,
    content: text,
    entity_type: entityType,
    entity_id: id,
    created_by: user?.id ?? null,
  })
  if (error) return { ok: false, error: error.message }

  await supabase.from('prospect_engagement_events').insert({
    org_id: orgId as string,
    entity_type: entityType,
    entity_id: id,
    event_type: 'note',
    source_platform: 'xphere',
    payload: {} as Json,
  })

  revalidatePath('/prospects')
  return { ok: true }
}

export async function addProspectTask(
  kind: ProspectKind,
  id: string,
  title: string,
): Promise<ProspectActionResult> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard

  const text = title.trim()
  if (!text) return { ok: false, error: 'Task title is required.' }

  const user = await getUser()
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No active workspace found.' }

  const entityType: ProspectEntityType = kind === 'company' ? 'account' : 'contact'
  const { error } = await supabase.from('tasks').insert({
    org_id: orgId as string,
    title: text,
    status: 'todo',
    entity_type: entityType,
    entity_id: id,
    created_by: user?.id ?? null,
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath('/prospects')
  return { ok: true }
}
