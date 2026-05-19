'use server'

import { createClient, getUser } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { parseCsvLimit, countCsvDataRows, suggestColumnMappingEnhanced } from '@/lib/contacts/csv'
import { normalisePhone, normaliseEmail } from '@/lib/contacts/zod-schemas'
import { getDefinitions } from '@/app/(dashboard)/settings/custom-fields/actions'
import type { ContactImportDedupStrategy } from '@/types/database'

const BUCKET = 'contact-imports'

type Ok<T> = { ok: true } & T
type Err = { ok: false; error: string }

// ── createImportRecord ────────────────────────────────────────────────────────

export async function createImportRecord(
  filename: string,
  sizeBytes: number,
): Promise<Ok<{ importId: string; signedUrl: string; storagePath: string; currentUserId: string }> | Err> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Unauthenticated' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No active org' }

  const { data: importRow, error: insertError } = await supabase
    .from('contact_imports')
    .insert({
      org_id: orgId as string,
      storage_path: '',
      filename,
      size_bytes: sizeBytes,
      status: 'uploading',
      dedup_strategy: 'skip_existing',
      dedup_keys: ['phone', 'email'],
      created_by: user.id,
    })
    .select('id')
    .single()

  if (insertError || !importRow) {
    return { ok: false, error: insertError?.message ?? 'Failed to create import record' }
  }

  const importId = importRow.id
  const path = `${orgId}/${importId}/${filename}`

  const { data: signedData, error: signedError } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(path)

  if (signedError || !signedData) {
    await supabase.from('contact_imports').delete().eq('id', importId)
    return { ok: false, error: signedError?.message ?? 'Failed to create upload URL' }
  }

  await supabase
    .from('contact_imports')
    .update({ storage_path: path })
    .eq('id', importId)

  return {
    ok: true,
    importId,
    signedUrl: signedData.signedUrl,
    storagePath: path,
    currentUserId: user.id,
  }
}

// ── finalizeUpload ────────────────────────────────────────────────────────────

export async function finalizeUpload(importId: string): Promise<
  Ok<{
    headers: string[]
    previewRows: string[][]
    totalRows: number
    suggestedMapping: Record<string, string | null>
  }> | Err
> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Unauthenticated' }

  const supabase = await createClient()

  const { data: row, error: rowError } = await supabase
    .from('contact_imports')
    .select('id, storage_path, status')
    .eq('id', importId)
    .single()

  if (rowError || !row) return { ok: false, error: 'Import not found' }
  if (row.status !== 'uploading') return { ok: false, error: `Unexpected status: ${row.status}` }

  const { data: blob, error: dlError } = await supabase.storage
    .from(BUCKET)
    .download(row.storage_path)

  if (dlError || !blob) {
    return { ok: false, error: dlError?.message ?? 'Failed to download upload' }
  }

  const csvText = await blob.text()

  // Parse only first 5 preview rows — fast even for 50MB files
  const { headers, rows: previewRows } = parseCsvLimit(csvText, 5)
  if (headers.length === 0) {
    await supabase
      .from('contact_imports')
      .update({ status: 'failed', status_message: 'CSV has no headers' })
      .eq('id', importId)
    return { ok: false, error: 'CSV has no headers' }
  }

  // Approximate total row count via newline scan (faster than full parse)
  const totalRows = countCsvDataRows(csvText)

  // Fetch custom field definitions for enhanced mapping suggestions
  const defsResult = await getDefinitions({ entity: 'contact', includeArchived: false })
  const customDefs = defsResult.ok ? defsResult.data.map((d) => ({ key: d.key, label: d.label })) : []

  const suggestedMapping = suggestColumnMappingEnhanced(headers, previewRows, customDefs)

  await supabase
    .from('contact_imports')
    .update({ status: 'previewing', total_rows: totalRows })
    .eq('id', importId)

  return { ok: true, headers, previewRows, totalRows, suggestedMapping }
}

// ── saveImportConfig ──────────────────────────────────────────────────────────

export async function saveImportConfig(
  importId: string,
  config: {
    mapping: Record<string, string | null>
    dedupStrategy: ContactImportDedupStrategy
    dedupKeys: string[]
    defaultTags?: string[]
    defaultSource?: string | null
    defaultAssignedTo?: string | null
  },
): Promise<{ ok: true } | Err> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Unauthenticated' }

  const supabase = await createClient()

  const { error } = await supabase
    .from('contact_imports')
    .update({
      mapping: config.mapping,
      dedup_strategy: config.dedupStrategy,
      dedup_keys: config.dedupKeys,
      default_tags: config.defaultTags ?? null,
      default_source: config.defaultSource ?? null,
      default_assigned_to: config.defaultAssignedTo ?? null,
    })
    .eq('id', importId)

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// ── dryRunImport ──────────────────────────────────────────────────────────────

export async function dryRunImport(importId: string): Promise<
  Ok<{
    wouldInsert: number
    wouldUpdate: number
    wouldSkip: number
    wouldError: number
    sampleErrors: string[]
  }> | Err
> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Unauthenticated' }

  const supabase = await createClient()

  const { data: row, error: rowError } = await supabase
    .from('contact_imports')
    .select('storage_path, mapping, dedup_strategy, dedup_keys')
    .eq('id', importId)
    .single()

  if (rowError || !row) return { ok: false, error: 'Import not found' }

  const { data: blob, error: dlError } = await supabase.storage
    .from(BUCKET)
    .download(row.storage_path)

  if (dlError || !blob) {
    return { ok: false, error: dlError?.message ?? 'Failed to read file' }
  }

  const csvText = await blob.text()
  const { headers, rows: dryRunRows } = parseCsvLimit(csvText, 1000)

  const mapping = (row.mapping ?? {}) as Record<string, string | null>
  const dedupKeys = (row.dedup_keys ?? ['phone', 'email']) as string[]
  const dedupStrategy = row.dedup_strategy as ContactImportDedupStrategy

  // Locate column indices for dedup keys
  const phoneColHeader = Object.entries(mapping).find(([, v]) => v === 'phone')?.[0]
  const emailColHeader = Object.entries(mapping).find(([, v]) => v === 'email')?.[0]
  const phoneIdx = phoneColHeader !== undefined ? headers.indexOf(phoneColHeader) : -1
  const emailIdx = emailColHeader !== undefined ? headers.indexOf(emailColHeader) : -1

  // Determine which dedup keys are active based on user selection + mapped columns
  const usePhone = dedupKeys.includes('phone') && phoneIdx >= 0
  const useEmail = dedupKeys.includes('email') && emailIdx >= 0

  // Collect all phone/email values for batch DB lookup
  const phones = new Set<string>()
  const emails = new Set<string>()
  for (const r of dryRunRows) {
    if (usePhone) { const p = normalisePhone(r[phoneIdx]); if (p) phones.add(p) }
    if (useEmail) { const e = normaliseEmail(r[emailIdx]); if (e) emails.add(e) }
  }

  // Batch query existing contacts
  const existingPhones = new Set<string>()
  const existingEmails = new Set<string>()
  if (phones.size > 0) {
    const { data } = await supabase.from('contacts').select('phone').in('phone', [...phones])
    for (const c of data ?? []) { if (c.phone) existingPhones.add(c.phone) }
  }
  if (emails.size > 0) {
    const { data } = await supabase.from('contacts').select('email').in('email', [...emails])
    for (const c of data ?? []) { if (c.email) existingEmails.add(c.email) }
  }

  let wouldInsert = 0
  let wouldUpdate = 0
  let wouldSkip = 0
  let wouldError = 0
  const sampleErrors: string[] = []

  for (let i = 0; i < dryRunRows.length; i++) {
    const r = dryRunRows[i]
    const phone = usePhone ? normalisePhone(r[phoneIdx]) : null
    const email = useEmail ? normaliseEmail(r[emailIdx]) : null

    if (!phone && !email) {
      wouldError++
      if (sampleErrors.length < 5) {
        sampleErrors.push(`Row ${i + 2}: no usable phone or email value`)
      }
      continue
    }

    const exists =
      (phone && existingPhones.has(phone)) ||
      (email && existingEmails.has(email))

    if (exists) {
      if (dedupStrategy === 'skip_existing') wouldSkip++
      else if (dedupStrategy === 'update_existing') wouldUpdate++
      else wouldInsert++ // create_duplicate
    } else {
      wouldInsert++
    }
  }

  return { ok: true, wouldInsert, wouldUpdate, wouldSkip, wouldError, sampleErrors }
}

// ── enqueueImport ─────────────────────────────────────────────────────────────

export async function enqueueImport(importId: string): Promise<{ ok: true } | Err> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Unauthenticated' }

  const supabase = await createClient()

  // IMP-17: Verify phone or email is mapped before enqueuing
  const { data: row } = await supabase
    .from('contact_imports')
    .select('mapping')
    .eq('id', importId)
    .single()

  if (!row) return { ok: false, error: 'Import not found' }

  const mapping = (row.mapping ?? {}) as Record<string, string | null>
  const mappedFields = Object.values(mapping).filter(Boolean) as string[]
  const hasPhone = mappedFields.includes('phone')
  const hasEmail = mappedFields.includes('email')
  if (!hasPhone && !hasEmail) {
    return { ok: false, error: 'Map at least one of Phone or Email before starting the import.' }
  }

  const { error } = await supabase
    .from('contact_imports')
    .update({ status: 'queued' })
    .eq('id', importId)

  if (error) return { ok: false, error: error.message }

  // Trigger the processing worker (returns fast; actual processing is async)
  const admin = createServiceRoleClient()
  await admin.functions
    .invoke('process-imports', { body: { importId } })
    .catch(() => {
      // Worker invocation failed — job stays queued; DB webhook acts as backup trigger
    })

  return { ok: true }
}
