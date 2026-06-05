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
  createdAt: string
  updatedAt: string
  tags: string[]
}

export type ProspectListResult =
  | { ok: true; rows: ProspectRow[]; total: number }
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

export async function getProspects(): Promise<ProspectListResult> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard

  const supabase = await createClient()
  const [contactsResult, accountsResult] = await Promise.all([
    supabase
      .from('contacts')
      .select('id, first_name, last_name, name, email, phone, company, tags, source, source_type, source_id, engagement_status, intent_level, qualification_status, created_at, updated_at, account:account_id(name)')
      .eq('lifecycle_stage', 'prospect')
      .order('created_at', { ascending: false })
      .limit(250),
    supabase
      .from('accounts')
      .select('id, name, domain, website, phone, tags, source, source_type, source_id, engagement_status, intent_level, qualification_status, created_at, updated_at')
      .eq('lifecycle_stage', 'prospect')
      .order('created_at', { ascending: false })
      .limit(250),
  ])

  const error = contactsResult.error ?? accountsResult.error
  if (error) return { ok: false, error: error.message }

  const contactRows = ((contactsResult.data ?? []) as Array<Record<string, unknown>>).map((row) => {
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
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      tags: (row.tags as string[] | null) ?? [],
    }
  })

  const accountRows = ((accountsResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
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
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    tags: (row.tags as string[] | null) ?? [],
  }))

  const rows = [...contactRows, ...accountRows].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )

  return { ok: true, rows, total: rows.length }
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

export async function convertProspectToContact(
  kind: ProspectKind,
  id: string,
): Promise<ProspectActionResult> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard

  const supabase = await createClient()
  const table = kind === 'company' ? 'accounts' : 'contacts'
  const { error } = await supabase
    .from(table)
    .update({
      lifecycle_stage: 'lead',
      qualification_status: 'qualified',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('lifecycle_stage', 'prospect')

  if (error) return { ok: false, error: error.message }

  revalidatePath('/prospects')
  revalidatePath('/contacts')
  revalidatePath('/companies')
  return { ok: true }
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
    .select('id, first_name, last_name, name, email, phone, company, tags, source, source_type, source_id, engagement_status, intent_level, qualification_status, created_at, updated_at, last_replied_at')
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
