'use server'

/**
 * Server actions for the Accounts (Companies) CRM entity.
 * SEED-016 / v2.4 Phase 65 | addresses ACC-01..03, ACC-16, ACC-17.
 *
 * Patterns mirror src/app/(dashboard)/contacts/actions.ts:
 *   - Cached getUser() + createClient() from @/lib/supabase/server (CLAUDE.md)
 *   - RLS-scoped client | never filter by org_id manually
 *   - get_current_org_id() RPC for the org_id NOT NULL column on insert
 *
 * Action return shape (LOCKED by phase brief §4):
 *   ActionResult<T> = { ok: true; data: T } | { ok: false; error: string; details?: unknown }
 *
 * Delete behavior (LOCKED | ACC-03):
 *   Block delete when the account is referenced by any contact or opportunity.
 *   No soft-delete column. Users must merge or null out FKs first.
 */

import { revalidatePath } from 'next/cache'
import { createClient, getUser } from '@/lib/supabase/server'
import { getDefinitions } from '@/app/(dashboard)/settings/custom-fields/actions'
import { FIELD_RENDER_CONFIG } from '@/lib/custom-fields/render-config'
import type { CustomFieldType } from '@/types/database'
import {
  accountSchema,
  accountListFiltersSchema,
  mergeAccountsSchema,
  linkContactToAccountSchema,
  createAccountFromContactSchema,
  normaliseAccountInput,
  normaliseDomain,
  okResult,
  errResult,
  type ActionResult,
  type AccountInput,
  type AccountInsert,
  type AccountListFilters,
  type AccountRow,
  type AccountListResult,
  type AccountWithCounts,
  type AccountReferenceCounts,
  type AccountImportSummary,
  type AccountCsvPreview,
  type MergeAccountsInput,
  type LinkContactToAccountInput,
  type CreateAccountFromContactInput,
  type MergeAccountsResult,
} from '@/lib/accounts'
import {
  parseCsv,
  suggestAccountColumnMapping,
  ACCOUNT_CSV_FIELDS,
  type AccountCsvField,
} from '@/lib/accounts/csv'
import { validateCustomFields } from '@/lib/custom-fields'

// ─── List ────────────────────────────────────────────────────────────────────

export async function getAccounts(
  filters: Partial<AccountListFilters> = {},
  cfFilters: Record<string, string> = {},
): Promise<ActionResult<AccountListResult>> {
  const user = await getUser()
  if (!user) return errResult('not_authenticated')

  const parsed = accountListFiltersSchema.safeParse({
    page: 1,
    pageSize: 25,
    sort: 'name',
    ...filters,
  })
  if (!parsed.success) {
    return errResult('invalid_filters', parsed.error.issues)
  }
  const f = parsed.data

  const supabase = await createClient()
  let query = supabase.from('accounts').select('*', { count: 'exact' })

  if (f.q) {
    const escaped = f.q.replace(/[%_]/g, (m) => `\\${m}`)
    query = query.or(
      [`name.ilike.%${escaped}%`, `domain.ilike.%${escaped}%`].join(','),
    )
  }
  if (f.industry) query = query.eq('industry', f.industry)
  if (f.size) query = query.eq('size', f.size)
  if (f.tag) query = query.contains('tags', [f.tag])
  if (f.assignedTo) query = query.eq('assigned_to', f.assignedTo)
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

  if (f.sort === 'recent') {
    query = query.order('created_at', { ascending: false })
  } else {
    query = query.order('name', { ascending: true, nullsFirst: false })
  }

  const from = (f.page - 1) * f.pageSize
  const to = from + f.pageSize - 1
  query = query.range(from, to)

  const { data, count, error } = await query
  if (error) return errResult(error.message, error)

  const rows = (data ?? []) as AccountRow[]

  // Compute per-account counts in two batch queries (contact_count, open_opportunity_count, pipeline_value)
  let rowsWithCounts: AccountWithCounts[]
  if (rows.length === 0) {
    rowsWithCounts = []
  } else {
    const ids = rows.map((r) => r.id)

    const [
      { data: contactCounts },
      { data: oppData },
    ] = await Promise.all([
      supabase
        .from('contacts')
        .select('account_id')
        .in('account_id', ids),
      supabase
        .from('opportunities')
        .select('account_id, value, status')
        .in('account_id', ids),
    ])

    const contactCountMap = new Map<string, number>()
    for (const c of contactCounts ?? []) {
      if (c.account_id) {
        contactCountMap.set(c.account_id, (contactCountMap.get(c.account_id) ?? 0) + 1)
      }
    }

    const oppCountMap = new Map<string, number>()
    const pipelineValueMap = new Map<string, number>()
    for (const o of oppData ?? []) {
      if (o.account_id && o.status === 'open') {
        oppCountMap.set(o.account_id, (oppCountMap.get(o.account_id) ?? 0) + 1)
        pipelineValueMap.set(o.account_id, (pipelineValueMap.get(o.account_id) ?? 0) + (Number(o.value) || 0))
      }
    }

    rowsWithCounts = rows.map((r) => ({
      ...r,
      contact_count: contactCountMap.get(r.id) ?? 0,
      open_opportunity_count: oppCountMap.get(r.id) ?? 0,
      pipeline_value: pipelineValueMap.get(r.id) ?? 0,
    }))
  }

  return okResult<AccountListResult>({
    rows: rowsWithCounts,
    total: count ?? 0,
    page: f.page,
    pageSize: f.pageSize,
  })
}

// ─── Detail ──────────────────────────────────────────────────────────────────

export async function getAccount(
  id: string,
): Promise<ActionResult<AccountWithCounts>> {
  const user = await getUser()
  if (!user) return errResult('not_authenticated')

  const supabase = await createClient()
  const [
    { data: account, error: accErr },
    { count: contactCount, error: cErr },
    { data: oppData, error: oErr },
  ] = await Promise.all([
    supabase.from('accounts').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', id),
    supabase
      .from('opportunities')
      .select('value, status')
      .eq('account_id', id)
      .eq('status', 'open'),
  ])

  if (accErr) return errResult(accErr.message, accErr)
  if (!account) return errResult('not_found')
  if (cErr) return errResult(cErr.message, cErr)
  if (oErr) return errResult(oErr.message, oErr)

  const openOpps = oppData ?? []
  const pipelineValue = openOpps.reduce((sum, o) => sum + (Number(o.value) || 0), 0)

  return okResult<AccountWithCounts>({
    ...(account as AccountRow),
    contact_count: contactCount ?? 0,
    open_opportunity_count: openOpps.length,
    pipeline_value: pipelineValue,
  })
}

// ─── Create ──────────────────────────────────────────────────────────────────

export async function createAccount(
  input: AccountInput,
): Promise<ActionResult<AccountRow>> {
  const user = await getUser()
  if (!user) return errResult('not_authenticated')

  const parsed = accountSchema.safeParse(input)
  if (!parsed.success) {
    return errResult('invalid_input', parsed.error.issues)
  }
  const normalised = normaliseAccountInput(parsed.data)

  const supabase = await createClient()
  const { data: orgIdData } = await supabase.rpc('get_current_org_id')
  if (!orgIdData) return errResult('no_organization')

  // Validate custom fields (per CF-07)
  const cfPayload = (input as { custom_fields?: Record<string, unknown> }).custom_fields
  if (cfPayload && typeof cfPayload === 'object') {
    const cfResult = await validateCustomFields(orgIdData, 'account', cfPayload)
    if (!cfResult.ok) return errResult('custom_fields_invalid', cfResult.errors)
  }

  const { data, error } = await supabase
    .from('accounts')
    .insert({
      org_id: orgIdData,
      name: normalised.name,
      domain: normalised.domain,
      website: normalised.website,
      industry: normalised.industry,
      size: normalised.size,
      phone: normalised.phone,
      address: normalised.address,
      notes: normalised.notes,
      tags: normalised.tags,
      custom_fields: normalised.custom_fields,
      external_id: normalised.external_id,
      source: normalised.source,
      assigned_to: normalised.assigned_to,
      created_by: user.id,
    })
    .select('*')
    .single()

  if (error) return errResult(error.message, error)
  if (!data) return errResult('insert_returned_no_row')

  revalidatePath('/companies')
  return okResult<AccountRow>(data as AccountRow)
}

// ─── Update ──────────────────────────────────────────────────────────────────

export async function updateAccount(
  id: string,
  input: AccountInput,
): Promise<ActionResult<AccountRow>> {
  const user = await getUser()
  if (!user) return errResult('not_authenticated')

  const parsed = accountSchema.safeParse(input)
  if (!parsed.success) {
    return errResult('invalid_input', parsed.error.issues)
  }
  const normalised = normaliseAccountInput(parsed.data)

  const supabase = await createClient()

  // Validate custom fields (per CF-07)
  const cfPayloadUpdate = (input as { custom_fields?: Record<string, unknown> }).custom_fields
  if (cfPayloadUpdate && typeof cfPayloadUpdate === 'object') {
    const { data: orgIdForCf } = await supabase.rpc('get_current_org_id')
    if (orgIdForCf) {
      const cfResult = await validateCustomFields(orgIdForCf, 'account', cfPayloadUpdate)
      if (!cfResult.ok) return errResult('custom_fields_invalid', cfResult.errors)
    }
  }

  // RLS scopes the UPDATE to the active org. No manual org_id filter needed.
  // We do NOT change org_id, created_by, or source (those stay as on the row).
  const { data, error } = await supabase
    .from('accounts')
    .update({
      name: normalised.name,
      domain: normalised.domain,
      website: normalised.website,
      industry: normalised.industry,
      size: normalised.size,
      phone: normalised.phone,
      address: normalised.address,
      notes: normalised.notes,
      tags: normalised.tags,
      custom_fields: normalised.custom_fields,
      external_id: normalised.external_id,
      assigned_to: normalised.assigned_to,
    })
    .eq('id', id)
    .select('*')
    .single()

  if (error) return errResult(error.message, error)
  if (!data) return errResult('not_found')

  revalidatePath('/companies')
  revalidatePath(`/accounts/${id}`)
  return okResult<AccountRow>(data as AccountRow)
}

// ─── Delete (reference-blocking | ACC-03 LOCKED behavior) ────────────────────

export async function deleteAccount(
  id: string,
): Promise<ActionResult<{ deleted: string }>> {
  const user = await getUser()
  if (!user) return errResult('not_authenticated')

  const supabase = await createClient()

  // Reference check: how many contacts and opportunities point at this account?
  // RLS already restricts both queries to the active org.
  const [
    { count: contactCount, error: cErr },
    { count: oppCount, error: oErr },
  ] = await Promise.all([
    supabase
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', id),
    supabase
      .from('opportunities')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', id),
  ])

  if (cErr) return errResult(cErr.message, cErr)
  if (oErr) return errResult(oErr.message, oErr)

  const refs: AccountReferenceCounts = {
    contacts: contactCount ?? 0,
    opportunities: oppCount ?? 0,
  }

  if (refs.contacts > 0 || refs.opportunities > 0) {
    return errResult('account_has_references', refs)
  }

  const { error: delErr } = await supabase
    .from('accounts')
    .delete()
    .eq('id', id)

  if (delErr) return errResult(delErr.message, delErr)

  revalidatePath('/companies')
  return okResult({ deleted: id })
}

// ─── Merge (ACC-16) ──────────────────────────────────────────────────────────
//
// LOCKED design (phase brief §13): three sequential Supabase calls.
//   1. UPDATE contacts SET account_id = primaryId WHERE account_id IN (secondaryIds)
//   2. UPDATE opportunities SET account_id = primaryId WHERE account_id IN (secondaryIds)
//   3. DELETE FROM accounts WHERE id IN (secondaryIds)
//
// NON-ATOMIC: if a network blip occurs between calls, the DB can land in a
// partial state. The brief accepts this trade-off for v1 ("if sequential,
// document the non-atomic risk"). Recovery is manual: re-run mergeAccounts
// with the same arguments | every step is idempotent, so a partial state
// converges to a clean merge on retry. A future Postgres RPC can wrap these
// three statements in BEGIN/COMMIT post-v2.4.
//
// Why this works against the CHECK constraint opp_has_contact_or_account:
// Step 2 rewrites account_id from secondary→primary (never nulls it), so the
// CHECK is never violated. Step 3's ON DELETE SET NULL is a no-op because
// step 1 and step 2 already moved every referencing row.

export async function mergeAccounts(
  input: MergeAccountsInput,
): Promise<ActionResult<MergeAccountsResult>> {
  const user = await getUser()
  if (!user) return errResult('not_authenticated')

  const parsed = mergeAccountsSchema.safeParse(input)
  if (!parsed.success) {
    return errResult('invalid_input', parsed.error.issues)
  }
  const { primaryId, secondaryIds } = parsed.data

  const supabase = await createClient()

  // Sanity: confirm primary exists and is visible under RLS. If it's not,
  // every downstream UPDATE/DELETE silently no-ops because RLS filters them out.
  const { data: primary, error: pErr } = await supabase
    .from('accounts')
    .select('id')
    .eq('id', primaryId)
    .maybeSingle()
  if (pErr) return errResult(pErr.message, pErr)
  if (!primary) return errResult('primary_not_found')

  // Step 1 | move contacts.
  const { count: movedContacts, error: c1 } = await supabase
    .from('contacts')
    .update({ account_id: primaryId }, { count: 'exact' })
    .in('account_id', secondaryIds)
  if (c1) return errResult(c1.message, c1)

  // Step 2 | move opportunities.
  const { count: movedOpps, error: c2 } = await supabase
    .from('opportunities')
    .update({ account_id: primaryId }, { count: 'exact' })
    .in('account_id', secondaryIds)
  if (c2) {
    // Partial-state warning: contacts moved, opportunities did NOT.
    // Caller can retry mergeAccounts with the same input | step 1 is
    // idempotent (those contacts are already on primaryId).
    return errResult(c2.message, {
      ...c2,
      partial_state: { moved_contacts: movedContacts ?? 0 },
    })
  }

  // Step 3 | delete secondaries.
  const { count: deletedAccts, error: c3 } = await supabase
    .from('accounts')
    .delete({ count: 'exact' })
    .in('id', secondaryIds)
  if (c3) {
    // Partial-state warning: both FK updates committed, delete failed.
    return errResult(c3.message, {
      ...c3,
      partial_state: {
        moved_contacts: movedContacts ?? 0,
        moved_opportunities: movedOpps ?? 0,
      },
    })
  }

  revalidatePath('/companies')
  revalidatePath(`/accounts/${primaryId}`)
  for (const sid of secondaryIds) revalidatePath(`/accounts/${sid}`)

  return okResult<MergeAccountsResult>({
    moved_contacts: movedContacts ?? 0,
    moved_opportunities: movedOpps ?? 0,
    deleted_accounts: deletedAccts ?? 0,
  })
}

// ─── Contact ↔ Account linking helpers (scaffolding for Phases 66/67) ────────

export async function linkContactToAccount(
  input: LinkContactToAccountInput,
): Promise<ActionResult<{ contact_id: string; account_id: string }>> {
  const user = await getUser()
  if (!user) return errResult('not_authenticated')

  const parsed = linkContactToAccountSchema.safeParse(input)
  if (!parsed.success) {
    return errResult('invalid_input', parsed.error.issues)
  }
  const { contactId, accountId } = parsed.data

  const supabase = await createClient()

  // RLS scopes the UPDATE; cross-org link attempts no-op silently.
  const { data, error } = await supabase
    .from('contacts')
    .update({ account_id: accountId })
    .eq('id', contactId)
    .select('id, account_id')
    .single()

  if (error) return errResult(error.message, error)
  if (!data) return errResult('contact_not_found')

  revalidatePath('/contacts')
  revalidatePath(`/contacts/${contactId}`)
  revalidatePath(`/accounts/${accountId}`)

  return okResult({ contact_id: data.id, account_id: accountId })
}

/**
 * Promotes a contact's legacy `company` free-text into a real account, links
 * the contact, and returns the account row. Idempotent: if an account whose
 * `lower(name) = lower(trim(company))` already exists for this org, link to
 * that one instead of creating a duplicate.
 *
 * ILIKE escape: company names may contain `%` or `_`, both of which are
 * wildcards in Postgres ILIKE. We escape them with `\\` before the lookup so
 * a name like `50% Off Holdings` or `Acme_Co` matches exactly instead of
 * over-matching. This mirrors the canonical escape pattern in `getAccounts`
 * (Plan 65-02): `trimmedName.replace(/[%_]/g, '\\$&')`.
 *
 * Index usage: we filter `org_id` explicitly so the
 * idx_accounts_org_name (org_id, lower(name)) composite index is used by the
 * planner (RLS-only scoping forces a Seq Scan + filter on small orgs but
 * tanks on large ones | the explicit eq keeps both planners happy).
 *
 * Does NOT clear `contacts.company` | phase brief §17 leaves cleanup of the
 * legacy column to a future milestone (one-milestone revertibility window
 * per ACC-14).
 */
export async function createAccountFromContact(
  input: CreateAccountFromContactInput,
): Promise<ActionResult<AccountRow>> {
  const user = await getUser()
  if (!user) return errResult('not_authenticated')

  const parsed = createAccountFromContactSchema.safeParse(input)
  if (!parsed.success) {
    return errResult('invalid_input', parsed.error.issues)
  }
  const { contactId } = parsed.data

  const supabase = await createClient()

  // 1. Read the contact and its legacy company string.
  const { data: contact, error: cErr } = await supabase
    .from('contacts')
    .select('id, company, account_id')
    .eq('id', contactId)
    .maybeSingle()
  if (cErr) return errResult(cErr.message, cErr)
  if (!contact) return errResult('contact_not_found')

  const trimmedName = (contact.company ?? '').trim()
  if (!trimmedName) return errResult('contact_has_no_company')

  // 2. Resolve org_id explicitly for the INSERT (NOT NULL column) AND for the
  //    indexed lookup below.
  const { data: orgIdData } = await supabase.rpc('get_current_org_id')
  if (!orgIdData) return errResult('no_organization')

  // 3. Idempotent lookup: does an account with this name already exist?
  //    Escape %/_ to prevent ilike wildcard over-match (canonical pattern,
  //    same as getAccounts in Plan 65-02). The idx_accounts_org_name
  //    (org_id, lower(name)) index covers (org_id eq + lower(name) ilike).
  const escapedName = trimmedName.replace(/[%_]/g, '\\$&')
  const { data: existingMatches, error: lookupErr } = await supabase
    .from('accounts')
    .select('*')
    .eq('org_id', orgIdData)
    .ilike('name', escapedName)
  if (lookupErr) return errResult(lookupErr.message, lookupErr)

  // ilike with escaped %/_ now matches the WHOLE string case-insensitively
  // (no wildcards left after escaping). Multiple results would be a data
  // anomaly (the data-migration block in 064_accounts.sql dedups by lower(name));
  // take the first deterministically by id as a defensive tiebreaker.
  let account: AccountRow | null = null
  if (existingMatches && existingMatches.length > 0) {
    // Defensive in-JS exact equality check | belt-and-suspenders against
    // collation surprises in Postgres ilike for unusual unicode (the index
    // is on lower(name) with default collation; JS toLowerCase is locale-
    // insensitive). If any candidate matches case-insensitively in JS, pick
    // the lexicographically smallest id for determinism.
    const exact = existingMatches.filter(
      (a) => (a.name ?? '').trim().toLowerCase() === trimmedName.toLowerCase(),
    )
    if (exact.length > 0) {
      account = exact.sort((a, b) => (a.id < b.id ? -1 : 1))[0] as AccountRow
    }
  }

  // 4. Create new account if no match.
  if (!account) {
    const insertPayload: AccountInsert = {
      org_id: orgIdData,
      name: trimmedName,
      source: 'auto_from_contact_company',
      created_by: user.id,
    }
    const { data: created, error: insErr } = await supabase
      .from('accounts')
      .insert(insertPayload)
      .select('*')
      .single()
    if (insErr) return errResult(insErr.message, insErr)
    if (!created) return errResult('insert_returned_no_row')
    account = created as AccountRow
  }

  // 5. Link the contact to the account.
  const { error: linkErr } = await supabase
    .from('contacts')
    .update({ account_id: account.id })
    .eq('id', contactId)
  if (linkErr) return errResult(linkErr.message, linkErr)

  revalidatePath('/contacts')
  revalidatePath(`/contacts/${contactId}`)
  revalidatePath('/companies')
  revalidatePath(`/accounts/${account.id}`)

  return okResult<AccountRow>(account)
}

// ─── Bulk actions (ACC-07) ───────────────────────────────────────────────────

export async function bulkAssignOwner(
  ids: string[],
  assignedTo: string,
): Promise<ActionResult<{ updated: number; errors: number }>> {
  if (ids.length === 0) return okResult({ updated: 0, errors: 0 })
  const user = await getUser()
  if (!user) return errResult('Not authenticated')
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('accounts')
    .update({ assigned_to: assignedTo || null, updated_at: new Date().toISOString() })
    .in('id', ids)
    .select('id')
  if (error) return errResult(error.message)
  revalidatePath('/companies')
  return okResult({ updated: data?.length ?? 0, errors: 0 })
}

export async function bulkAddTag(
  ids: string[],
  tag: string,
): Promise<ActionResult<{ updated: number }>> {
  if (ids.length === 0 || !tag.trim()) return okResult({ updated: 0 })
  const user = await getUser()
  if (!user) return errResult('Not authenticated')
  const trimmed = tag.trim()
  const supabase = await createClient()
  // Fetch current tags for each selected account, append if missing, bulk update
  const { data: rows, error: fetchErr } = await supabase
    .from('accounts')
    .select('id, tags')
    .in('id', ids)
  if (fetchErr || !rows) return errResult(fetchErr?.message ?? 'Fetch failed')
  let updated = 0
  for (const row of rows) {
    const newTags = row.tags.includes(trimmed) ? row.tags : [...row.tags, trimmed]
    if (newTags.length === row.tags.length) { updated++; continue } // already has tag
    const { error } = await supabase
      .from('accounts')
      .update({ tags: newTags, updated_at: new Date().toISOString() })
      .eq('id', row.id)
    if (!error) updated++
  }
  revalidatePath('/companies')
  return okResult({ updated })
}

// ─── CSV import (ACC-17) ─────────────────────────────────────────────────────
//
// AccountCsvPreview is imported from @/lib/accounts (declared in
// src/lib/accounts/types.ts). 'use server' files should only export async
// functions; non-async exports (interfaces, helpers) live in pure-types
// modules to keep the server-action boundary clean.

const MAX_CSV_BYTES = 5 * 1024 * 1024 // 5MB | keeps the v1 action body small; the
// production import pipeline (Phase 75) handles up to 50MB via direct-to-Storage.

export async function previewAccountsCsv(
  csvText: string,
): Promise<ActionResult<AccountCsvPreview>> {
  const user = await getUser()
  if (!user) return errResult('not_authenticated')
  if (!csvText || csvText.length > MAX_CSV_BYTES) {
    return errResult('csv_too_large_or_empty', { maxBytes: MAX_CSV_BYTES })
  }
  const parsed = parseCsv(csvText)
  if (!parsed.headers.length) {
    return errResult('no_columns_detected')
  }
  return okResult<AccountCsvPreview>({
    headers: parsed.headers,
    rows: parsed.rows.slice(0, 5),
    suggestedMapping: suggestAccountColumnMapping(parsed.headers),
    totalRows: parsed.rows.length,
  })
}

/**
 * Bulk-imports accounts from a CSV string. LOCKED v1 dedup (brief §14):
 *   For each parsed row, if (org_id, lower(name)) OR (org_id, normalised
 *   domain) matches an existing account, SKIP. Do NOT update | that's
 *   Phase 75's `update_existing` strategy.
 *
 * App-layer dedup (NOT ON CONFLICT) because migration 064 created only
 * non-unique indexes on (org_id, lower(name)) and (org_id, domain), not
 * unique constraints. We SELECT existing rows once, build Sets, and skip
 * matches inline.
 *
 * Returns inserted/skipped counts plus per-row errors (max 50 reported).
 */
export async function importAccountsCsv(
  csvText: string,
  mapping: Record<string, AccountCsvField | null>,
): Promise<ActionResult<AccountImportSummary>> {
  const user = await getUser()
  if (!user) return errResult('not_authenticated')
  if (!csvText) return errResult('csv_empty')
  if (csvText.length > MAX_CSV_BYTES) {
    return errResult('csv_too_large', { maxBytes: MAX_CSV_BYTES })
  }

  const parsed = parseCsv(csvText)
  if (!parsed.headers.length) return errResult('no_columns_detected')

  // Build field → column index lookup.
  const fieldToIdx: Partial<Record<AccountCsvField, number>> = {}
  for (const [header, field] of Object.entries(mapping)) {
    if (!field || !ACCOUNT_CSV_FIELDS.includes(field)) continue
    const idx = parsed.headers.indexOf(header)
    if (idx >= 0) fieldToIdx[field] = idx
  }

  if (fieldToIdx.name === undefined) {
    return errResult('name_column_required')
  }

  const supabase = await createClient()
  const { data: orgIdData } = await supabase.rpc('get_current_org_id')
  if (!orgIdData) return errResult('no_organization')

  // Fetch existing accounts for dedup | single round-trip. Scales linearly
  // with org account count; acceptable for v1 (the brief explicitly accepts
  // this scaling profile; Phase 75 introduces the streaming pipeline).
  const { data: existing, error: exErr } = await supabase
    .from('accounts')
    .select('id, name, domain')
  if (exErr) return errResult(exErr.message, exErr)

  const existingNameKeys = new Set(
    (existing ?? [])
      .map((r) => (r.name ?? '').trim().toLowerCase())
      .filter((s) => s.length > 0),
  )
  const existingDomainKeys = new Set(
    (existing ?? [])
      .map((r) => normaliseDomain(r.domain))
      .filter((d): d is string => Boolean(d)),
  )

  const summary: AccountImportSummary = {
    inserted: 0,
    skipped: 0,
    errors: [],
  }

  const seenInBatchNames = new Set<string>()
  const seenInBatchDomains = new Set<string>()
  const toInsert: AccountInsert[] = []

  const get = (row: string[], field: AccountCsvField): string | null => {
    const idx = fieldToIdx[field]
    if (idx === undefined) return null
    const v = (row[idx] ?? '').trim()
    return v || null
  }

  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i]
    const name = get(row, 'name')
    if (!name) {
      summary.skipped++
      summary.errors.push({
        row: i + 2, // +1 for header, +1 for human 1-indexed
        field: 'name',
        message: 'name is required',
      })
      continue
    }

    const nameKey = name.toLowerCase()
    const domain = normaliseDomain(get(row, 'domain'))
    const tagsRaw = get(row, 'tags')
    const tags = tagsRaw
      ? tagsRaw
          .split(/[;,|]/)
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 50)
      : []

    // Dedup check: existing in DB, or already accepted in this batch.
    if (existingNameKeys.has(nameKey) || seenInBatchNames.has(nameKey)) {
      summary.skipped++
      continue
    }
    if (domain && (existingDomainKeys.has(domain) || seenInBatchDomains.has(domain))) {
      summary.skipped++
      continue
    }

    seenInBatchNames.add(nameKey)
    if (domain) seenInBatchDomains.add(domain)

    toInsert.push({
      org_id: orgIdData,
      name,
      domain,
      website: get(row, 'website'),
      industry: get(row, 'industry'),
      size: get(row, 'size'),
      phone: get(row, 'phone'),
      address: get(row, 'address'),
      notes: get(row, 'notes'),
      tags,
      // custom_fields stays default '{}' | CSV import never writes structured CFs in v1
      source: 'csv_import',
      created_by: user.id,
    })
  }

  // Bulk insert in chunks of 500 to keep request bodies reasonable.
  const CHUNK = 500
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const chunk = toInsert.slice(i, i + CHUNK)
    const { data, error } = await supabase
      .from('accounts')
      .insert(chunk)
      .select('id')
    if (error) {
      // Chunk-level failure: report once, count every row in the chunk as error.
      summary.errors.push({
        row: -1,
        message: `chunk insert failed: ${error.message}`,
      })
      // Don't bail | try the remaining chunks; partial imports are accepted.
      continue
    }
    summary.inserted += data?.length ?? 0
  }

  // Cap reported errors at 50 to keep response payload small.
  if (summary.errors.length > 50) {
    summary.errors = summary.errors.slice(0, 50)
  }

  revalidatePath('/companies')
  return okResult<AccountImportSummary>(summary)
}

// ─── Export (CF-13) ──────────────────────────────────────────────────────────

function csvEscape(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`
  }
  return val
}

export async function exportAccountsCsv(): Promise<{ error?: string; csv?: string }> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()

  const [{ data: accounts }, defsResult] = await Promise.all([
    supabase.from('accounts').select('*').order('name', { ascending: true }).limit(5000),
    getDefinitions({ entity: 'account', includeArchived: false }),
  ])
  if (!accounts) return { error: 'Failed to fetch accounts.' }
  const defs = defsResult.ok ? defsResult.data : []

  const stdHeaders = ['name', 'domain', 'website', 'industry', 'size', 'phone', 'notes', 'source', 'created_at']
  const cfHeaders: string[] = []
  for (const def of defs) {
    if (def.type === 'currency') {
      cfHeaders.push(`${def.key}_amount`, `${def.key}_currency`)
    } else {
      cfHeaders.push(def.label)
    }
  }

  const lines: string[] = [[...stdHeaders, ...cfHeaders].map(csvEscape).join(',')]

  for (const a of accounts) {
    const cf = (a.custom_fields ?? {}) as Record<string, unknown>
    const row: string[] = [
      a.name ?? '',
      a.domain ?? '',
      a.website ?? '',
      a.industry ?? '',
      a.size ?? '',
      a.phone ?? '',
      a.notes ?? '',
      a.source ?? '',
      a.created_at ?? '',
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
