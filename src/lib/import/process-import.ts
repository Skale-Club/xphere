// src/lib/import/process-import.ts
// Node port of supabase/functions/process-imports (Deno). Same claim rules,
// concurrency caps, per-row logic, progress updates, status transitions and
// error rows, now written a chunk at a time (see import-batch.ts). Runs inside
// the app when EDGE_FUNCTIONS_IN_APP lists "process-imports" (see
// lib/edge-functions/switch).
//
// startImportJob() validates and atomically claims the job (queued ->
// processing) and returns at once; the work is handed to `defer`
// (runAfterResponse by default), because a 200k-row CSV outlives Cloudflare's
// 100s response limit.
//
// Not ported: the Deno function also accepted Supabase Database Webhook payloads
// ({ record } / { new }). No database webhook exists (pg_net is not installed),
// and every caller passes { importId } directly.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  IMPORT_CHUNK_SIZE,
  applyUpdates,
  insertContacts,
  linkContactsToAccounts,
  lookupExisting,
  type AccountCache,
  type ContactFields,
} from '@/lib/import/import-batch'
import { runAfterResponse } from '@/lib/edge-functions/switch'
import { isTrustedDownloadUrl } from '@/lib/edge-functions/trusted-download-url'

const PER_ORG_CONCURRENCY_CAP = 2
const GLOBAL_CONCURRENCY_CAP = 8
const BUCKET = 'contact-imports'
const DOWNLOAD_TIMEOUT_MS = 30_000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ImportRow = Record<string, any>

export interface ImportJobInput {
  importId?: string | null
  /** Presigned GET for the CSV, sent when the contact-imports bucket lives on R2. */
  downloadUrl?: string | null
}

export interface ImportJobResult {
  status: number
  body: Record<string, unknown>
}

export interface ImportDeps {
  /** Reads the CSV from whichever store holds the bucket (R2 or Supabase). */
  download: (bucket: string, path: string) => Promise<{ data: Blob | null; error: { message: string } | null }>
  fetchSigned: (url: string, init: { signal: AbortSignal }) => Promise<Response>
  /** Runs the long work after the response. */
  defer: (work: () => Promise<unknown>) => void
  env: Record<string, string | undefined>
  now: () => string
}

function defaultDeps(): ImportDeps {
  return {
    download: async (bucket, path) => {
      const storage = await import('@/lib/storage')
      return storage.get(bucket as Parameters<typeof storage.get>[0], path)
    },
    fetchSigned: (url, init) => fetch(url, init),
    defer: (work) => runAfterResponse(work, 'process-imports'),
    env: process.env,
    now: () => new Date().toISOString(),
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuotes = false; i++; continue
      }
      field += ch; i++; continue
    }
    if (ch === '"') { inQuotes = true; i++; continue }
    if (ch === ',') { row.push(field); field = ''; i++; continue }
    if (ch === '\r') { i++; continue }
    if (ch === '\n') {
      row.push(field); rows.push(row); row = []; field = ''; i++; continue
    }
    field += ch; i++
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  while (rows.length && rows[rows.length - 1].every((c) => c.trim() === '')) rows.pop()
  if (rows.length === 0) return { headers: [], rows: [] }
  return { headers: rows[0].map((h) => h.trim()), rows: rows.slice(1) }
}

function normalisePhone(v: string | null | undefined): string | null {
  if (!v) return null
  const s = String(v).trim()
  if (!s) return null
  const prefix = s.startsWith('+') ? '+' : ''
  const digits = s.replace(/\D/g, '')
  return digits.length < 6 ? null : prefix + digits
}

function normaliseEmail(v: string | null | undefined): string | null {
  if (!v) return null
  const s = String(v).trim().toLowerCase()
  return s.includes('@') ? s : null
}

function splitContactName(name: string | null | undefined): { firstName: string | null; lastName: string | null } {
  const trimmed = String(name ?? '').trim()
  if (!trimmed) return { firstName: null, lastName: null }
  const [first, ...rest] = trimmed.split(/\s+/)
  return { firstName: first || null, lastName: rest.length ? rest.join(' ') : null }
}

function composeContactName(firstName: string | null, lastName: string | null): string | null {
  return [firstName?.trim(), lastName?.trim()].filter(Boolean).join(' ') || null
}

// ── Claim ─────────────────────────────────────────────────────────────────────

export async function startImportJob(
  db: Db,
  input: ImportJobInput,
  overrides: Partial<ImportDeps> = {},
): Promise<ImportJobResult> {
  const deps: ImportDeps = { ...defaultDeps(), ...overrides }

  const importId = input.importId ?? null
  const downloadUrl =
    typeof input.downloadUrl === 'string' && isTrustedDownloadUrl(input.downloadUrl, deps.env)
      ? input.downloadUrl
      : null

  if (!importId) return { status: 200, body: { ok: true, message: 'No import ID — skipped' } }

  // Global + per-org concurrency caps (IMP-10)
  const { data: processing } = await db.from('contact_imports').select('id, org_id').eq('status', 'processing')

  const { data: importRow } = await db
    .from('contact_imports')
    .select('*')
    .eq('id', importId)
    .eq('status', 'queued')
    .single()

  if (!importRow) return { status: 200, body: { ok: true, message: 'Import not found or not queued' } }

  const orgId: string = importRow.org_id
  const orgCount = (processing ?? []).filter((r: { org_id: string }) => r.org_id === orgId).length
  const globalCount = (processing ?? []).length

  if (orgCount >= PER_ORG_CONCURRENCY_CAP || globalCount >= GLOBAL_CONCURRENCY_CAP) {
    return { status: 200, body: { ok: true, message: 'Capacity full — job stays queued' } }
  }

  // Atomic claim: CAS from queued -> processing (IMP-10). Idempotent: a second
  // call for the same import finds no 'queued' row and does nothing.
  const { data: claimed } = await db
    .from('contact_imports')
    .update({ status: 'processing', started_at: deps.now() })
    .eq('id', importId)
    .eq('status', 'queued')
    .select('id')
    .single()

  if (!claimed) return { status: 200, body: { ok: true, message: 'Claimed by concurrent worker' } }

  deps.defer(() => processImport(db, importRow, downloadUrl, deps))

  return { status: 200, body: { ok: true, importId, message: 'Processing started' } }
}

// ── Processing worker ─────────────────────────────────────────────────────────

export async function processImport(
  db: Db,
  importRow: ImportRow,
  downloadUrl: string | null,
  deps: ImportDeps,
): Promise<void> {
  const {
    id: importId,
    org_id: orgId,
    storage_path: storagePath,
    mapping,
    dedup_strategy: dedupStrategy,
    dedup_keys: dedupKeys,
    default_tags: defaultTags,
    default_source: defaultSource,
    default_assigned_to: defaultAssignedTo,
  } = importRow

  try {
    // Prefer the presigned URL (R2); otherwise, or if it fails, read the bucket.
    let csvText: string | null = null
    let signedFailure: string | null = null
    if (downloadUrl) {
      try {
        // A stuck request must fail, not leave the import in 'processing'.
        const res = await deps.fetchSigned(downloadUrl, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
        if (res.ok) csvText = await res.text()
        else signedFailure = `signed URL returned HTTP ${res.status}`
      } catch (err) {
        signedFailure = `signed URL request failed (${err instanceof Error ? err.name : 'error'})`
      }
      if (signedFailure) console.warn(`[process-imports] ${signedFailure}; trying storage`)
    }
    if (csvText === null) {
      const { data: blob, error: dlError } = await deps.download(BUCKET, storagePath)
      if (dlError || !blob) {
        throw new Error(
          `CSV could not be read: ${signedFailure ?? 'no signed download URL was provided'}, ` +
            `and it could not be read from storage (${dlError?.message ?? 'no data'}).`,
        )
      }
      csvText = await blob.text()
    }
    const { headers, rows } = parseCsv(csvText)
    if (headers.length === 0) throw new Error('CSV has no headers')

    // Accurate total (replaces the approximate one from the wizard)
    await db.from('contact_imports').update({ total_rows: rows.length }).eq('id', importId)

    const fieldToColIdx: Record<string, number> = {}
    const cfFieldToColIdx: Record<string, number> = {}
    for (const [colHeader, fieldName] of Object.entries(mapping ?? {})) {
      if (!fieldName) continue
      const idx = headers.indexOf(colHeader as string)
      if (idx < 0) continue
      const fn = fieldName as string
      if (fn.startsWith('cf:')) cfFieldToColIdx[fn.slice(3)] = idx
      else fieldToColIdx[fn] = idx
    }

    const phoneIdx = fieldToColIdx['phone'] ?? -1
    const emailIdx = fieldToColIdx['email'] ?? -1
    const nameIdx = fieldToColIdx['name'] ?? -1
    const firstNameIdx = fieldToColIdx['first_name'] ?? -1
    const lastNameIdx = fieldToColIdx['last_name'] ?? -1
    const notesIdx = fieldToColIdx['notes'] ?? -1
    const companyIdx = fieldToColIdx['company'] ?? -1
    const tagsIdx = fieldToColIdx['tags'] ?? -1

    const dedup = dedupStrategy ?? 'skip_existing'
    const dKeys: string[] = dedupKeys ?? ['phone', 'email']
    const usePhone = dKeys.includes('phone') && phoneIdx >= 0
    const useEmail = dKeys.includes('email') && emailIdx >= 0

    const errorPayload = (rowNum: number, row: string[], field: string | null, message: string) => ({
      import_id: importId,
      row_number: rowNum,
      raw_row: Object.fromEntries(headers.map((h, hi) => [h, row[hi] ?? ''])),
      field,
      message,
    })

    let insertedRows = 0, updatedRows = 0, skippedRows = 0, errorRows = 0, processedRows = 0
    const accountCache: AccountCache = new Map()

    interface PendingError { rowNum: number; row: string[]; field: string | null; message: string }
    // A row that writes a key an earlier row of the chunk also writes (same phone,
    // same email, same existing contact) must see that write first, exactly as in
    // row-by-row processing. Such rows run one by one after the batched ones.
    interface Pending {
      rowNum: number
      row: string[]
      company: string | null
      kind: 'insert' | 'update'
      fields: ContactFields
      existingId?: string
      patch?: Record<string, unknown>
    }

    for (let chunkStart = 0; chunkStart < rows.length; chunkStart += IMPORT_CHUNK_SIZE) {
      // Cancellation between chunks (IMP-12): leave the row as 'cancelled'.
      const { data: status } = await db.from('contact_imports').select('status').eq('id', importId).single()
      if (status?.status === 'cancelled') return

      const chunk = rows.slice(chunkStart, chunkStart + IMPORT_CHUNK_SIZE)

      const chunkPhones = usePhone
        ? chunk.map((r: string[]) => normalisePhone(r[phoneIdx])).filter((v): v is string => !!v)
        : []
      const chunkEmails = useEmail
        ? chunk.map((r: string[]) => normaliseEmail(r[emailIdx])).filter((v): v is string => !!v)
        : []

      // One query per key type (split only to keep the URL short)
      const [existingByPhone, existingByEmail] = await Promise.all([
        chunkPhones.length > 0 ? lookupExisting(db, orgId, 'phone', chunkPhones) : new Map<string, string>(),
        chunkEmails.length > 0 ? lookupExisting(db, orgId, 'email', chunkEmails) : new Map<string, string>(),
      ])

      const errors: PendingError[] = []
      const batched: Pending[] = []
      const sequential: Pending[] = []
      const written = new Set<string>()
      const accountLinks: Array<{ company: string; contactId: string }> = []

      for (let i = 0; i < chunk.length; i++) {
        const row = chunk[i] as string[]
        const rowNum = chunkStart + i + 2 // 1-indexed + header row

        const phone = normalisePhone(phoneIdx >= 0 ? row[phoneIdx] : null)
        const email = normaliseEmail(emailIdx >= 0 ? row[emailIdx] : null)

        if (!phone && !email) {
          errorRows++
          errors.push({
            rowNum, row, field: 'phone_or_email',
            message: 'Row has no phone or email — cannot identify contact for dedup',
          })
          continue
        }

        const existingId =
          (phone ? existingByPhone.get(phone) : undefined) ??
          (email ? existingByEmail.get(email) : undefined)

        const company = companyIdx >= 0 ? (row[companyIdx] ?? '').trim() : null
        const fullName = nameIdx >= 0 ? (row[nameIdx] ?? '').trim() || null : null
        const splitName = splitContactName(fullName)
        const firstName = firstNameIdx >= 0 ? (row[firstNameIdx] ?? '').trim() || null : splitName.firstName
        const lastName = lastNameIdx >= 0 ? (row[lastNameIdx] ?? '').trim() || null : splitName.lastName
        const name = composeContactName(firstName, lastName) ?? fullName
        const notes = notesIdx >= 0 ? (row[notesIdx] ?? '').trim() || null : null
        const rawTags = tagsIdx >= 0 ? (row[tagsIdx] ?? '') : ''
        const rowTags = rawTags ? rawTags.split(',').map((t: string) => t.trim()).filter(Boolean) : []
        const allTags = [...new Set([...rowTags, ...(defaultTags ?? [])])]

        const cfPatch: Record<string, unknown> = {}
        for (const [cfKey, cfIdx] of Object.entries(cfFieldToColIdx)) {
          const val = row[cfIdx as number]
          if (val !== undefined && val !== '') cfPatch[cfKey] = val
        }

        const fields: ContactFields = {
          name, phone, email, notes, company, allTags, defaultSource, defaultAssignedTo, cfPatch,
          firstName, lastName,
        }

        let pending: Pending
        let keys: string[]
        if (existingId && dedup === 'skip_existing') {
          skippedRows++
          continue
        } else if (existingId && dedup === 'update_existing') {
          // Non-empty fields from the row win; empty fields leave the existing value
          const patch: Record<string, unknown> = {}
          if (firstName) patch.first_name = firstName
          if (lastName) patch.last_name = lastName
          if (name) patch.name = name
          if (phone && !existingByPhone.has(phone)) patch.phone = phone
          if (email && !existingByEmail.has(email)) patch.email = email
          if (notes) patch.notes = notes
          if (company) patch.company = company
          if (defaultSource) patch.source = defaultSource
          if (defaultAssignedTo) patch.assigned_to = defaultAssignedTo
          if (allTags.length > 0) patch.tags = allTags
          if (Object.keys(cfPatch).length > 0) patch.custom_fields = cfPatch
          pending = { rowNum, row, company, kind: 'update', fields, existingId, patch }
          keys = [`id:${existingId}`]
          if (patch.phone) keys.push(`p:${phone}`)
          if (patch.email) keys.push(`e:${email}`)
        } else {
          // No existing contact, or create_duplicate
          pending = { rowNum, row, company, kind: 'insert', fields }
          keys = []
          if (phone) keys.push(`p:${phone}`)
          if (email) keys.push(`e:${email}`)
        }

        (keys.some((k) => written.has(k)) ? sequential : batched).push(pending)
        for (const k of keys) written.add(k)
      }

      // ── Batched writes ───────────────────────────────────────────────────────
      const batchInserts = batched.filter((p) => p.kind === 'insert')
      const batchUpdates = batched.filter((p) => p.kind === 'update')

      const insertOutcomes = await insertContacts(db, orgId, batchInserts.map((p) => p.fields))
      batchInserts.forEach((p, idx) => {
        const out = insertOutcomes[idx]
        if (out.ok) {
          insertedRows++
          if (p.company && out.id) accountLinks.push({ company: p.company, contactId: out.id }) // IMP-20
        } else {
          errorRows++
          errors.push({ rowNum: p.rowNum, row: p.row, field: null, message: 'Insert failed' })
        }
      })

      const updateErrors = await applyUpdates(db, batchUpdates.map((p) => ({ id: p.existingId!, patch: p.patch! })))
      batchUpdates.forEach((p, idx) => {
        const message = updateErrors[idx]
        if (message === null) updatedRows++
        else {
          errorRows++
          errors.push({ rowNum: p.rowNum, row: p.row, field: null, message })
        }
      })

      // ── Rows that depend on an earlier row of this chunk, in row order ────────
      for (const p of sequential) {
        if (p.kind === 'insert') {
          const [out] = await insertContacts(db, orgId, [p.fields])
          if (out.ok) {
            insertedRows++
            if (p.company && out.id) accountLinks.push({ company: p.company, contactId: out.id })
          } else {
            errorRows++
            errors.push({ rowNum: p.rowNum, row: p.row, field: null, message: 'Insert failed' })
          }
        } else {
          const [message] = await applyUpdates(db, [{ id: p.existingId!, patch: p.patch! }])
          if (message === null) updatedRows++
          else {
            errorRows++
            errors.push({ rowNum: p.rowNum, row: p.row, field: null, message })
          }
        }
      }

      await linkContactsToAccounts(db, orgId, accountLinks, accountCache)

      if (errors.length > 0) {
        errors.sort((a, b) => a.rowNum - b.rowNum)
        const payload = errors.map((e) => errorPayload(e.rowNum, e.row, e.field, e.message))
        const { error: batchErr } = await db.from('contact_import_errors').insert(payload)
        if (batchErr) {
          // Same as before: one row at a time, so the rest are still recorded
          for (const p of payload) await db.from('contact_import_errors').insert(p)
        }
      }

      processedRows += chunk.length

      // Progress update, once per chunk; the import screen follows it live (IMP-11)
      await db.from('contact_imports').update({
        processed_rows: processedRows,
        inserted_rows: insertedRows,
        updated_rows: updatedRows,
        skipped_rows: skippedRows,
        error_rows: errorRows,
      }).eq('id', importId)
    } // end chunk loop

    const finalStatus =
      processedRows === 0 ? 'failed'
      : errorRows > 0 && insertedRows + updatedRows === 0 ? 'failed'
      : errorRows > 0 ? 'partial'
      : 'completed'

    await db.from('contact_imports').update({
      status: finalStatus,
      finished_at: deps.now(),
    }).eq('id', importId)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await db.from('contact_imports').update({
      status: 'failed',
      status_message: message,
      finished_at: deps.now(),
    }).eq('id', importId)
  }
}
