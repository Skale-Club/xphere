// src/lib/import/process-import.ts
// Node port of supabase/functions/process-imports (Deno). Same claim rules,
// concurrency caps, per-row logic, progress updates, status transitions and
// error rows. Runs inside the app when EDGE_FUNCTIONS_IN_APP lists
// "process-imports" (see lib/edge-functions/switch).
//
// startImportJob() validates and atomically claims the job (queued ->
// processing) and returns at once; the row-by-row work is handed to `defer`
// (runAfterResponse by default), because a 200k-row CSV outlives Cloudflare's
// 100s response limit.
//
// Not ported: the Deno function also accepted Supabase Database Webhook payloads
// ({ record } / { new }). No database webhook exists (pg_net is not installed),
// and every caller passes { importId } directly.

import type { SupabaseClient } from '@supabase/supabase-js'
import { runAfterResponse } from '@/lib/edge-functions/switch'
import { isTrustedDownloadUrl } from '@/lib/edge-functions/trusted-download-url'

const CHUNK_SIZE = 200
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

    let insertedRows = 0, updatedRows = 0, skippedRows = 0, errorRows = 0, processedRows = 0

    const recordError = (rowNum: number, row: string[], headers: string[], field: string | null, message: string) =>
      db.from('contact_import_errors').insert({
        import_id: importId,
        row_number: rowNum,
        raw_row: Object.fromEntries(headers.map((h, hi) => [h, row[hi] ?? ''])),
        field,
        message,
      })

    for (let chunkStart = 0; chunkStart < rows.length; chunkStart += CHUNK_SIZE) {
      // Cancellation between chunks (IMP-12): leave the row as 'cancelled'.
      const { data: status } = await db.from('contact_imports').select('status').eq('id', importId).single()
      if (status?.status === 'cancelled') return

      const chunk = rows.slice(chunkStart, chunkStart + CHUNK_SIZE)

      const chunkPhones = usePhone
        ? chunk.map((r: string[]) => normalisePhone(r[phoneIdx])).filter(Boolean)
        : []
      const chunkEmails = useEmail
        ? chunk.map((r: string[]) => normaliseEmail(r[emailIdx])).filter(Boolean)
        : []

      const existingByPhone = new Map<string, string>()
      const existingByEmail = new Map<string, string>()

      if (chunkPhones.length > 0) {
        const { data } = await db.from('contacts').select('id, phone').eq('org_id', orgId).in('phone', chunkPhones)
        for (const c of data ?? []) { if (c.phone) existingByPhone.set(c.phone, c.id) }
      }
      if (chunkEmails.length > 0) {
        const { data } = await db.from('contacts').select('id, email').eq('org_id', orgId).in('email', chunkEmails)
        for (const c of data ?? []) { if (c.email) existingByEmail.set(c.email, c.id) }
      }

      for (let i = 0; i < chunk.length; i++) {
        const row = chunk[i] as string[]
        const rowNum = chunkStart + i + 2 // 1-indexed + header row

        const phone = normalisePhone(phoneIdx >= 0 ? row[phoneIdx] : null)
        const email = normaliseEmail(emailIdx >= 0 ? row[emailIdx] : null)

        if (!phone && !email) {
          errorRows++
          await recordError(rowNum, row, headers, 'phone_or_email',
            'Row has no phone or email — cannot identify contact for dedup')
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

        const insertFields = {
          name, phone, email, notes, company, allTags, defaultSource, defaultAssignedTo, cfPatch,
          firstName, lastName,
        }

        if (existingId && dedup === 'skip_existing') {
          skippedRows++
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

          const { error: updateErr } = await db.from('contacts').update(patch).eq('id', existingId)
          if (updateErr) {
            errorRows++
            await recordError(rowNum, row, headers, null, updateErr.message)
          } else {
            updatedRows++
          }
        } else {
          // No existing contact, or create_duplicate
          const contactId = await insertContact(db, orgId, insertFields)
          if (contactId) {
            insertedRows++
            if (company) await findOrCreateAccount(db, orgId, company, contactId) // IMP-20
          } else {
            errorRows++
            await recordError(rowNum, row, headers, null, 'Insert failed')
          }
        }
      } // end chunk rows loop

      processedRows += chunk.length

      // Progress update; the import screen follows it live (IMP-11)
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

// ── Contact insert helper ─────────────────────────────────────────────────────

async function insertContact(
  db: Db,
  orgId: string,
  fields: {
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
  },
): Promise<string | null> {
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

  const { data, error } = await db.from('contacts').insert(row).select('id').single()
  if (error) return null
  return data?.id ?? null
}

// ── Account auto-create helper (IMP-20) ──────────────────────────────────────

async function findOrCreateAccount(db: Db, orgId: string, name: string, contactId: string): Promise<void> {
  const escaped = name.replace(/[%_]/g, '\\$&')

  const { data: existing } = await db
    .from('accounts').select('id').eq('org_id', orgId).ilike('name', escaped).limit(1).single()

  let accountId: string | null = existing?.id ?? null

  if (!accountId) {
    const { data: created } = await db
      .from('accounts').insert({ org_id: orgId, name: name.trim(), source: 'manual' })
      .select('id').single()
    accountId = created?.id ?? null
  }

  if (accountId) {
    await db.from('contacts').update({ account_id: accountId }).eq('id', contactId)
  }
}
