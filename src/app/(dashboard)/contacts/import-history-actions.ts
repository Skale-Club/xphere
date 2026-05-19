'use server'

import { createClient, getUser } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { Database, ContactImportStatus, ContactImportDedupStrategy } from '@/types/database'

type ImportRow = Database['public']['Tables']['contact_imports']['Row']
type ImportErrorRow = Database['public']['Tables']['contact_import_errors']['Row']

// ── getImports ────────────────────────────────────────────────────────────────

export async function getImports(): Promise<{ ok: true; imports: ImportRow[] } | { ok: false; error: string }> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Unauthenticated' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('contact_imports')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) return { ok: false, error: error.message }
  return { ok: true, imports: data ?? [] }
}

// ── getImport ─────────────────────────────────────────────────────────────────

export async function getImport(
  id: string,
): Promise<{ ok: true; import: ImportRow } | { ok: false; error: string }> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Unauthenticated' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('contact_imports')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !data) return { ok: false, error: error?.message ?? 'Not found' }
  return { ok: true, import: data }
}

// ── getImportErrors ───────────────────────────────────────────────────────────

export async function getImportErrors(
  importId: string,
  page = 1,
  pageSize = 50,
): Promise<{ ok: true; errors: ImportErrorRow[]; total: number } | { ok: false; error: string }> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Unauthenticated' }

  const supabase = await createClient()
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  const { data, error, count } = await supabase
    .from('contact_import_errors')
    .select('*', { count: 'exact' })
    .eq('import_id', importId)
    .order('row_number', { ascending: true })
    .range(from, to)

  if (error) return { ok: false, error: error.message }
  return { ok: true, errors: data ?? [], total: count ?? 0 }
}

// ── cancelImport ──────────────────────────────────────────────────────────────

export async function cancelImport(
  importId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Unauthenticated' }

  const supabase = await createClient()

  const { data: row } = await supabase
    .from('contact_imports')
    .select('status')
    .eq('id', importId)
    .single()

  if (!row) return { ok: false, error: 'Import not found' }

  const cancellable: ContactImportStatus[] = ['queued', 'processing']
  if (!cancellable.includes(row.status)) {
    return { ok: false, error: `Cannot cancel import with status "${row.status}"` }
  }

  const { error } = await supabase
    .from('contact_imports')
    .update({ status: 'cancelled', finished_at: new Date().toISOString() })
    .eq('id', importId)

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// ── exportImportErrors ────────────────────────────────────────────────────────

export async function exportImportErrors(
  importId: string,
): Promise<{ ok: true; csv: string } | { ok: false; error: string }> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Unauthenticated' }

  const supabase = await createClient()

  const { data: errors, error } = await supabase
    .from('contact_import_errors')
    .select('*')
    .eq('import_id', importId)
    .order('row_number', { ascending: true })
    .limit(5000)

  if (error) return { ok: false, error: error.message }
  if (!errors || errors.length === 0) return { ok: false, error: 'No errors to export' }

  // Build CSV from raw_row + error metadata
  const allKeys = new Set<string>()
  for (const e of errors) {
    for (const k of Object.keys(e.raw_row ?? {})) allKeys.add(k)
  }
  const rawKeys = [...allKeys]

  function esc(v: string): string {
    if (v.includes(',') || v.includes('"') || v.includes('\n')) {
      return `"${v.replace(/"/g, '""')}"`
    }
    return v
  }

  const headers = ['_row_number', '_field', '_error_message', ...rawKeys]
  const lines: string[] = [headers.map(esc).join(',')]

  for (const e of errors) {
    const raw = (e.raw_row ?? {}) as Record<string, unknown>
    const rowCols = rawKeys.map((k) => esc(String(raw[k] ?? '')))
    lines.push([String(e.row_number), esc(e.field ?? ''), esc(e.message), ...rowCols].join(','))
  }

  return { ok: true, csv: lines.join('\r\n') }
}

// ── retryImport ───────────────────────────────────────────────────────────────
// Creates a new import job that re-processes only the failed rows of the original
// job, using the same mapping and dedup configuration. (IMP-15)

export async function retryImport(
  importId: string,
): Promise<{ ok: true; newImportId: string } | { ok: false; error: string }> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Unauthenticated' }

  const supabase = await createClient()

  // Read original import config
  const { data: original } = await supabase
    .from('contact_imports')
    .select('*')
    .eq('id', importId)
    .single()

  if (!original) return { ok: false, error: 'Import not found' }
  if (original.status !== 'failed' && original.status !== 'partial' && original.status !== 'cancelled') {
    return { ok: false, error: 'Only failed, partial, or cancelled imports can be retried' }
  }

  // Fetch all error rows
  const { data: errors, error: errFetchErr } = await supabase
    .from('contact_import_errors')
    .select('*')
    .eq('import_id', importId)
    .order('row_number', { ascending: true })
    .limit(5000)

  if (errFetchErr) return { ok: false, error: errFetchErr.message }
  if (!errors || errors.length === 0) return { ok: false, error: 'No error rows to retry' }

  // Reconstruct CSV from error rows
  const allKeys = new Set<string>()
  for (const e of errors) {
    for (const k of Object.keys(e.raw_row ?? {})) allKeys.add(k)
  }
  const rawKeys = [...allKeys]

  function esc(v: string): string {
    if (v.includes(',') || v.includes('"') || v.includes('\n')) return `"${v.replace(/"/g, '""')}"`
    return v
  }

  const lines: string[] = [rawKeys.map(esc).join(',')]
  for (const e of errors) {
    const raw = (e.raw_row ?? {}) as Record<string, unknown>
    lines.push(rawKeys.map((k) => esc(String(raw[k] ?? ''))).join(','))
  }
  const retryCsv = lines.join('\r\n')
  const retryBytes = new TextEncoder().encode(retryCsv)

  const admin = createServiceRoleClient()
  const { data: orgIdData } = await supabase.rpc('get_current_org_id')
  if (!orgIdData) return { ok: false, error: 'No active org' }

  // Create new import record
  const filename = `retry-${Date.now()}.csv`
  const { data: newRow, error: insertErr } = await admin
    .from('contact_imports')
    .insert({
      org_id: original.org_id,
      storage_path: '',
      filename,
      size_bytes: retryBytes.byteLength,
      status: 'uploading',
      mapping: original.mapping,
      dedup_strategy: original.dedup_strategy as ContactImportDedupStrategy,
      dedup_keys: original.dedup_keys,
      default_tags: original.default_tags,
      default_source: original.default_source,
      default_assigned_to: original.default_assigned_to,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (insertErr || !newRow) return { ok: false, error: insertErr?.message ?? 'Failed to create retry record' }

  const newImportId = newRow.id
  const storagePath = `${original.org_id}/${newImportId}/${filename}`

  // Upload reconstructed CSV to Storage via service role
  const { error: uploadErr } = await admin.storage
    .from('contact-imports')
    .upload(storagePath, retryBytes, { contentType: 'text/csv', upsert: false })

  if (uploadErr) {
    await admin.from('contact_imports').delete().eq('id', newImportId)
    return { ok: false, error: uploadErr.message }
  }

  // Update storage_path and set to queued
  await admin
    .from('contact_imports')
    .update({ storage_path: storagePath, status: 'queued', total_rows: errors.length })
    .eq('id', newImportId)

  // Trigger the worker
  await admin.functions
    .invoke('process-imports', { body: { importId: newImportId } })
    .catch(() => {})

  return { ok: true, newImportId }
}
