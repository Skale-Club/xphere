'use server'

/**
 * Server actions for the Contacts CRM page (SEED-006 / v2.1).
 *
 * Patterns mirror src/app/(dashboard)/agents/actions.ts:
 *   - Cached getUser() for auth gating
 *   - RLS-scoped createClient() | never filter by org_id manually
 *   - Service-role client only for cross-table linking jobs that must outrun
 *     get_current_org_id()
 *
 * Naming convention: getContacts/getContact use plain reads; create/update/delete
 * write through the user's client so RLS denies cross-org mutations; bulk
 * imports use the user client too (RLS auto-injects org_id via default-ish
 * checks | we still pass org_id explicitly because the column is NOT NULL).
 */

import { revalidatePath } from 'next/cache'
import { createClient, getUser } from '@/lib/supabase/server'
import type { Database, ContactSource } from '@/types/database'
import { getDefinitions } from '@/app/(dashboard)/settings/custom-fields/actions'
import { FIELD_RENDER_CONFIG } from '@/lib/custom-fields/render-config'
import type { CustomFieldType } from '@/types/database'
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
import { setContactTags, type TagRow } from '@/app/(dashboard)/settings/tags/actions'
import { validateCustomFields } from '@/lib/custom-fields'

type ContactRow = Database['public']['Tables']['contacts']['Row']

export interface ContactListResult {
  rows: ContactRow[]
  total: number
  page: number
  pageSize: number
  allTags: TagRow[]
}

export async function getContacts(
  filters: Partial<ContactListFilters> = {},
  cfFilters: Record<string, string> = {},
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

  // Load all org tags for filter chips and colored display
  const { data: orgIdData } = await supabase.rpc('get_current_org_id')
  const { data: tagRows } = orgIdData
    ? await supabase.from('tags').select('*').order('name')
    : { data: [] }
  const allTags: TagRow[] = (tagRows ?? []).map((t) => ({
    ...t,
    contact_count: 0,
    opportunity_count: 0,
  }))

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
  if (f.tag) {
    // f.tag may be a tag ID (new system) or a tag name (legacy URL).
    // Try ID match first via contact_tags, fall back to text[] contains.
    const tagObj = allTags.find((t) => t.id === f.tag || t.slug === f.tag || t.name === f.tag)
    if (tagObj) {
      const { data: ctRows } = await supabase
        .from('contact_tags')
        .select('contact_id')
        .eq('tag_id', tagObj.id)
      const contactIds = (ctRows ?? []).map((r) => r.contact_id)
      if (contactIds.length > 0) {
        query = query.in('id', contactIds)
      } else {
        // No contacts for this tag | return empty
        return { rows: [], total: 0, page: f.page, pageSize: f.pageSize, allTags }
      }
    } else {
      query = query.contains('tags', [f.tag])
    }
  }
  if (f.source) query = query.eq('source', f.source)

  // Custom field exact-match filters (CF-09)
  for (const [key, rawValue] of Object.entries(cfFilters)) {
    if (!key || rawValue === undefined) continue
    let val: unknown = rawValue
    if (rawValue === 'true') val = true
    else if (rawValue === 'false') val = false
    else if (rawValue !== '' && !isNaN(Number(rawValue))) val = Number(rawValue)
    query = query.filter('custom_fields', 'cs', JSON.stringify({ [key]: val }))
  }

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
    return { rows: [], total: 0, page: f.page, pageSize: f.pageSize, allTags }
  }

  return {
    rows: data,
    total: count ?? 0,
    page: f.page,
    pageSize: f.pageSize,
    allTags,
  }
}

export interface ContactTagEntity {
  id: string
  name: string
  color: string
  slug: string
}

export interface ContactDetail extends ContactRow {
  tagIds: string[]
  tagEntities: ContactTagEntity[]
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
  opportunities: Array<{
    id: string
    title: string
    value: number
    currency: string
    status: 'open' | 'won' | 'lost'
    updated_at: string
    stage: { id: string; name: string; color: string } | null
  }>
  /** SEED-039: tasks linked to this contact (limit 5, soonest due first). */
  tasks: Array<{
    id: string
    title: string
    due_date: string | null
    priority: string
    status: string
  }>
  /** SEED-039: bookings linked to this contact (limit 5). */
  bookings: Array<{
    id: string
    booker_name: string
    start_at: string
    end_at: string
    status: string
    event_type_name: string | null
  }>
  /** SEED-039: notes from the `notes` table for this contact (limit 5). */
  contact_notes: Array<{
    id: string
    content: string
    created_at: string
  }>
  /** SEED-039: custom field definitions for the `contact` entity. */
  customFieldDefs: Array<{
    id: string
    key: string
    label: string
    type: string
  }>
  /** SEED-039: linked account (resolved from `account_id`). */
  account: {
    id: string
    name: string
    website: string | null
    address: string | null
  } | null
}

export async function getContact(id: string): Promise<ContactDetail | null> {
  const user = await getUser()
  if (!user) return null
  const supabase = await createClient()
  const [
    { data: contact },
    { data: contactTagRows },
    { data: convs },
    { data: calls },
    { data: opps },
    { data: tasks },
    { data: bookings },
    { data: notes },
    defsResult,
  ] = await Promise.all([
    supabase.from('contacts').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('contact_tags')
      .select('tag_id, tags(id, name, color, slug)')
      .eq('contact_id', id),
    supabase
      .from('conversations')
      .select('id, channel, last_message, last_message_at, status')
      .eq('contact_id', id)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(20),
    supabase
      .from('call_logs')
      .select('id, direction, from_number, to_number, status, duration_seconds, recording_url, started_at')
      .eq('contact_id', id)
      .order('started_at', { ascending: false, nullsFirst: false })
      .limit(20),
    supabase
      .from('opportunities')
      .select('id, title, value, currency, status, updated_at, stage:pipeline_stages(id, name, color)')
      .eq('contact_id', id)
      .order('updated_at', { ascending: false })
      .limit(20),
    // SEED-039: tasks for this contact
    supabase
      .from('tasks')
      .select('id, title, due_date, priority, status')
      .eq('entity_type', 'contact')
      .eq('entity_id', id)
      .neq('status', 'cancelled')
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(5),
    // SEED-039: bookings for this contact (event_type joined for label)
    supabase
      .from('bookings')
      .select('id, booker_name, start_at, end_at, status, event_types(name)')
      .eq('linked_contact_id', id)
      .order('start_at', { ascending: false })
      .limit(5),
    // SEED-039: notes from the dedicated notes table (separate from contacts.notes)
    supabase
      .from('notes')
      .select('id, content, created_at')
      .eq('entity_type', 'contact')
      .eq('entity_id', id)
      .order('created_at', { ascending: false })
      .limit(5),
    // SEED-039: custom field definitions for the contact entity
    getDefinitions({ entity: 'contact', includeArchived: false }),
  ])
  if (!contact) return null

  const tagEntities: ContactTagEntity[] = (contactTagRows ?? [])
    .map((r) => (r.tags as ContactTagEntity | null))
    .filter((t): t is ContactTagEntity => Boolean(t))
  const tagIds = tagEntities.map((t) => t.id)

  const bookingRows = (bookings ?? []).map((b) => {
    const et = b.event_types as { name?: string | null } | { name?: string | null }[] | null
    const eventName = Array.isArray(et) ? et[0]?.name ?? null : et?.name ?? null
    return {
      id: b.id,
      booker_name: b.booker_name,
      start_at: b.start_at,
      end_at: b.end_at,
      status: b.status,
      event_type_name: eventName,
    }
  })

  const customFieldDefs = defsResult.ok
    ? defsResult.data.map((d) => ({ id: d.id, key: d.key, label: d.label, type: d.type as string }))
    : []

  // SEED-039: resolve linked account when set so the panel can render a
  // clickable "Company" link and surface the account address.
  let account: ContactDetail['account'] = null
  if ((contact as ContactRow).account_id) {
    const { data: acct } = await supabase
      .from('accounts')
      .select('id, name, website, address')
      .eq('id', (contact as ContactRow).account_id!)
      .maybeSingle()
    if (acct) {
      account = {
        id: acct.id,
        name: acct.name,
        website: acct.website ?? null,
        address: acct.address ?? null,
      }
    }
  }

  return {
    ...(contact as ContactRow),
    tagIds,
    tagEntities,
    conversations: convs ?? [],
    call_logs: (calls ?? []) as ContactDetail['call_logs'],
    opportunities: ((opps ?? []) as unknown as ContactDetail['opportunities']),
    tasks: (tasks ?? []) as ContactDetail['tasks'],
    bookings: bookingRows,
    contact_notes: (notes ?? []) as ContactDetail['contact_notes'],
    customFieldDefs,
    account,
  }
}

/**
 * Creates a contact, dedup-by-phone when a phone is provided. If a contact in
 * the same org already has the same normalised phone, we return its id without
 * inserting | the form treats that as a friendly "linked existing" outcome.
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

  // Validate and persist custom fields (CF-07, Phase 71)
  const cfPayloadCreate = parsed.data.custom_fields ?? {}
  if (Object.keys(cfPayloadCreate).length > 0) {
    const cfResult = await validateCustomFields(orgId, 'contact', cfPayloadCreate)
    if (!cfResult.ok) {
      return { error: 'custom_fields_invalid', details: cfResult.errors } as { error: string; details?: unknown }
    }
  }

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

  // Resolve tag IDs → names for the legacy text[] column (kept in sync until 062)
  let tagNames: string[] = []
  if (data.tags.length > 0) {
    const { data: tagRows } = await supabase
      .from('tags')
      .select('id, name')
      .in('id', data.tags)
    tagNames = (tagRows ?? []).map((t) => t.name)
  }

  const { data: inserted, error } = await supabase
    .from('contacts')
    .insert({
      org_id: orgId,
      name: data.name,
      phone: data.phone,
      email: data.email,
      company: data.company,
      account_id: data.account_id,
      notes: data.notes,
      tags: tagNames,
      source: data.source,
      created_by: user.id,
      ...(Object.keys(cfPayloadCreate).length > 0 && { custom_fields: cfPayloadCreate }),
    })
    .select('id')
    .single()
  if (error || !inserted) return { error: error?.message ?? 'Insert failed' }

  if (data.tags.length > 0) {
    await setContactTags(inserted.id, data.tags)
  }

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

  // Validate and persist custom fields (CF-07, Phase 71)
  const cfPayloadUpdate = parsed.data.custom_fields ?? {}
  if (Object.keys(cfPayloadUpdate).length > 0) {
    const { data: orgId } = await supabase.rpc('get_current_org_id')
    if (orgId) {
      const cfResult = await validateCustomFields(orgId, 'contact', cfPayloadUpdate)
      if (!cfResult.ok) return { error: 'custom_fields_invalid' }
    }
  }

  // Resolve tag IDs → names for the legacy text[] column (kept in sync until 062)
  let tagNames: string[] = []
  if (data.tags.length > 0) {
    const { data: tagRows } = await supabase
      .from('tags')
      .select('id, name')
      .in('id', data.tags)
    tagNames = (tagRows ?? []).map((t) => t.name)
  }

  const { error } = await supabase
    .from('contacts')
    .update({
      name: data.name,
      phone: data.phone,
      email: data.email,
      company: data.company,
      account_id: data.account_id,
      notes: data.notes,
      tags: tagNames,
      ...(Object.keys(cfPayloadUpdate).length > 0 && { custom_fields: cfPayloadUpdate }),
    })
    .eq('id', id)
  if (error) return { error: error.message }

  await setContactTags(id, data.tags)

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
    return { error: 'No columns detected | is this a valid CSV?' }
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
  mapping: Record<string, string | null>,
): Promise<{ error?: string; summary?: ImportSummary }> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  if (!csvText) return { error: 'No CSV provided.' }

  const parsed = parseCsv(csvText)
  if (!parsed.headers.length) return { error: 'Invalid CSV | no headers.' }

  // Build index lookup: contact field → header column index
  const fieldToIdx: Partial<Record<ContactField, number>> = {}
  const cfFieldToIdx: Record<string, number> = {}
  for (const [header, field] of Object.entries(mapping)) {
    if (!field) continue
    if (field.startsWith('cf:')) {
      const cfKey = field.slice(3)
      const idx = parsed.headers.indexOf(header)
      if (idx >= 0) cfFieldToIdx[cfKey] = idx
    } else if ((CONTACT_FIELDS as readonly string[]).includes(field)) {
      const idx = parsed.headers.indexOf(header)
      if (idx >= 0) fieldToIdx[field as ContactField] = idx
    }
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

    // Extract custom field values from cf: mapped columns
    const rowCustomFields: Record<string, string> = {}
    for (const [cfKey, idx] of Object.entries(cfFieldToIdx)) {
      const v = (row[idx] ?? '').trim()
      if (v) rowCustomFields[cfKey] = v
    }

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
      ...(Object.keys(rowCustomFields).length > 0 && { custom_fields: rowCustomFields }),
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

// ─── Inline field update (SEED-039) ─────────────────────────────────────────

const INLINE_BUILTIN_FIELDS = ['name', 'phone', 'email', 'company'] as const
type InlineBuiltinField = (typeof INLINE_BUILTIN_FIELDS)[number]

export interface UpdateContactFieldResult {
  ok: boolean
  error?: string
}

/**
 * Patch a single inline-editable field on a contact. Supports builtin columns
 * (`name`/`phone`/`email`/`company`) and JSONB custom fields via dotted path
 * `custom_fields.{key}`. Validates the field name and normalises phone/email
 * before writing. Returns `{ ok: false, error }` on failure rather than
 * throwing | callers (inline editor) display the message via toast.
 */
export async function updateContactField(
  contactId: string,
  patch: { field: string; value: string },
): Promise<UpdateContactFieldResult> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }
  if (!contactId) return { ok: false, error: 'Missing contact id' }

  const { field, value } = patch
  const supabase = await createClient()

  if ((INLINE_BUILTIN_FIELDS as readonly string[]).includes(field)) {
    const f = field as InlineBuiltinField
    let normalised: string | null = value.trim()
    if (f === 'phone') normalised = normalisePhone(normalised) ?? null
    if (f === 'email') normalised = normaliseEmail(normalised) ?? null
    if (!normalised) normalised = null
    const updates: Record<string, string | null> = { [f]: normalised }
    const { error } = await supabase.from('contacts').update(updates).eq('id', contactId)
    if (error) return { ok: false, error: error.message }
    revalidatePath('/contacts')
    return { ok: true }
  }

  // Custom field path: "custom_fields.<key>"
  if (field.startsWith('custom_fields.')) {
    const key = field.slice('custom_fields.'.length)
    if (!key) return { ok: false, error: 'Invalid custom field key' }

    // Read current jsonb so we can merge | there is no convenient jsonb_set
    // shortcut through PostgREST that handles non-existent paths cleanly.
    const { data: row, error: readErr } = await supabase
      .from('contacts')
      .select('custom_fields, org_id')
      .eq('id', contactId)
      .maybeSingle()
    if (readErr) return { ok: false, error: readErr.message }
    if (!row) return { ok: false, error: 'Contact not found' }

    const current = (row.custom_fields as Record<string, unknown> | null) ?? {}
    const trimmed = value.trim()
    const next: Record<string, unknown> = { ...current }
    if (trimmed === '') {
      delete next[key]
    } else {
      next[key] = trimmed
    }

    // Validate via the shared custom-fields validator (skips empty payloads).
    if (Object.keys(next).length > 0) {
      const cfResult = await validateCustomFields(row.org_id, 'contact', next)
      if (!cfResult.ok) return { ok: false, error: 'custom_fields_invalid' }
    }

    const { error } = await supabase
      .from('contacts')
      .update({ custom_fields: next })
      .eq('id', contactId)
    if (error) return { ok: false, error: error.message }
    revalidatePath('/contacts')
    return { ok: true }
  }

  return { ok: false, error: `Unsupported field "${field}"` }
}

// ─── Inline note add (SEED-039) ─────────────────────────────────────────────

export async function addContactNote(
  contactId: string,
  content: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }
  const trimmed = content.trim()
  if (!trimmed) return { ok: false, error: 'Empty note' }
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No active org' }

  const { error } = await supabase.from('notes').insert({
    org_id: orgId,
    content: trimmed,
    entity_type: 'contact',
    entity_id: contactId,
    created_by: user.id,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/contacts')
  return { ok: true }
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

// ─── Export (CF-13) ──────────────────────────────────────────────────────────

function csvEscape(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`
  }
  return val
}

export async function exportContactsCsv(): Promise<{ error?: string; csv?: string }> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()

  const [{ data: contacts }, defsResult] = await Promise.all([
    supabase.from('contacts').select('*').order('created_at', { ascending: false }).limit(5000),
    getDefinitions({ entity: 'contact', includeArchived: false }),
  ])
  if (!contacts) return { error: 'Failed to fetch contacts.' }
  const defs = defsResult.ok ? defsResult.data : []

  // Standard headers
  const stdHeaders = ['name', 'phone', 'email', 'company', 'notes', 'source', 'created_at']
  // Custom field headers | currency expands to two columns
  const cfHeaders: string[] = []
  for (const def of defs) {
    if (def.type === 'currency') {
      cfHeaders.push(`${def.key}_amount`, `${def.key}_currency`)
    } else {
      cfHeaders.push(def.label)
    }
  }

  const lines: string[] = [[...stdHeaders, ...cfHeaders].map(csvEscape).join(',')]

  for (const c of contacts) {
    const cf = (c.custom_fields ?? {}) as Record<string, unknown>
    const row: string[] = [
      c.name ?? '',
      c.phone ?? '',
      c.email ?? '',
      c.company ?? '',
      c.notes ?? '',
      c.source ?? '',
      c.created_at ?? '',
    ]
    for (const def of defs) {
      const val = cf[def.key]
      if (def.type === 'currency') {
        const curr = val as { amount?: number; currency?: string } | null | undefined
        row.push(String(curr?.amount ?? ''), curr?.currency ?? '')
      } else {
        const config = FIELD_RENDER_CONFIG[def.type as CustomFieldType]
        row.push(val !== undefined && val !== null ? config.displayFormatter(val) : '')
      }
    }
    lines.push(row.map(csvEscape).join(','))
  }

  return { csv: lines.join('\n') }
}
