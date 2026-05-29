// scripts/migrate-ghl-contacts.ts
// One-off migration: pulls every GoHighLevel contact for an org into Xphere's
// `contacts` table. Uses the reusable core in src/lib/ghl/ (credentials loader,
// paginated list, custom-field map, pure mapper) so the same logic can later
// power a product "Import from GoHighLevel" feature.
//
// Runs as a Node service-role script (bypasses RLS, writes explicit org_id).
// No 60s serverless limit. Idempotent: dedup is by normalized phone/email and
// the strategy is update_existing, so re-running produces ~0 inserts.
//
// Usage:
//   npx tsx scripts/migrate-ghl-contacts.ts --org "Skale Club" [--dry-run]
//   npx tsx scripts/migrate-ghl-contacts.ts --org-id <uuid> [--dry-run]

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { getGhlCredentialsForOrg } from '@/lib/ghl/credentials'
import { listAllGhlContacts } from '@/lib/ghl/list-contacts'
import { getGhlCustomFieldKeyMap } from '@/lib/ghl/list-custom-fields'
import { mapGhlContact, type MappedGhlContact } from '@/lib/ghl/map-contact-to-xphere'

// ── env ─────────────────────────────────────────────────────────────────────
function loadEnv() {
  const text = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const k = t.slice(0, eq).trim()
    let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!(k in process.env)) process.env[k] = v
  }
}

// ── args ────────────────────────────────────────────────────────────────────
function parseArgs(argv: string[]) {
  const args: { org?: string; orgId?: string; dryRun: boolean; maxPages?: number } = { dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') args.dryRun = true
    else if (a === '--org') args.org = argv[++i]
    else if (a === '--org-id') args.orgId = argv[++i]
    else if (a === '--max-pages') args.maxPages = Number(argv[++i])
  }
  return args
}

const CHUNK_SIZE = 200
const PAGE_DELAY_MS = 250 // gentle on GHL rate limits

type Counters = { inserted: number; updated: number; skipped: number; errors: number }

function log(msg: string) {
  process.stdout.write(`${new Date().toISOString()}  ${msg}\n`)
}

async function resolveOrgId(supabase: SupabaseClient, args: ReturnType<typeof parseArgs>): Promise<string> {
  if (args.orgId) return args.orgId
  if (!args.org) throw new Error('Provide --org "<name>" or --org-id <uuid>')
  const { data, error } = await supabase
    .from('organizations')
    .select('id, name')
    .ilike('name', args.org)
    .single()
  if (error || !data) throw new Error(`Org not found by name "${args.org}": ${error?.message ?? 'no row'}`)
  log(`Org: ${data.name} (${data.id})`)
  return data.id as string
}

/**
 * Looks up existing contacts in this org by the normalized columns that back
 * the org-scoped UNIQUE indexes (phone_e164, email_normalized), excluding
 * archived duplicates. Returns id keyed by the normalized value — which equals
 * our normalisePhone/normaliseEmail output, so chunk lookups match the same
 * rows the DB constraint would.
 */
async function loadExisting(
  supabase: SupabaseClient,
  orgId: string,
  phones: string[],
  emails: string[],
): Promise<{ byPhone: Map<string, string>; byEmail: Map<string, string> }> {
  const byPhone = new Map<string, string>()
  const byEmail = new Map<string, string>()
  if (phones.length > 0) {
    const { data } = await supabase
      .from('contacts')
      .select('id, phone_e164')
      .eq('org_id', orgId)
      .in('phone_e164', phones)
      .neq('identity_status', 'archived_duplicate')
    for (const c of data ?? []) if (c.phone_e164) byPhone.set(c.phone_e164, c.id)
  }
  if (emails.length > 0) {
    const { data } = await supabase
      .from('contacts')
      .select('id, email_normalized')
      .eq('org_id', orgId)
      .in('email_normalized', emails)
      .neq('identity_status', 'archived_duplicate')
    for (const c of data ?? []) if (c.email_normalized) byEmail.set(c.email_normalized, c.id)
  }
  return { byPhone, byEmail }
}

function buildInsertRow(orgId: string, m: MappedGhlContact) {
  return {
    org_id: orgId,
    first_name: m.first_name,
    last_name: m.last_name,
    name: m.name,
    phone: m.phone,
    email: m.email,
    company: m.company,
    source: m.source,
    external_id: m.external_id,
    tags: m.tags,
    custom_fields: m.custom_fields,
  }
}

/** update_existing: only non-empty fields from GHL win; tags + custom_fields merge. */
async function applyUpdate(
  supabase: SupabaseClient,
  existingId: string,
  m: MappedGhlContact,
  taken: { byPhone: Map<string, string>; byEmail: Map<string, string> },
): Promise<string | null> {
  // Read current tags/custom_fields/external_id to merge rather than overwrite.
  const { data: cur } = await supabase
    .from('contacts')
    .select('tags, custom_fields, external_id')
    .eq('id', existingId)
    .single()

  const patch: Record<string, unknown> = {}
  if (m.first_name) patch.first_name = m.first_name
  if (m.last_name) patch.last_name = m.last_name
  if (m.name) patch.name = m.name
  if (m.company) patch.company = m.company
  // Only set phone/email if it would not collide with a different existing row.
  if (m.phone && !taken.byPhone.has(m.phone)) patch.phone = m.phone
  if (m.email && !taken.byEmail.has(m.email)) patch.email = m.email
  if (!cur?.external_id && m.external_id) patch.external_id = m.external_id

  const curTags: string[] = Array.isArray(cur?.tags) ? cur!.tags : []
  const mergedTags = [...new Set([...curTags, ...m.tags])]
  if (mergedTags.length !== curTags.length) patch.tags = mergedTags

  if (Object.keys(m.custom_fields).length > 0) {
    const curCf = (cur?.custom_fields && typeof cur.custom_fields === 'object') ? cur.custom_fields : {}
    patch.custom_fields = { ...curCf, ...m.custom_fields }
  }

  if (Object.keys(patch).length === 0) return null
  const { error } = await supabase.from('contacts').update(patch).eq('id', existingId)
  return error ? error.message : null
}

async function main() {
  loadEnv()
  const args = parseArgs(process.argv.slice(2))

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local')
  if (!process.env.ENCRYPTION_SECRET) throw new Error('Missing ENCRYPTION_SECRET in .env.local')

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })

  const orgId = await resolveOrgId(supabase, args)
  log(args.dryRun ? 'Mode: DRY RUN (no writes)' : 'Mode: LIVE (writing contacts)')

  // Baseline count
  const { count: baseline } = await supabase
    .from('contacts')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
  log(`Baseline contacts in org: ${baseline ?? '?'}`)

  const creds = await getGhlCredentialsForOrg(orgId, supabase)
  if (!creds) throw new Error('No active GoHighLevel integration for this org')
  log(`GHL location: ${creds.locationId}`)

  const cfMap = await getGhlCustomFieldKeyMap(creds)
  log(`Custom-field definitions: ${Object.keys(cfMap).length}`)

  // Fetch all contacts (streamed page logging).
  log('Fetching contacts from GHL…')
  const ghlContacts = await listAllGhlContacts(creds, {
    maxPages: args.maxPages,
    pageDelayMs: PAGE_DELAY_MS,
    onPage: (batch, page, total) =>
      log(`  page ${page + 1}: +${batch.length} (total reported by GHL: ${total ?? '?'})`),
  })
  log(`Fetched ${ghlContacts.length} GHL contacts.`)

  // Map all, then drop rows with neither phone nor email (cannot dedup/identify).
  const mapped = ghlContacts.map((c) => mapGhlContact(c, cfMap))
  const usable = mapped.filter((m) => m.phone || m.email)
  const unusable = mapped.length - usable.length
  if (unusable > 0) log(`Skipping ${unusable} contacts with no usable phone/email.`)

  const counters: Counters = { inserted: 0, updated: 0, skipped: 0, errors: 0 }
  const sampleErrors: string[] = []

  for (let start = 0; start < usable.length; start += CHUNK_SIZE) {
    const chunk = usable.slice(start, start + CHUNK_SIZE)
    const phones = [...new Set(chunk.map((m) => m.phone).filter(Boolean) as string[])]
    const emails = [...new Set(chunk.map((m) => m.email).filter(Boolean) as string[])]
    const existing = await loadExisting(supabase, orgId, phones, emails)

    // Track values already consumed by inserts in THIS chunk so two new GHL rows
    // sharing a phone/email don't both insert and violate the unique index.
    const insertedPhones = new Set<string>()
    const insertedEmails = new Set<string>()

    const toInsert: ReturnType<typeof buildInsertRow>[] = []

    for (const m of chunk) {
      const existingId =
        (m.phone ? existing.byPhone.get(m.phone) : undefined) ??
        (m.email ? existing.byEmail.get(m.email) : undefined)

      if (existingId) {
        // update_existing
        if (args.dryRun) { counters.updated++; continue }
        const err = await applyUpdate(supabase, existingId, m, existing)
        if (err) {
          counters.errors++
          if (sampleErrors.length < 10) sampleErrors.push(`update ${existingId}: ${err}`)
        } else {
          counters.updated++
        }
        continue
      }

      // New contact — guard against intra-batch duplicates.
      const dupInBatch =
        (m.phone && insertedPhones.has(m.phone)) || (m.email && insertedEmails.has(m.email))
      if (dupInBatch) { counters.skipped++; continue }
      if (m.phone) insertedPhones.add(m.phone)
      if (m.email) insertedEmails.add(m.email)

      if (args.dryRun) { counters.inserted++; continue }
      toInsert.push(buildInsertRow(orgId, m))
    }

    if (!args.dryRun && toInsert.length > 0) {
      const { data, error } = await supabase.from('contacts').insert(toInsert).select('id')
      if (error) {
        // Fall back to per-row inserts so one bad row doesn't sink the batch.
        for (const row of toInsert) {
          const { error: rowErr } = await supabase.from('contacts').insert(row)
          if (rowErr) {
            counters.errors++
            if (sampleErrors.length < 10) sampleErrors.push(`insert ${row.external_id}: ${rowErr.message}`)
          } else {
            counters.inserted++
          }
        }
      } else {
        counters.inserted += data?.length ?? toInsert.length
      }
    }

    log(`  processed ${Math.min(start + CHUNK_SIZE, usable.length)}/${usable.length}  ` +
      `(ins ${counters.inserted}, upd ${counters.updated}, skip ${counters.skipped}, err ${counters.errors})`)
  }

  log('──────────────────────────────────────────')
  log(`${args.dryRun ? 'DRY RUN' : 'DONE'} — inserted ${counters.inserted}, updated ${counters.updated}, ` +
    `skipped ${counters.skipped}, errors ${counters.errors}`)
  if (sampleErrors.length > 0) {
    log('Sample errors:')
    for (const e of sampleErrors) log(`  - ${e}`)
  }

  if (!args.dryRun) {
    const { count: after } = await supabase
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
    log(`Contacts in org now: ${after ?? '?'} (was ${baseline ?? '?'})`)
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
