'use server'

/**
 * Server actions for the Accounts (Companies) CRM entity.
 * SEED-016 / v2.4 Phase 65 — addresses ACC-01..03, ACC-16, ACC-17.
 *
 * Patterns mirror src/app/(dashboard)/contacts/actions.ts:
 *   - Cached getUser() + createClient() from @/lib/supabase/server (CLAUDE.md)
 *   - RLS-scoped client — never filter by org_id manually
 *   - get_current_org_id() RPC for the org_id NOT NULL column on insert
 *
 * Action return shape (LOCKED by phase brief §4):
 *   ActionResult<T> = { ok: true; data: T } | { ok: false; error: string; details?: unknown }
 *
 * Delete behavior (LOCKED — ACC-03):
 *   Block delete when the account is referenced by any contact or opportunity.
 *   No soft-delete column. Users must merge or null out FKs first.
 */

import { revalidatePath } from 'next/cache'
import { createClient, getUser } from '@/lib/supabase/server'
import {
  accountSchema,
  accountListFiltersSchema,
  normaliseAccountInput,
  okResult,
  errResult,
  type ActionResult,
  type AccountInput,
  type AccountListFilters,
  type AccountRow,
  type AccountListResult,
  type AccountWithCounts,
  type AccountReferenceCounts,
} from '@/lib/accounts'

// ─── List ────────────────────────────────────────────────────────────────────

export async function getAccounts(
  filters: Partial<AccountListFilters> = {},
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

  return okResult<AccountListResult>({
    rows: (data ?? []) as AccountRow[],
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
    { count: oppCount, error: oErr },
  ] = await Promise.all([
    supabase.from('accounts').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', id),
    supabase
      .from('opportunities')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', id)
      .eq('status', 'open'),
  ])

  if (accErr) return errResult(accErr.message, accErr)
  if (!account) return errResult('not_found')
  if (cErr) return errResult(cErr.message, cErr)
  if (oErr) return errResult(oErr.message, oErr)

  return okResult<AccountWithCounts>({
    ...(account as AccountRow),
    contact_count: contactCount ?? 0,
    open_opportunity_count: oppCount ?? 0,
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

  revalidatePath('/accounts')
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

  revalidatePath('/accounts')
  revalidatePath(`/accounts/${id}`)
  return okResult<AccountRow>(data as AccountRow)
}

// ─── Delete (reference-blocking — ACC-03 LOCKED behavior) ────────────────────

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

  revalidatePath('/accounts')
  return okResult({ deleted: id })
}
