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
import { assertWritable } from '@/lib/demo/guard'
import { requirePermission } from '@/lib/rbac/server'
import type { Database, ContactSource, ChannelProvider } from '@/types/database'
import { getDefinitions } from '@/app/(dashboard)/settings/custom-fields/actions'
import { FIELD_RENDER_CONFIG } from '@/lib/custom-fields/render-config'
import type { CustomFieldType } from '@/types/database'
import {
  contactSchema,
  contactListFiltersSchema,
  normalisePhone,
  normaliseEmail,
  normaliseEmailStrict,
  normaliseContactInput,
  type ContactFormInput,
  type ContactListFilters,
} from '@/lib/contacts/zod-schemas'
import { isBlockedEmail } from '@/lib/contacts/blocked-emails'
import {
  parseCsv,
  suggestColumnMapping,
  CONTACT_FIELDS,
  type ContactField,
} from '@/lib/contacts/csv'
import { setContactTags, type TagRow } from '@/app/(dashboard)/settings/tags/actions'
import { validateCustomFields } from '@/lib/custom-fields'
import { composeContactName, splitContactName } from '@/lib/contacts/names'
import { resolveLiveContactId, findByPhone, findByEmail, attachChannelIdentity, hasVerifications } from '@/lib/contacts/server'
import { syncContactToGoogle, syncContactUpdateToGoogle } from '@/lib/google-contacts/sync'

/**
 * Phase 108 D-04: maps conversations.channel enum values to the corresponding
 * channel identity provider. Only `widget` is remapped (→ `webchat`); the rest
 * pass through identically.
 */
const CHANNEL_TO_PROVIDER: Record<string, ChannelProvider> = {
  whatsapp: 'whatsapp',
  telegram: 'telegram',
  messenger: 'messenger',
  instagram: 'instagram',
  widget: 'webchat',
}

type ContactRow = Database['public']['Tables']['contacts']['Row']

/**
 * Source of the dedup match when {@link createContact} returns `existed: true`.
 *
 * - `'phone'` | only the normalized phone matched an existing contact
 * - `'email'` | only the normalized email matched
 * - `'both_same'` | phone and email both matched the SAME existing contact (D-01a)
 * - `'multi_conflict'` | phone matched contact X, email matched contact Y; a
 *   fresh row was inserted with `identity_status='merge_conflict'` for the
 *   admin UI to resolve (D-01). May also surface on the 23505 fallback path.
 * - `null` | no dedup match, plain insert (only on `existed: false`)
 */
export type MatchedVia = 'phone' | 'email' | 'both_same' | 'multi_conflict' | null

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
        `first_name.ilike.%${escaped}%`,
        `last_name.ilike.%${escaped}%`,
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
  if (f.identity_status) query = query.eq('identity_status', f.identity_status)

  // Custom field exact-match filters (CF-09)
  for (const [key, rawValue] of Object.entries(cfFilters)) {
    if (!key || rawValue === undefined) continue
    let val: unknown = rawValue
    if (rawValue === 'true') val = true
    else if (rawValue === 'false') val = false
    else if (rawValue !== '' && !isNaN(Number(rawValue))) val = Number(rawValue)
    query = query.filter('custom_fields', 'cs', JSON.stringify({ [key]: val }))
  }

  // Sort: supports legacy 'recent' | 'name' and new 'column:direction' format
  const sortValue = f.sort ?? 'recent'
  if (sortValue.includes(':')) {
    const [col, dir] = sortValue.split(':')
    const ascending = dir === 'asc'
    if (col === 'name') {
      query = query
        .order('first_name', { ascending, nullsFirst: false })
        .order('last_name', { ascending, nullsFirst: false })
        .order('name', { ascending, nullsFirst: false })
    } else {
      query = query.order(col, { ascending, nullsFirst: false })
    }
  } else if (sortValue === 'name') {
    query = query
      .order('first_name', { ascending: true, nullsFirst: false })
      .order('last_name', { ascending: true, nullsFirst: false })
      .order('name', { ascending: true, nullsFirst: false })
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
    created_at?: string
    updated_at?: string
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
    pipeline_id: string
    title: string
    value: number
    currency: string
    status: 'open' | 'won' | 'lost'
    updated_at: string
    stage: { id: string; name: string; color: string } | null
  }>
  /** SEED-039: tasks linked to this contact (limit 5, soonest due first). */
  tasks: Array<Database['public']['Tables']['tasks']['Row']>
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
  /**
   * Phase 110 (CID-14): true when at least one row exists in
   * `contact_verifications` for this contact. Used by IdentityStatusBadge
   * to derive the 'identified' → 'verified' effective sub-state.
   * Pitfall 7: single-contact only — not populated on list/CSV paths.
   */
  is_verified: boolean
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
    { data: oppLinks },
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
      .select('id, channel, last_message, last_message_at, created_at, updated_at, status')
      .eq('contact_id', id)
      .order('updated_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('call_logs')
      .select('id, direction, from_number, to_number, status, duration_seconds, recording_url, started_at')
      .eq('contact_id', id)
      .order('started_at', { ascending: false, nullsFirst: false })
      .limit(20),
    supabase
      .from('opportunity_contacts')
      .select('opportunity_id')
      .eq('contact_id', id),
    // SEED-039: tasks for this contact
    supabase
      .from('tasks')
      .select('*')
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

  // Phase 110 (CID-14): derive is_verified for the IdentityStatusBadge.
  // Runs as a small EXISTS query — single-contact scope only (Pitfall 7).
  const is_verified = await hasVerifications(supabase, id)

  // Fetch opportunities via junction table + backward-compatible contact_id
  const linkedOppIds = (oppLinks ?? []).map((r) => r.opportunity_id)
  const { data: oppsFromLink } = linkedOppIds.length > 0
    ? await supabase
        .from('opportunities')
        .select('id, pipeline_id, title, value, currency, status, updated_at, stage:pipeline_stages(id, name, color)')
        .in('id', linkedOppIds)
        .order('updated_at', { ascending: false })
        .limit(20)
    : { data: [] }
  const { data: oppsFromFk } = await supabase
    .from('opportunities')
    .select('id, pipeline_id, title, value, currency, status, updated_at, stage:pipeline_stages(id, name, color)')
    .eq('contact_id', id)
    .order('updated_at', { ascending: false })
    .limit(20)

  const oppsMap = new Map<string, unknown>()
  for (const o of (oppsFromLink ?? [])) oppsMap.set(o.id, o)
  for (const o of (oppsFromFk ?? [])) oppsMap.set(o.id, o)
  const opps = Array.from(oppsMap.values())

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
    conversations: (convs ?? []).sort((a, b) => {
      const ta = new Date(a.last_message_at ?? a.updated_at ?? a.created_at).getTime()
      const tb = new Date(b.last_message_at ?? b.updated_at ?? b.created_at).getTime()
      return tb - ta
    }),
    call_logs: (calls ?? []) as ContactDetail['call_logs'],
    opportunities: ((opps ?? []) as unknown as ContactDetail['opportunities']),
    tasks: (tasks ?? []) as ContactDetail['tasks'],
    bookings: bookingRows,
    contact_notes: (notes ?? []) as ContactDetail['contact_notes'],
    customFieldDefs,
    account,
    is_verified,
  }
}

/**
 * Creates a contact with race-safe dedup against the partial UNIQUE indexes
 * landed in migration 1059 (Phase 107, CID-07/CID-08).
 *
 * Behavior (per 107-CONTEXT.md D-01..D-01c, D-04):
 *  1. Pre-check both normalized identity columns (`phone_e164`,
 *     `email_normalized`) via the canonical helpers in `lib/contacts/server`.
 *     Filters out `archived_duplicate` so merged rows do not block survivors.
 *  2. Both pre-checks hit the SAME contact → return it as `both_same` (D-01a).
 *  3. Only phone or only email hits → return that contact (D-01a).
 *  4. Phone hits A and email hits B (different ids) → fall through to INSERT
 *     with `identity_status='merge_conflict'` and `matched_via='multi_conflict'`
 *     so Phase 106's /admin/contacts/conflicts UI can surface it (D-01).
 *  5. Neither hits → plain insert with `identity_status='identified'`.
 *  6. On INSERT 23505 (unique_violation) → recover by re-querying via the
 *     normalized columns (D-01b race recovery + D-01c multi-conflict fallback).
 */
export async function createContact(
  input: ContactFormInput,
): Promise<{
  id?: string
  existed?: boolean
  matched_via?: MatchedVia
  error?: string
  details?: unknown
}> {
  const denied = await assertWritable()
  if (denied) return denied
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const perm = await requirePermission('contacts.manage')
  if (!perm.ok) return { error: perm.error ?? 'Forbidden' }
  const parsed = contactSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid contact data' }
  }
  let data = normaliseContactInput(parsed.data)
  // D-04a (Phase 110-02): defense in depth. Zod already rejects placeholder
  // emails at the form layer; this guards programmatic callers that bypass
  // the schema. Silently null out so the contact still creates via phone
  // (Phase 109 invariant: phone OR email OR channel identity).
  if (data.email && isBlockedEmail(data.email)) {
    data = { ...data, email: null }
  }
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No organization found.' }

  // Validate and persist custom fields (CF-07, Phase 71)
  const cfPayloadCreate = parsed.data.custom_fields ?? {}
  if (Object.keys(cfPayloadCreate).length > 0) {
    const cfResult = await validateCustomFields(orgId, 'contact', cfPayloadCreate)
    if (!cfResult.ok) {
      return { error: 'custom_fields_invalid', details: cfResult.errors }
    }
  }

  // D-01: pre-check both normalized identity columns BEFORE insert.
  // Use the canonical helpers so the lookup filter stays in sync with the
  // partial UNIQUE index predicate (Pitfall 1 in 107-RESEARCH.md).
  const [phoneHit, emailHit] = await Promise.all([
    findByPhone(supabase, orgId, data.phone),
    findByEmail(supabase, orgId, data.email),
  ])

  // Phase 5: channel_only status for social-source contacts with no phone/email.
  const SOCIAL_SOURCES = ['instagram', 'messenger', 'facebook', 'whatsapp'] as const
  const isSocialSource = (SOCIAL_SOURCES as readonly string[]).includes(data.source)
  const hasIdentity = Boolean(data.phone || data.email)

  let identityStatus: 'identified' | 'merge_conflict' | 'channel_only' = 'identified'
  let matchedVia: MatchedVia = null

  if (!hasIdentity && isSocialSource) {
    // No phone or email from a social channel — contact is channel_only.
    identityStatus = 'channel_only'
  } else if (phoneHit && emailHit && phoneHit.id === emailHit.id) {
    // D-01a: same contact on both fields | return without modification.
    return { id: phoneHit.id, existed: true, matched_via: 'both_same' }
  } else if (phoneHit && emailHit && phoneHit.id !== emailHit.id) {
    // D-01: multi-conflict | insert fresh row flagged for admin review.
    identityStatus = 'merge_conflict'
    matchedVia = 'multi_conflict'
    // Fall through to INSERT below.
  } else if (phoneHit) {
    return { id: phoneHit.id, existed: true, matched_via: 'phone' }
  } else if (emailHit) {
    return { id: emailHit.id, existed: true, matched_via: 'email' }
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

  // D-01b/D-01c: partial UNIQUE indexes contacts_org_phone_uniq + contacts_org_email_uniq
  // close the race window between pre-check and insert. PostgreSQL surfaces
  // unique_violation as SQLSTATE 23505; PostgREST exposes it on error.code.
  const { data: inserted, error } = await supabase
    .from('contacts')
    .insert({
      org_id: orgId,
      first_name: data.first_name,
      last_name: data.last_name,
      name: data.name,
      phone: data.phone,
      email: data.email,
      company: data.company,
      account_id: data.account_id,
      notes: data.notes,
      tags: tagNames,
      source: data.source,
      identity_status: identityStatus,
      created_by: user.id,
      ...(Object.keys(cfPayloadCreate).length > 0 && { custom_fields: cfPayloadCreate }),
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') {
      // D-01c fast path: prefer the contact we already resolved in the
      // pre-check (phone wins per D-01c). Avoids a second round-trip.
      if (phoneHit || emailHit) {
        const fallback = phoneHit ?? emailHit!
        const via: 'phone' | 'email' = phoneHit ? 'phone' : 'email'
        console.log(
          `[contacts/create] contact.unique_collision source=form org_id=${orgId} contact_id=${fallback.id} matched_via=${via}`,
        )
        return { id: fallback.id, existed: true, matched_via: via }
      }
      // D-01b race recovery: pre-check missed (genuine race window). Re-query
      // the normalized columns to discover the winner.
      const [racePhone, raceEmail] = await Promise.all([
        findByPhone(supabase, orgId, data.phone),
        findByEmail(supabase, orgId, data.email),
      ])
      const winner = racePhone ?? raceEmail
      if (winner) {
        const via: 'phone' | 'email' = racePhone ? 'phone' : 'email'
        console.log(
          `[contacts/create] contact.unique_collision source=form org_id=${orgId} contact_id=${winner.id} matched_via=${via}`,
        )
        return { id: winner.id, existed: true, matched_via: via }
      }
    }
    return { error: error.message }
  }
  if (!inserted) return { error: 'Insert failed' }

  if (data.tags.length > 0) {
    await setContactTags(inserted.id, data.tags)
  }

  // Auto-create a placeholder "manual" conversation so the new contact shows
  // up as a card in the Chat Inbox immediately, even before any real channel
  // (WhatsApp, SMS, etc.) is attached. Skip when the contact landed in a
  // merge_conflict state (admin will review) or as channel_only (already came
  // from a real channel). Failure here must not block contact creation.
  if (identityStatus === 'identified') {
    const { error: convErr } = await supabase.from('conversations').insert({
      org_id: orgId,
      widget_token: '',
      contact_id: inserted.id,
      channel: 'manual',
      status: 'open',
    })
    if (convErr) {
      console.log(
        `[contacts/create] manual_conversation.insert_failed org_id=${orgId} contact_id=${inserted.id} code=${convErr.code} message=${convErr.message}`,
      )
    }
  }

  // Sync to Google Contacts if the integration is connected.
  // Fire-and-forget with internal timeout/error-catching — never blocks the UI.
  await syncContactToGoogle(
    {
      name:       data.name,
      first_name: data.first_name,
      last_name:  data.last_name,
      email:      data.email,
      phone:      data.phone,
      company:    data.company,
      notes:      data.notes,
    },
    orgId,
    supabase,
  )

  revalidatePath('/contacts')
  return {
    id: inserted.id,
    existed: false,
    matched_via: matchedVia,
  }
}

export async function updateContact(
  id: string,
  input: ContactFormInput,
): Promise<{ error?: string; merge_conflict?: boolean } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const perm = await requirePermission('contacts.manage')
  if (!perm.ok) return { error: perm.error ?? 'Forbidden' }
  const parsed = contactSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid contact data' }
  }
  const data = normaliseContactInput(parsed.data)
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No organization found.' }

  // Validate and persist custom fields (CF-07, Phase 71)
  const cfPayloadUpdate = parsed.data.custom_fields ?? {}
  if (Object.keys(cfPayloadUpdate).length > 0) {
    const cfResult = await validateCustomFields(orgId, 'contact', cfPayloadUpdate)
    if (!cfResult.ok) return { error: 'custom_fields_invalid' }
  }

  // Phase 3: duplicate detection before update.
  // Check whether the new phone/email collides with a different live contact.
  const [phoneHit, emailHit] = await Promise.all([
    findByPhone(supabase, orgId, data.phone),
    findByEmail(supabase, orgId, data.email),
  ])
  const phoneConflict = phoneHit && phoneHit.id !== id ? phoneHit : null
  const emailConflict = emailHit && emailHit.id !== id ? emailHit : null

  if (phoneConflict && emailConflict && phoneConflict.id === emailConflict.id) {
    // Same other contact owns both — clear duplicate error.
    return {
      error: 'This phone and email already belong to another contact. Use the merge tool to combine them.',
      merge_conflict: true,
    }
  } else if (phoneConflict && emailConflict && phoneConflict.id !== emailConflict.id) {
    // Multi-conflict: phone → contact A, email → contact B.
    // Flag this contact for admin review.
    await supabase
      .from('contacts')
      .update({ identity_status: 'merge_conflict' })
      .eq('id', id)
    revalidatePath('/contacts')
    revalidatePath(`/contacts/${id}`)
    return {
      error: 'Phone matches one contact and email matches another — a merge conflict was flagged for admin review.',
      merge_conflict: true,
    }
  } else if (phoneConflict) {
    return {
      error: 'This phone number already belongs to another contact.',
      merge_conflict: false,
    }
  } else if (emailConflict) {
    return {
      error: 'This email address already belongs to another contact.',
      merge_conflict: false,
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
      first_name: data.first_name,
      last_name: data.last_name,
      phone: data.phone,
      email: data.email,
      company: data.company,
      account_id: data.account_id,
      notes: data.notes,
      tags: tagNames,
      ...(Object.keys(cfPayloadUpdate).length > 0 && { custom_fields: cfPayloadUpdate }),
    })
    .eq('id', id)
  if (error) {
    // 23505: unique constraint violation — surface a clear error instead of crashing.
    if (error.code === '23505') {
      return {
        error: 'This phone or email already belongs to another contact.',
        merge_conflict: false,
      }
    }
    return { error: error.message }
  }

  await setContactTags(id, data.tags)

  // Sync updated fields back to Google Contacts (requires email to locate the record).
  await syncContactUpdateToGoogle(
    {
      name:       data.name,
      first_name: data.first_name,
      last_name:  data.last_name,
      email:      data.email,
      phone:      data.phone,
      company:    data.company,
      notes:      data.notes,
    },
    orgId,
    supabase,
  )

  revalidatePath('/contacts')
  revalidatePath(`/contacts/${id}`)
}

export async function deleteContact(
  id: string,
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const perm = await requirePermission('contacts.manage')
  if (!perm.ok) return { error: perm.error ?? 'Forbidden' }
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
  const perm = await requirePermission('contacts.bulk')
  if (!perm.ok) return { error: perm.error ?? 'Forbidden' }
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
  conflictRows: number         // D-06: rows skipped due to phone/email conflict with existing live contact
  blockedEmailCount: number    // D-04a: rows whose email matched BLOCKED_EMAIL_PATTERNS (still imported via phone if present)
  invalidEmailCount: number    // Email format failed validation — row imported with email=null
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
    fieldToIdx.first_name === undefined &&
    fieldToIdx.last_name === undefined &&
    fieldToIdx.name === undefined &&
    fieldToIdx.phone === undefined &&
    fieldToIdx.email === undefined
  ) {
    return { error: 'Map at least one of first name, last name, full name, phone, or email.' }
  }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No organization found.' }

  // Fetch existing phone_e164/email_normalized in one shot for dedup. For very
  // large imports this scales linearly with org contact count; acceptable for v1.
  //
  // RESEARCH bug fix (D-06): previously we read raw `phone`/`email` columns,
  // then compared them against normalized input — guaranteed false negatives
  // when stored value formatting differed from CSV row formatting. Phase 105
  // generated `phone_e164` and `email_normalized`, so dedup now compares
  // normalized-vs-normalized.
  //
  // `.neq('identity_status', 'archived_duplicate')` mirrors the predicate of
  // the partial UNIQUE index from Phase 107 (1059_contacts_unique_constraints.sql).
  const { data: existing } = await supabase
    .from('contacts')
    .select('phone_e164, email_normalized, identity_status')
    .neq('identity_status', 'archived_duplicate')
  const existingPhones = new Set(
    (existing ?? [])
      .map((r) => r.phone_e164)
      .filter((p): p is string => Boolean(p)),
  )
  const existingEmails = new Set(
    (existing ?? [])
      .map((r) => r.email_normalized)
      .filter((e): e is string => Boolean(e)),
  )

  type InsertRow = Database['public']['Tables']['contacts']['Insert']
  const toInsert: InsertRow[] = []
  const summary: ImportSummary = {
    inserted: 0,
    skipped: 0,
    errors: 0,
    conflictRows: 0,
    blockedEmailCount: 0,
    invalidEmailCount: 0,
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

    const fullName = getField('name')
    const splitName = splitContactName(fullName)
    const firstName = getField('first_name') ?? splitName.firstName
    const lastName = getField('last_name') ?? splitName.lastName
    const name = composeContactName(firstName, lastName) ?? fullName
    const phone = normalisePhone(getField('phone'))
    const rawEmailInput = getField('email')
    const rawEmail = normaliseEmail(rawEmailInput)
    // Track when the user provided something email-shaped but it failed
    // validation (e.g. "skale.clubgmail.com" — missing @). Row still goes
    // through if a valid phone is present.
    if (rawEmailInput && !rawEmail) {
      summary.invalidEmailCount++
    }
    // D-04a: drop blocked/placeholder emails (e.g. noemail@example.com) but
    // still allow the row through if a valid phone is present (phone carries
    // the contact). Counted for the dry-run summary.
    const finalEmail = rawEmail && !isBlockedEmail(rawEmail) ? rawEmail : null
    if (rawEmail && !finalEmail) {
      summary.blockedEmailCount++
    }
    const email = finalEmail
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
      summary.conflictRows++
      continue
    }
    if (
      !phone &&
      email &&
      (existingEmails.has(email) || seenInBatchEmails.has(email))
    ) {
      summary.skipped++
      summary.conflictRows++
      continue
    }

    if (phone) seenInBatchPhones.add(phone)
    if (email) seenInBatchEmails.add(email)

    toInsert.push({
      org_id: orgId,
      first_name: firstName,
      last_name: lastName,
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

const INLINE_BUILTIN_FIELDS = ['first_name', 'last_name', 'name', 'phone', 'email', 'company'] as const
type InlineBuiltinField = (typeof INLINE_BUILTIN_FIELDS)[number]

export interface UpdateContactFieldResult {
  ok: boolean
  error?: string
}

export interface SetContactCompanyResult {
  ok: boolean
  error?: string
  account_id?: string | null
  company?: string | null
  account?: ContactDetail['account']
}

/**
 * Sets or clears the real Company relationship for a contact.
 *
 * `contacts.company` is a legacy fallback string. Keep it synchronized with
 * the linked account name, and clear it when explicitly unlinking so the UI
 * does not keep showing a stale "company" that is not present in Companies.
 */
export async function setContactCompany(
  contactId: string,
  accountId: string | null,
): Promise<SetContactCompanyResult> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }
  if (!contactId) return { ok: false, error: 'Missing contact id' }

  const supabase = await createClient()

  if (!accountId) {
    const { data, error } = await supabase
      .from('contacts')
      .update({ account_id: null, company: null })
      .eq('id', contactId)
      .select('id')
      .maybeSingle()

    if (error) return { ok: false, error: error.message }
    if (!data) return { ok: false, error: 'Contact not found' }

    revalidatePath('/contacts')
    revalidatePath('/companies')
    return { ok: true, account_id: null, company: null, account: null }
  }

  const { data: account, error: accountErr } = await supabase
    .from('accounts')
    .select('id, name, website, address')
    .eq('id', accountId)
    .maybeSingle()

  if (accountErr) return { ok: false, error: accountErr.message }
  if (!account) return { ok: false, error: 'Company not found' }

  const { data, error } = await supabase
    .from('contacts')
    .update({ account_id: account.id, company: account.name })
    .eq('id', contactId)
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: 'Contact not found' }

  revalidatePath('/contacts')
  revalidatePath('/companies')
  revalidatePath(`/companies/${account.id}`)

  return {
    ok: true,
    account_id: account.id,
    company: account.name,
    account: {
      id: account.id,
      name: account.name,
      website: account.website ?? null,
      address: account.address ?? null,
    },
  }
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
    if (f === 'email') {
      // Surface invalid emails as a user-facing error instead of silently
      // saving null — keeps the inline editor open with a toast so the
      // operator can fix the typo (e.g. "skale.clubgmail.com" → "skale@gmail.com").
      const result = normaliseEmailStrict(normalised)
      if (!result.ok) return { ok: false, error: result.error }
      normalised = result.value
    }
    if (!normalised) normalised = null
    const updates: Record<string, string | null> = { [f]: normalised }
    if (f === 'name') {
      const split = splitContactName(normalised)
      updates.first_name = split.firstName
      updates.last_name = split.lastName
    }
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

// ─── Avatar upload (migration 1104) ──────────────────────────────────────────
//
// Uploads a contact's profile photo to the 'avatars' Supabase Storage bucket
// (created in 059_avatars_bucket.sql) and persists the public URL on the
// contacts row. Bucket RLS only allows uploads under `${auth.uid()}/...`, so
// we key paths by the current user; the file's logical owner is still the
// contact via avatar_url. Resizes to 512x512 webp via sharp to keep storage
// usage bounded and bandwidth predictable.

const AVATAR_MAX_BYTES = 8 * 1024 * 1024 // 8MB raw upload limit
const AVATAR_ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
])

export async function uploadContactAvatar(
  contactId: string,
  formData: FormData,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }
  if (!contactId) return { ok: false, error: 'Missing contact id' }

  const file = formData.get('file')
  if (!(file instanceof File)) return { ok: false, error: 'Missing file' }
  if (file.size === 0) return { ok: false, error: 'Empty file' }
  if (file.size > AVATAR_MAX_BYTES) {
    return { ok: false, error: 'File too large (max 8MB)' }
  }
  if (!AVATAR_ALLOWED_MIME.has(file.type)) {
    return { ok: false, error: 'Unsupported image type' }
  }

  // Verify the contact belongs to the active org (RLS covers reads, but we
  // want to fail fast with a clear error before doing any work).
  const supabase = await createClient()
  const { data: contactRow, error: readErr } = await supabase
    .from('contacts')
    .select('id, avatar_url')
    .eq('id', contactId)
    .maybeSingle()
  if (readErr) return { ok: false, error: readErr.message }
  if (!contactRow) return { ok: false, error: 'Contact not found' }

  // Resize + normalise to webp via sharp. Square crop centered.
  const arrayBuffer = await file.arrayBuffer()
  const sharp = (await import('sharp')).default
  let processed: Buffer
  try {
    processed = await sharp(Buffer.from(arrayBuffer))
      .rotate() // honour EXIF orientation
      .resize(512, 512, { fit: 'cover', position: 'attention' })
      .webp({ quality: 82 })
      .toBuffer()
  } catch {
    return { ok: false, error: 'Could not process image' }
  }

  // Path: {auth.uid()}/contacts/{contactId}-{nonce}.webp — satisfies the
  // existing 'avatars_upload_own' RLS policy that requires the first folder
  // to be the uploading user's id.
  const nonce = Math.random().toString(36).slice(2, 10)
  const objectPath = `${user.id}/contacts/${contactId}-${nonce}.webp`

  const { error: uploadErr } = await supabase.storage
    .from('avatars')
    .upload(objectPath, processed, {
      contentType: 'image/webp',
      upsert: false,
      cacheControl: '3600',
    })
  if (uploadErr) return { ok: false, error: uploadErr.message }

  const { data: publicUrlData } = supabase.storage.from('avatars').getPublicUrl(objectPath)
  const publicUrl = publicUrlData.publicUrl
  if (!publicUrl) return { ok: false, error: 'Could not resolve public URL' }

  const { error: updateErr } = await supabase
    .from('contacts')
    .update({ avatar_url: publicUrl })
    .eq('id', contactId)
  if (updateErr) {
    // Best-effort cleanup of the orphaned object — failure here is non-fatal.
    await supabase.storage.from('avatars').remove([objectPath]).catch(() => {})
    return { ok: false, error: updateErr.message }
  }

  revalidatePath('/contacts')
  return { ok: true, url: publicUrl }
}

export async function removeContactAvatar(
  contactId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }
  if (!contactId) return { ok: false, error: 'Missing contact id' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('contacts')
    .update({ avatar_url: null })
    .eq('id', contactId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/contacts')
  return { ok: true }
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
    .select('id, visitor_phone, channel, channel_metadata, org_id')
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
    const liveContactId = await resolveLiveContactId(contactId)
    const { error } = await supabase
      .from('conversations')
      .update({ contact_id: liveContactId })
      .eq('id', conv.id)
    if (!error) {
      linked++
      // Phase 108 D-04: write channel identity on successful link.
      const provider = CHANNEL_TO_PROVIDER[conv.channel]
      let externalId: string | null = null
      if (provider === 'whatsapp' || provider === 'telegram' || provider === 'webchat') {
        externalId = conv.visitor_phone
      } else if (provider === 'instagram' || provider === 'messenger') {
        const meta = conv.channel_metadata as Record<string, unknown> | null
        externalId = typeof meta?.sender_id === 'string' ? meta.sender_id : null
      }
      if (provider && externalId && conv.org_id) {
        await attachChannelIdentity(supabase, conv.org_id, liveContactId, provider, externalId)
      }
    }
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
  const stdHeaders = ['first_name', 'last_name', 'name', 'phone', 'email', 'company', 'notes', 'source', 'created_at']
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
      c.first_name ?? '',
      c.last_name ?? '',
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

// ─── Phase 6: Merge Conflict Detection + Resolution ─────────────────────────

/**
 * Returns the pair of contacts involved in a merge conflict for the given
 * contact. Used by the merge panel banner in the contact detail.
 *
 * A merge conflict arises when `identity_status = 'merge_conflict'`. The
 * conflicting peer is inferred from duplicate lookup by phone or email.
 * Returns null if no conflict is pending.
 */
export interface MergeConflictPair {
  /** The contact flagged with merge_conflict */
  conflict: {
    id: string
    name: string | null
    phone: string | null
    email: string | null
    source: string
    created_at: string
  }
  /** The other contact in the collision (phone or email peer) */
  peer: {
    id: string
    name: string | null
    phone: string | null
    email: string | null
    source: string
    created_at: string
  }
}

export async function getPendingMergeConflict(
  contactId: string,
): Promise<MergeConflictPair | null> {
  const user = await getUser()
  if (!user) return null
  const supabase = await createClient()

  // Only flag contacts that are still in merge_conflict status.
  const { data: subject } = await supabase
    .from('contacts')
    .select('id, name, phone, phone_e164, email, email_normalized, source, created_at, identity_status')
    .eq('id', contactId)
    .maybeSingle()
  if (!subject || subject.identity_status !== 'merge_conflict') return null

  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return null

  type PeerContact = { id: string; name: string | null; phone: string | null; email: string | null; source: string; created_at: string }
  let peer: PeerContact | null = null

  if (subject.phone_e164) {
    const { data: p } = await supabase
      .from('contacts')
      .select('id, name, phone, email, source, created_at')
      .eq('org_id', orgId)
      .eq('phone_e164', subject.phone_e164)
      .neq('id', contactId)
      .neq('identity_status', 'archived_duplicate')
      .maybeSingle()
    if (p) peer = p as PeerContact
  }
  if (!peer && subject.email_normalized) {
    const { data: p } = await supabase
      .from('contacts')
      .select('id, name, phone, email, source, created_at')
      .eq('org_id', orgId)
      .eq('email_normalized', subject.email_normalized)
      .neq('id', contactId)
      .neq('identity_status', 'archived_duplicate')
      .maybeSingle()
    if (p) peer = p as PeerContact
  }

  if (!peer) return null

  return {
    conflict: {
      id: subject.id,
      name: subject.name,
      phone: subject.phone,
      email: subject.email,
      source: subject.source,
      created_at: subject.created_at,
    },
    peer: {
      id: peer.id,
      name: peer.name,
      phone: peer.phone,
      email: peer.email,
      source: peer.source,
      created_at: peer.created_at,
    },
  }
}

/**
 * Performs a contact merge from the contact detail UI (Phase 6).
 *
 * Calls the `merge_contacts` SQL SECURITY DEFINER function through the
 * user-scoped Supabase client so `auth.uid()` resolves inside the function.
 * Clears `identity_status = 'merge_conflict'` on the surviving contact after
 * the merge.
 */
export async function mergeContactAction(
  survivorId: string,
  archivedId: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Not authenticated.' }
  if (!survivorId || !archivedId) return { ok: false, error: 'Both contact IDs are required.' }
  if (survivorId === archivedId) return { ok: false, error: 'Cannot merge a contact with itself.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('merge_contacts', {
    survivor_id: survivorId,
    archived_id: archivedId,
  })
  if (error) return { ok: false, error: `Merge failed: ${error.message}` }

  // Clear merge_conflict status on the survivor after a successful merge.
  await supabase
    .from('contacts')
    .update({ identity_status: 'identified' })
    .eq('id', survivorId)
    .eq('identity_status', 'merge_conflict')

  revalidatePath('/contacts')
  revalidatePath(`/contacts/${survivorId}`)
  revalidatePath(`/contacts/${archivedId}`)
  return { ok: true }
}
