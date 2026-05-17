'use server'

/**
 * Server actions for the Contacts CRM page (SEED-006 / v2.1).
 *
 * Patterns mirror src/app/(dashboard)/agents/actions.ts:
 *   - Cached getUser() for auth gating
 *   - RLS-scoped createClient() — never filter by org_id manually
 *   - Service-role client only for cross-table linking jobs that must outrun
 *     get_current_org_id()
 *
 * Naming convention: getContacts/getContact use plain reads; create/update/delete
 * write through the user's client so RLS denies cross-org mutations; bulk
 * imports use the user client too (RLS auto-injects org_id via default-ish
 * checks — we still pass org_id explicitly because the column is NOT NULL).
 */

import { revalidatePath } from 'next/cache'
import { createClient, getUser } from '@/lib/supabase/server'
import type { Database, ContactSource } from '@/types/database'
import {
  contactSchema,
  contactListFiltersSchema,
  normalisePhone,
  normaliseEmail,
  normaliseContactInput,
  type ContactFormInput,
  type ContactListFilters,
} from '@/lib/contacts/zod-schemas'
import {
  parseCsv,
  suggestColumnMapping,
  CONTACT_FIELDS,
  type ContactField,
} from '@/lib/contacts/csv'

type ContactRow = Database['public']['Tables']['contacts']['Row']

export interface ContactListResult {
  rows: ContactRow[]
  total: number
  page: number
  pageSize: number
  allTags: string[]
}

export async function getContacts(
  filters: Partial<ContactListFilters> = {},
): Promise<ContactListResult> {
  const user = await getUser()
  if (!user) {
    return { rows: [], total: 0, page: 1, pageSize: 25, allTags: [] }
  }
  const parsed = contactListFiltersSchema.safeParse({
    page: 1,
    pageSize: 25,
    sort: 'recent',
    ...filters,
  })
  if (!parsed.success) {
    return { rows: [], total: 0, page: 1, pageSize: 25, allTags: [] }
  }
  const f = parsed.data
  const supabase = await createClient()

  let query = supabase.from('contacts').select('*', { count: 'exact' })

  if (f.q) {
    const escaped = f.q.replace(/[%_]/g, (m) => `\\${m}`)
    query = query.or(
      [
        `name.ilike.%${escaped}%`,
        `phone.ilike.%${escaped}%`,
        `email.ilike.%${escaped}%`,
        `company.ilike.%${escaped}%`,
      ].join(','),
    )
  }
  if (f.tag) query = query.contains('tags', [f.tag])
  if (f.source) query = query.eq('source', f.source)

  if (f.sort === 'name') {
    query = query.order('name', { ascending: true, nullsFirst: false })
  } else {
    query = query.order('created_at', { ascending: false })
  }

  const from = (f.page - 1) * f.pageSize
  const to = from + f.pageSize - 1
  query = query.range(from, to)

  const { data, count, error } = await query
  if (error || !data) {
    return { rows: [], total: 0, page: f.page, pageSize: f.pageSize, allTags: [] }
  }

  // Collect distinct tags from the current page only — full-org tag enumeration
  // would scan the entire table on every request; we surface filter chips from
  // the page result + the actively-selected tag.
  const tagSet = new Set<string>()
  for (const row of data) {
    for (const t of row.tags ?? []) tagSet.add(t)
  }
  if (f.tag) tagSet.add(f.tag)
  const allTags = [...tagSet].sort()

  return {
    rows: data,
    total: count ?? 0,
    page: f.page,
    pageSize: f.pageSize,
    allTags,
  }
}

export interface ContactDetail extends ContactRow {
  conversations: Array<{
    id: string
    channel: string
    last_message: string | null
    last_message_at: string | null
    status: string
  }>
  call_logs: Array<{
    id: string
    direction: 'inbound' | 'outbound'
    from_number: string | null
    to_number: string | null
    status: string | null
    duration_seconds: number | null
    recording_url: string | null
    started_at: string | null
  }>
}

export async function getContact(id: string): Promise<ContactDetail | null> {
  const user = await getUser()
  if (!user) return null
  const supabase = await createClient()
  const { data: contact } = await supabase
    .from('contacts')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (!contact) return null

  const { data: convs } = await supabase
    .from('conversations')
    .select('id, channel, last_message, last_message_at, status')
    .eq('contact_id', id)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(20)

  const { data: calls } = await supabase
    .from('call_logs')
    .select('id, direction, from_number, to_number, status, duration_seconds, recording_url, started_at')
    .eq('contact_id', id)
    .order('started_at', { ascending: false, nullsFirst: false })
    .limit(20)

  return {
    ...(contact as ContactRow),
    conversations: convs ?? [],
    call_logs: (calls ?? []) as ContactDetail['call_logs'],
  }
}

/**
 * Creates a contact, dedup-by-phone when a phone is provided. If a contact in
 * the same org already has the same normalised phone, we return its id without
 * inserting — the form treats that as a friendly "linked existing" outcome.
 */
export async function createContact(
  input: ContactFormInput,
): Promise<{ id?: string; existed?: boolean; error?: string }> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const parsed = contactSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid contact data' }
  }
  const data = normaliseContactInput(parsed.data)
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No organization found.' }

  // Dedup by phone (preferred) then email
  if (data.phone) {
    const { data: existing } = await supabase
      .from('contacts')
      .select('id')
      .eq('phone', data.phone)
      .maybeSingle()
    if (existing) return { id: existing.id, existed: true }
  } else if (data.email) {
    const { data: existing } = await supabase
      .from('contacts')
      .select('id')
      .eq('email', data.email)
      .maybeSingle()
    if (existing) return { id: existing.id, existed: true }
  }

  const { data: inserted, error } = await supabase
    .from('contacts')
    .insert({
      org_id: orgId,
      name: data.name,
      phone: data.phone,
      email: data.email,
      company: data.company,
      notes: data.notes,
      tags: data.tags,
      source: data.source,
      created_by: user.id,
    })
    .select('id')
    .single()
  if (error || !inserted) return { error: error?.message ?? 'Insert failed' }

  revalidatePath('/contacts')
  return { id: inserted.id }
}

export async function updateContact(
  id: string,
  input: ContactFormInput,
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const parsed = contactSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid contact data' }
  }
  const data = normaliseContactInput(parsed.data)
  const supabase = await createClient()

  const { error } = await supabase
    .from('contacts')
    .update({
      name: data.name,
      phone: data.phone,
      email: data.email,
      company: data.company,
      notes: data.notes,
      tags: data.tags,
    })
    .eq('id', id)
  if (error) return { error: error.message }

  revalidatePath('/contacts')
  revalidatePath(`/contacts/${id}`)
}

export async function deleteContact(
  id: string,
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  const { error } = await supabase.from('contacts').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/contacts')
}

export async function deleteContacts(
  ids: string[],
): Promise<{ error?: string; deleted?: number }> {
  if (ids.length === 0) return { deleted: 0 }
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  const { error, count } = await supabase
    .from('contacts')
    .delete({ count: 'exact' })
    .in('id', ids)
  if (error) return { error: error.message }
  revalidatePath('/contacts')
  return { deleted: count ?? 0 }
}

// ─── CSV Import ──────────────────────────────────────────────────────────────

export interface CsvPreview {
  headers: string[]
  rows: string[][]
  suggestedMapping: Record<string, ContactField | null>
  totalRows: number
}

export async function previewCsv(
  csvText: string,
): Promise<{ error?: string; preview?: CsvPreview }> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  if (!csvText || csvText.length > 5 * 1024 * 1024) {
    return { error: 'CSV must be non-empty and under 5MB.' }
  }
  const parsed = parseCsv(csvText)
  if (!parsed.headers.length) {
    return { error: 'No columns detected — is this a valid CSV?' }
  }
  return {
    preview: {
      headers: parsed.headers,
      rows: parsed.rows.slice(0, 5),
      suggestedMapping: suggestColumnMapping(parsed.headers),
      totalRows: parsed.rows.length,
    },
  }
}

export interface ImportSummary {
  inserted: number
  skipped: number
  errors: number
  errorSamples: string[]
}

export async function importContactsCsv(
  csvText: string,
  mapping: Record<string, ContactField | null>,
): Promise<{ error?: string; summary?: ImportSummary }> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  if (!csvText) return { error: 'No CSV provided.' }

  const parsed = parseCsv(csvText)
  if (!parsed.headers.length) return { error: 'Invalid CSV — no headers.' }

  // Build index lookup: contact field → header column index
  const fieldToIdx: Partial<Record<ContactField, number>> = {}
  for (const [header, field] of Object.entries(mapping)) {
    if (!field || !CONTACT_FIELDS.includes(field)) continue
    const idx = parsed.headers.indexOf(header)
    if (idx >= 0) fieldToIdx[field] = idx
  }

  if (
    fieldToIdx.name === undefined &&
    fieldToIdx.phone === undefined &&
    fieldToIdx.email === undefined
  ) {
    return { error: 'Map at least one of name, phone, or email.' }
  }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No organization found.' }

  // Fetch existing phones/emails in one shot for dedup. For very large imports
  // this scales linearly with org contact count; acceptable for v1.
  const { data: existing } = await supabase
    .from('contacts')
    .select('phone, email')
  const existingPhones = new Set(
    (existing ?? [])
      .map((r) => r.phone)
      .filter((p): p is string => Boolean(p)),
  )
  const existingEmails = new Set(
    (existing ?? [])
      .map((r) => r.email)
      .filter((e): e is string => Boolean(e)),
  )

  type InsertRow = Database['public']['Tables']['contacts']['Insert']
  const toInsert: InsertRow[] = []
  const summary: ImportSummary = {
    inserted: 0,
    skipped: 0,
    errors: 0,
    errorSamples: [],
  }

  const seenInBatchPhones = new Set<string>()
  const seenInBatchEmails = new Set<string>()

  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i]
    const getField = (f: ContactField): string | null => {
      const idx = fieldToIdx[f]
      if (idx === undefined) return null
      const v = (row[idx] ?? '').trim()
      return v || null
    }

    const name = getField('name')
    const phone = normalisePhone(getField('phone'))
    const email = normaliseEmail(getField('email'))
    const company = getField('company')
    const notes = getField('notes')
    const tagsRaw = getField('tags')
    const tags = tagsRaw
      ? tagsRaw.split(/[;,|]/).map((t) => t.trim()).filter(Boolean).slice(0, 50)
      : []

    if (!name && !phone && !email) {
      summary.skipped++
      continue
    }
    if (phone && (existingPhones.has(phone) || seenInBatchPhones.has(phone))) {
      summary.skipped++
      continue
    }
    if (
      !phone &&
      email &&
      (existingEmails.has(email) || seenInBatchEmails.has(email))
    ) {
      summary.skipped++
      continue
    }

    if (phone) seenInBatchPhones.add(phone)
    if (email) seenInBatchEmails.add(email)

    toInsert.push({
      org_id: orgId,
      name,
      phone,
      email,
      company,
      notes,
      tags,
      source: 'csv_import' as ContactSource,
      created_by: user.id,
    })
  }

  // Bulk insert in chunks of 500 so we don't blow the request body.
  const CHUNK = 500
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const chunk = toInsert.slice(i, i + CHUNK)
    const { data, error } = await supabase
      .from('contacts')
      .insert(chunk)
      .select('id')
    if (error) {
      summary.errors += chunk.length
      if (summary.errorSamples.length < 3) summary.errorSamples.push(error.message)
    } else {
      summary.inserted += data?.length ?? 0
    }
  }

  revalidatePath('/contacts')
  return { summary }
}

/**
 * Retroactive linking: for every conversation in the active org that has a
 * non-null visitor_phone and a NULL contact_id, look up the matching contact
 * by phone (org-scoped) and assign contact_id. Returns how many were linked.
 *
 * Idempotent: safe to run repeatedly. Skips conversations whose phone has no
 * contact match (the inbound webhook should create the contact going forward).
 */
export async function linkConversationsToContacts(): Promise<{
  error?: string
  linked?: number
}> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()

  const { data: convs, error: cErr } = await supabase
    .from('conversations')
    .select('id, visitor_phone')
    .is('contact_id', null)
    .not('visitor_phone', 'is', null)
  if (cErr) return { error: cErr.message }
  if (!convs || convs.length === 0) return { linked: 0 }

  // Build phone → contact_id map for the org. RLS scopes both queries.
  const phones = [...new Set(convs.map((c) => normalisePhone(c.visitor_phone)).filter((p): p is string => Boolean(p)))]
  if (phones.length === 0) return { linked: 0 }

  const { data: contactRows } = await supabase
    .from('contacts')
    .select('id, phone')
    .in('phone', phones)
  const phoneToId = new Map<string, string>()
  for (const c of contactRows ?? []) {
    if (c.phone) phoneToId.set(c.phone, c.id)
  }

  let linked = 0
  for (const conv of convs) {
    const normalised = normalisePhone(conv.visitor_phone)
    if (!normalised) continue
    const contactId = phoneToId.get(normalised)
    if (!contactId) continue
    const { error } = await supabase
      .from('conversations')
      .update({ contact_id: contactId })
      .eq('id', conv.id)
    if (!error) linked++
  }

  revalidatePath('/contacts')
  return { linked }
}
