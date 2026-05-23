// supabase/functions/process-imports/index.ts
// Deno Edge Function — processes queued contact import jobs.
//
// Trigger options (both work):
//   1. HTTP POST with { importId: string } body
//   2. Supabase Database Webhook on contact_imports INSERT/UPDATE where status = 'queued'
//
// Returns HTTP 200 quickly after claiming the job.
// Actual row processing runs in background via EdgeRuntime.waitUntil().

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CHUNK_SIZE = 200
const PER_ORG_CONCURRENCY_CAP = 2
const GLOBAL_CONCURRENCY_CAP = 8
const BUCKET = 'contact-imports'

// ── Inline helpers (no Node.js — Deno only) ───────────────────────────────────

function parseCsv(text: string): { headers: string[]; rows: string[][] } {
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

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  // Parse importId from direct POST or from DB webhook payload
  let importId: string | null = null
  try {
    const body = await req.json()
    if (body?.importId) {
      importId = body.importId
    } else if (body?.record?.status === 'queued') {
      importId = body.record.id
    } else if (body?.new?.status === 'queued') {
      importId = body.new.id
    }
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Bad JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!importId) {
    return new Response(JSON.stringify({ ok: true, message: 'No import ID — skipped' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Check global + per-org concurrency caps (IMP-10)
  const { data: processing } = await supabase
    .from('contact_imports')
    .select('id, org_id')
    .eq('status', 'processing')

  const { data: importRow } = await supabase
    .from('contact_imports')
    .select('*')
    .eq('id', importId)
    .eq('status', 'queued')
    .single()

  if (!importRow) {
    return new Response(JSON.stringify({ ok: true, message: 'Import not found or not queued' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }

  const orgId: string = importRow.org_id
  const orgCount = (processing ?? []).filter((r) => r.org_id === orgId).length
  const globalCount = (processing ?? []).length

  if (orgCount >= PER_ORG_CONCURRENCY_CAP || globalCount >= GLOBAL_CONCURRENCY_CAP) {
    return new Response(JSON.stringify({ ok: true, message: 'Capacity full — job stays queued' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Atomic claim: CAS from queued → processing (IMP-10)
  const { data: claimed } = await supabase
    .from('contact_imports')
    .update({ status: 'processing', started_at: new Date().toISOString() })
    .eq('id', importId)
    .eq('status', 'queued')
    .select('id')
    .single()

  if (!claimed) {
    return new Response(JSON.stringify({ ok: true, message: 'Claimed by concurrent worker' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Return response immediately — processing continues in background (IMP-11 Realtime)
  // @ts-ignore — Deno Deploy / Supabase Edge Runtime API
  const ctx = (typeof EdgeRuntime !== 'undefined' ? EdgeRuntime : null)
  const processPromise = processImport(supabase, importRow)
  if (ctx?.waitUntil) {
    ctx.waitUntil(processPromise)
  } else {
    // Fallback: await directly (synchronous processing)
    await processPromise
  }

  return new Response(JSON.stringify({ ok: true, importId, message: 'Processing started' }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
})

// ── Processing worker ─────────────────────────────────────────────────────────

async function processImport(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  // deno-lint-ignore no-explicit-any
  importRow: any,
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
    // Download CSV from Storage
    const { data: blob, error: dlError } = await supabase.storage
      .from(BUCKET)
      .download(storagePath)

    if (dlError || !blob) throw new Error(dlError?.message ?? 'Storage download failed')

    const csvText = await blob.text()
    const { headers, rows } = parseCsv(csvText)
    if (headers.length === 0) throw new Error('CSV has no headers')

    // Update total_rows to accurate count (replaces the approximate from Phase 74)
    await supabase.from('contact_imports').update({ total_rows: rows.length }).eq('id', importId)

    // Build field → column index maps from the mapping config
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

    for (let chunkStart = 0; chunkStart < rows.length; chunkStart += CHUNK_SIZE) {
      // Check for cancellation between chunks (IMP-12)
      const { data: status } = await supabase
        .from('contact_imports').select('status').eq('id', importId).single()
      if (status?.status === 'cancelled') return

      const chunk = rows.slice(chunkStart, chunkStart + CHUNK_SIZE)

      // Batch dedup lookup for this chunk
      const chunkPhones = usePhone
        ? chunk.map((r: string[]) => normalisePhone(r[phoneIdx])).filter(Boolean)
        : []
      const chunkEmails = useEmail
        ? chunk.map((r: string[]) => normaliseEmail(r[emailIdx])).filter(Boolean)
        : []

      const existingByPhone = new Map<string, string>()
      const existingByEmail = new Map<string, string>()

      if (chunkPhones.length > 0) {
        const { data } = await supabase
          .from('contacts').select('id, phone')
          .eq('org_id', orgId).in('phone', chunkPhones)
        for (const c of data ?? []) { if (c.phone) existingByPhone.set(c.phone, c.id) }
      }
      if (chunkEmails.length > 0) {
        const { data } = await supabase
          .from('contacts').select('id, email')
          .eq('org_id', orgId).in('email', chunkEmails)
        for (const c of data ?? []) { if (c.email) existingByEmail.set(c.email, c.id) }
      }

      for (let i = 0; i < chunk.length; i++) {
        const row = chunk[i] as string[]
        const rowNum = chunkStart + i + 2 // 1-indexed + header row

        const phone = normalisePhone(phoneIdx >= 0 ? row[phoneIdx] : null)
        const email = normaliseEmail(emailIdx >= 0 ? row[emailIdx] : null)

        if (!phone && !email) {
          errorRows++
          await supabase.from('contact_import_errors').insert({
            import_id: importId,
            row_number: rowNum,
            raw_row: Object.fromEntries(headers.map((h, hi) => [h, row[hi] ?? ''])),
            field: 'phone_or_email',
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

        // Custom fields
        const cfPatch: Record<string, unknown> = {}
        for (const [cfKey, cfIdx] of Object.entries(cfFieldToColIdx)) {
          const val = row[cfIdx as number]
          if (val !== undefined && val !== '') cfPatch[cfKey] = val
        }

        if (existingId) {
          if (dedup === 'skip_existing') {
            skippedRows++
          } else if (dedup === 'update_existing') {
            // Non-empty fields from the row win; empty fields leave existing value
            // deno-lint-ignore no-explicit-any
            const patch: Record<string, any> = {}
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

            const { error: updateErr } = await supabase
              .from('contacts').update(patch).eq('id', existingId)

            if (updateErr) {
              errorRows++
              await supabase.from('contact_import_errors').insert({
                import_id: importId, row_number: rowNum,
                raw_row: Object.fromEntries(headers.map((h, hi) => [h, row[hi] ?? ''])),
                field: null, message: updateErr.message,
              })
            } else {
              updatedRows++
            }
          } else {
            // create_duplicate — fall through to insert
            const contactId = await insertContact(supabase, orgId, {
              name, phone, email, notes, company, allTags, defaultSource, defaultAssignedTo, cfPatch,
              firstName, lastName,
            })
            if (contactId) {
              insertedRows++
              if (company) await findOrCreateAccount(supabase, orgId, company, contactId)
            } else {
              errorRows++
              await supabase.from('contact_import_errors').insert({
                import_id: importId, row_number: rowNum,
                raw_row: Object.fromEntries(headers.map((h, hi) => [h, row[hi] ?? ''])),
                field: null, message: 'Insert failed',
              })
            }
          }
        } else {
          const contactId = await insertContact(supabase, orgId, {
            name, phone, email, notes, company, allTags, defaultSource, defaultAssignedTo, cfPatch,
            firstName, lastName,
          })
          if (contactId) {
            insertedRows++
            if (company) await findOrCreateAccount(supabase, orgId, company, contactId) // IMP-20
          } else {
            errorRows++
            await supabase.from('contact_import_errors').insert({
              import_id: importId, row_number: rowNum,
              raw_row: Object.fromEntries(headers.map((h, hi) => [h, row[hi] ?? ''])),
              field: null, message: 'Insert failed',
            })
          }
        }
      } // end chunk rows loop

      processedRows += chunk.length

      // Update progress — Supabase Realtime notifies subscribers (IMP-11)
      await supabase.from('contact_imports').update({
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

    await supabase.from('contact_imports').update({
      status: finalStatus,
      finished_at: new Date().toISOString(),
    }).eq('id', importId)

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await supabase.from('contact_imports').update({
      status: 'failed',
      status_message: message,
      finished_at: new Date().toISOString(),
    }).eq('id', importId)
  }
}

// ── Contact insert helper ─────────────────────────────────────────────────────

async function insertContact(
  // deno-lint-ignore no-explicit-any
  supabase: any,
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
  // deno-lint-ignore no-explicit-any
  const row: Record<string, any> = {
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

  const { data, error } = await supabase
    .from('contacts').insert(row).select('id').single()

  if (error) return null
  return data?.id ?? null
}

// ── Account auto-create helper (IMP-20) ──────────────────────────────────────

async function findOrCreateAccount(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  orgId: string,
  name: string,
  contactId: string,
): Promise<void> {
  const escaped = name.replace(/[%_]/g, '\\$&')

  const { data: existing } = await supabase
    .from('accounts').select('id').eq('org_id', orgId).ilike('name', escaped).limit(1).single()

  let accountId: string | null = existing?.id ?? null

  if (!accountId) {
    const { data: created } = await supabase
      .from('accounts').insert({ org_id: orgId, name: name.trim(), source: 'manual' })
      .select('id').single()
    accountId = created?.id ?? null
  }

  if (accountId) {
    await supabase.from('contacts').update({ account_id: accountId }).eq('id', contactId)
  }
}
