// src/lib/import/import-batch.ts
// Batched database helpers for the contact import (process-import.ts).
//
// The app server is in Europe and the database in us-west-2, so every awaited
// query costs ~200ms. The import used to spend several awaits per CSV row; these
// helpers spend a handful per chunk. Wherever one statement fails (a unique
// violation on one row, say) the caller falls back to row-by-row for that
// chunk so a single bad row cannot fail the others.

import type { SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = SupabaseClient<any, any, any>

/** Rows processed per progress update and per batch of writes. */
export const IMPORT_CHUNK_SIZE = 500
/** Values per `.in(...)` / `.or(...)` filter, to stay under URL length limits. */
export const FILTER_VALUES_PER_QUERY = 100
/** Parallel single-row updates (update_existing, whose patches differ per row). */
export const UPDATE_CONCURRENCY = 10

export function sliceInto<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** Runs `fn` over `items` with at most `limit` in flight. Results keep input order. */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return results
}

// ── Existing-contact lookup ───────────────────────────────────────────────────

/** value -> contact id for the given column, one query per FILTER_VALUES_PER_QUERY values. */
export async function lookupExisting(
  db: Db,
  orgId: string,
  column: 'phone' | 'email',
  values: string[],
): Promise<Map<string, string>> {
  const found = new Map<string, string>()
  const unique = [...new Set(values)]
  const pages = await Promise.all(
    sliceInto(unique, FILTER_VALUES_PER_QUERY).map((part) =>
      db.from('contacts').select(`id, ${column}`).eq('org_id', orgId).in(column, part),
    ),
  )
  for (const { data } of pages) {
    for (const c of (data ?? []) as Array<Record<string, string | null>>) {
      const key = c[column]
      if (key) found.set(key, c.id as string)
    }
  }
  return found
}

// ── Contact insert ────────────────────────────────────────────────────────────

export interface ContactFields {
  name: string | null
  firstName: string | null
  lastName: string | null
  phone: string | null
  email: string | null
  notes: string | null
  company: string | null
  allTags: string[]
  defaultSource: string | null
  defaultAssignedTo: string | null
  cfPatch: Record<string, unknown>
}

export function buildContactRow(orgId: string, fields: ContactFields): Record<string, unknown> {
  const { name, phone, email, notes, company, allTags, defaultSource, defaultAssignedTo, cfPatch } = fields
  const row: Record<string, unknown> = {
    org_id: orgId,
    first_name: fields.firstName || null,
    last_name: fields.lastName || null,
    name: name || null,
    phone: phone || null,
    email: email || null,
    notes: notes || null,
    company: company || null,
    source: defaultSource || 'csv_import',
    assigned_to: defaultAssignedTo || null,
    tags: allTags,
  }
  if (Object.keys(cfPatch).length > 0) row.custom_fields = cfPatch
  return row
}

export interface InsertOutcome {
  ok: boolean
  /** Null when the insert succeeded but the id could not be matched back (should not happen). */
  id: string | null
}

async function insertOne(db: Db, orgId: string, fields: ContactFields): Promise<InsertOutcome> {
  const { data, error } = await db.from('contacts').insert(buildContactRow(orgId, fields)).select('id').single()
  if (error || !data?.id) return { ok: false, id: null }
  return { ok: true, id: data.id }
}

/**
 * Inserts all contacts with one statement. A single statement is atomic, so when
 * it errors nothing was written and each contact is retried on its own: the bad
 * rows fail, the others land. Outcomes keep the input order.
 */
export async function insertContacts(db: Db, orgId: string, items: ContactFields[]): Promise<InsertOutcome[]> {
  if (items.length === 0) return []
  if (items.length > 1) {
    const { data, error } = await db
      .from('contacts')
      .insert(items.map((f) => buildContactRow(orgId, f)))
      .select('id')
    if (!error) {
      const ids = Array.isArray(data) ? (data as Array<{ id: string }>) : []
      return items.map((_, i) => ({ ok: true, id: ids.length === items.length ? (ids[i]?.id ?? null) : null }))
    }
  }
  const out: InsertOutcome[] = []
  for (const f of items) out.push(await insertOne(db, orgId, f))
  return out
}

// ── Updates (update_existing) ─────────────────────────────────────────────────

export interface UpdateJob {
  id: string
  patch: Record<string, unknown>
}

/**
 * Applies the patches. Jobs with an identical patch share one `.in('id', …)`
 * statement; a failed shared statement is retried one id at a time. Everything
 * else is one statement per job, a few in flight at once. Returns an error
 * message (or null) per job, in input order. Jobs must target distinct ids.
 */
export async function applyUpdates(db: Db, jobs: UpdateJob[]): Promise<Array<string | null>> {
  const results: Array<string | null> = new Array(jobs.length).fill(null)

  const groups = new Map<string, number[]>()
  jobs.forEach((j, idx) => {
    const key = JSON.stringify(j.patch)
    const g = groups.get(key)
    if (g) g.push(idx)
    else groups.set(key, [idx])
  })

  const units: Array<{ idxs: number[] }> = []
  for (const idxs of groups.values()) {
    for (const part of sliceInto(idxs, FILTER_VALUES_PER_QUERY)) units.push({ idxs: part })
  }

  const one = async (idx: number) => {
    const { error } = await db.from('contacts').update(jobs[idx].patch).eq('id', jobs[idx].id)
    results[idx] = error ? error.message : null
  }

  await mapWithConcurrency(units, UPDATE_CONCURRENCY, async ({ idxs }) => {
    if (idxs.length === 1) return one(idxs[0])
    const { error } = await db
      .from('contacts')
      .update(jobs[idxs[0]].patch)
      .in('id', idxs.map((i) => jobs[i].id))
    if (!error) return
    for (const idx of idxs) await one(idx)
  })
  return results
}

// ── Accounts auto-create (IMP-20), batched ────────────────────────────────────

/** ilike pattern for a company name: % and _ are literals, as in the row-by-row code. */
function ilikePattern(name: string): string {
  return name.replace(/[%_]/g, '\\$&')
}

/** Quotes a value for a PostgREST `or=(...)` filter. */
function orQuote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export type AccountCache = Map<string, string>

/**
 * Finds or creates the account for each company (case-insensitive, one account
 * per company even when several rows name it) and links the contacts to it.
 * Failures are ignored, like the row-by-row helper: the contact just stays
 * unlinked. `cache` remembers company -> account id across chunks.
 */
export async function linkContactsToAccounts(
  db: Db,
  orgId: string,
  links: Array<{ company: string; contactId: string }>,
  cache: AccountCache,
): Promise<void> {
  if (links.length === 0) return
  const keyOf = (name: string) => name.toLowerCase()

  const wanted = new Map<string, string>() // key -> display name
  for (const { company } of links) {
    const k = keyOf(company)
    if (!cache.has(k) && !wanted.has(k)) wanted.set(k, company)
  }

  if (wanted.size > 0) {
    // One query per FILTER_VALUES_PER_QUERY companies. ilike is case-insensitive,
    // which an exact `.in('name', …)` would not be.
    const names = [...wanted.values()]
    const pages = await Promise.all(
      sliceInto(names, FILTER_VALUES_PER_QUERY).map((part) =>
        db
          .from('accounts')
          .select('id, name')
          .eq('org_id', orgId)
          .or(part.map((n) => `name.ilike.${orQuote(ilikePattern(n))}`).join(',')),
      ),
    )
    for (const { data } of pages) {
      for (const a of (data ?? []) as Array<{ id: string; name: string | null }>) {
        const k = keyOf(String(a.name ?? ''))
        if (wanted.has(k) && !cache.has(k)) cache.set(k, a.id)
      }
    }

    const missing = [...wanted.entries()].filter(([k]) => !cache.has(k))
    if (missing.length > 0) {
      const rows = missing.map(([, n]) => ({ org_id: orgId, name: n.trim(), source: 'manual' }))
      const { data, error } = await db.from('accounts').insert(rows).select('id, name')
      if (!error && Array.isArray(data)) {
        const created = data as Array<{ id: string; name: string | null }>
        if (created.length === rows.length) {
          missing.forEach(([k], i) => { if (created[i]?.id) cache.set(k, created[i].id) })
        }
      } else if (error) {
        for (const [k, n] of missing) {
          const { data: one } = await db
            .from('accounts').insert({ org_id: orgId, name: n.trim(), source: 'manual' })
            .select('id').single()
          if (one?.id) cache.set(k, one.id)
        }
      }
    }
  }

  const byAccount = new Map<string, string[]>()
  for (const { company, contactId } of links) {
    const accountId = cache.get(keyOf(company))
    if (!accountId) continue
    const list = byAccount.get(accountId)
    if (list) list.push(contactId)
    else byAccount.set(accountId, [contactId])
  }
  const units: Array<{ accountId: string; ids: string[] }> = []
  for (const [accountId, ids] of byAccount) {
    for (const part of sliceInto(ids, FILTER_VALUES_PER_QUERY)) units.push({ accountId, ids: part })
  }
  await mapWithConcurrency(units, UPDATE_CONCURRENCY, ({ accountId, ids }) =>
    Promise.resolve(db.from('contacts').update({ account_id: accountId }).in('id', ids)),
  )
}
