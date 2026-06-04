// scripts/migrate-ghl-businesses.ts
// One-off migration: pulls GoHighLevel businesses for an org into Xphere's
// `accounts` table. Idempotent: matches existing accounts by GHL external_id,
// normalized domain, then lower(name). Optionally links imported contacts whose
// GHL contact row has businessId.
//
// Usage:
//   npx tsx scripts/migrate-ghl-businesses.ts --org "Skale Club" [--dry-run]
//   npx tsx scripts/migrate-ghl-businesses.ts --org-id <uuid> [--dry-run]

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { normaliseDomain } from '@/lib/accounts'
import { getGhlCredentialsForOrg } from '@/lib/ghl/credentials'
import { listAllGhlBusinesses } from '@/lib/ghl/list-businesses'
import { mapGhlBusiness, type MappedGhlBusiness } from '@/lib/ghl/map-business-to-xphere'
import { listAllGhlContacts, type GhlContact } from '@/lib/ghl/list-contacts'

function loadEnv() {
  const text = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const key = t.slice(0, eq).trim()
    let value = t.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

function parseArgs(argv: string[]) {
  const args: {
    org?: string
    orgId?: string
    dryRun: boolean
    maxPages?: number
    skipContactLink: boolean
  } = { dryRun: false, skipContactLink: false }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--dry-run') args.dryRun = true
    else if (arg === '--org') args.org = argv[++i]
    else if (arg === '--org-id') args.orgId = argv[++i]
    else if (arg === '--max-pages') args.maxPages = Number(argv[++i])
    else if (arg === '--skip-contact-link') args.skipContactLink = true
  }

  return args
}

type AccountRow = {
  id: string
  name: string
  domain: string | null
  website: string | null
  address: string | null
  external_id: string | null
  source: string
  custom_fields: Record<string, unknown> | null
}

type Counters = {
  inserted: number
  updated: number
  skipped: number
  errors: number
  linkedContacts: number
}

const CHUNK_SIZE = 200
const PAGE_DELAY_MS = 250

function log(message: string) {
  process.stdout.write(`${new Date().toISOString()}  ${message}\n`)
}

function nameKey(name: string) {
  return name.trim().toLowerCase()
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return `{${Object.keys(obj)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
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

async function loadExistingAccounts(supabase: SupabaseClient, orgId: string) {
  const rows: AccountRow[] = []
  for (let start = 0; ; start += CHUNK_SIZE) {
    const { data, error } = await supabase
      .from('accounts')
      .select('id, name, domain, website, address, external_id, source, custom_fields')
      .eq('org_id', orgId)
      .order('id', { ascending: true })
      .range(start, start + CHUNK_SIZE - 1)

    if (error) throw error
    rows.push(...((data ?? []) as AccountRow[]))
    if (!data || data.length < CHUNK_SIZE) break
  }

  const byExternalId = new Map<string, AccountRow>()
  const byDomain = new Map<string, AccountRow>()
  const byName = new Map<string, AccountRow>()

  for (const row of rows) {
    if (row.external_id) byExternalId.set(row.external_id, row)
    const domain = normaliseDomain(row.domain)
    if (domain && !byDomain.has(domain)) byDomain.set(domain, row)
    const key = nameKey(row.name)
    if (key && !byName.has(key)) byName.set(key, row)
  }

  return { rows, byExternalId, byDomain, byName }
}

function findExisting(
  mapped: MappedGhlBusiness,
  existing: Awaited<ReturnType<typeof loadExistingAccounts>>,
): AccountRow | null {
  const byId = existing.byExternalId.get(mapped.external_id)
  if (byId) return byId

  const byDomain = mapped.domain ? existing.byDomain.get(mapped.domain) : undefined
  if (byDomain) return byDomain

  return existing.byName.get(nameKey(mapped.name)) ?? null
}

function buildPatch(existing: AccountRow, mapped: MappedGhlBusiness) {
  const customFields =
    existing.custom_fields && typeof existing.custom_fields === 'object'
      ? existing.custom_fields
      : {}

  const patch: Record<string, unknown> = {
    custom_fields: { ...customFields, ...mapped.custom_fields },
  }

  if (!existing.external_id) patch.external_id = mapped.external_id
  if (!existing.domain && mapped.domain) patch.domain = mapped.domain
  if (!existing.website && mapped.website) patch.website = mapped.website
  if (!existing.address && mapped.address) patch.address = mapped.address
  if (existing.source === 'auto_from_contact_company') patch.source = 'ghl_sync'

  return patch
}

async function insertAccounts(
  supabase: SupabaseClient,
  orgId: string,
  rows: MappedGhlBusiness[],
): Promise<AccountRow[]> {
  const inserted: AccountRow[] = []

  for (let start = 0; start < rows.length; start += CHUNK_SIZE) {
    const chunk = rows.slice(start, start + CHUNK_SIZE)
    const { data, error } = await supabase
      .from('accounts')
      .insert(chunk.map((row) => ({
        org_id: orgId,
        name: row.name,
        domain: row.domain,
        website: row.website,
        address: row.address,
        external_id: row.external_id,
        source: 'ghl_sync',
        custom_fields: row.custom_fields,
      })))
      .select('id, name, domain, website, address, external_id, source, custom_fields')

    if (error) throw error
    inserted.push(...((data ?? []) as AccountRow[]))
  }

  return inserted
}

async function linkContactsToAccounts(
  supabase: SupabaseClient,
  orgId: string,
  contacts: GhlContact[],
  accountByBusinessId: Map<string, AccountRow>,
  dryRun: boolean,
): Promise<number> {
  let linked = 0

  for (const contact of contacts) {
    const businessId = (contact as GhlContact & { businessId?: string | null }).businessId
    if (!contact.id || !businessId) continue

    const account = accountByBusinessId.get(businessId)
    if (!account) continue

    linked++
    if (dryRun) continue

    const { error } = await supabase
      .from('contacts')
      .update({ account_id: account.id, company: account.name })
      .eq('org_id', orgId)
      .eq('external_id', contact.id)
      .is('account_id', null)

    if (error) throw error
  }

  return linked
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

  log(args.dryRun ? 'Mode: DRY RUN (no writes)' : 'Mode: LIVE (writing accounts)')

  const { count: baseline } = await supabase
    .from('accounts')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
  log(`Baseline companies in org: ${baseline ?? '?'}`)

  const credentials = await getGhlCredentialsForOrg(orgId, supabase)
  if (!credentials) throw new Error('No active GoHighLevel integration for this org')
  log(`GHL location: ${credentials.locationId}`)

  log('Fetching businesses from GHL...')
  const businesses = await listAllGhlBusinesses(credentials, {
    maxPages: args.maxPages,
    pageDelayMs: PAGE_DELAY_MS,
    onPage: (batch, page) => log(`  page ${page + 1}: +${batch.length}`),
  })

  const mapped = businesses
    .map((business) => mapGhlBusiness(business))
    .filter((business): business is MappedGhlBusiness => business !== null)

  log(`Fetched ${businesses.length} GHL businesses; ${mapped.length} usable.`)

  const existing = await loadExistingAccounts(supabase, orgId)
  const counters: Counters = { inserted: 0, updated: 0, skipped: 0, errors: 0, linkedContacts: 0 }
  const sampleErrors: string[] = []
  const toInsert: MappedGhlBusiness[] = []
  const accountByBusinessId = new Map<string, AccountRow>()

  for (const row of mapped) {
    const found = findExisting(row, existing)
    if (!found) {
      toInsert.push(row)
      continue
    }

    accountByBusinessId.set(row.external_id, found)
    const patch = buildPatch(found, row)
    const meaningfulPatch = Object.keys(patch).some((key) => key !== 'custom_fields') ||
      stableStringify(patch.custom_fields) !== stableStringify(found.custom_fields ?? {})

    if (!meaningfulPatch) {
      counters.skipped++
      continue
    }

    if (args.dryRun) {
      counters.updated++
      continue
    }

    const { data, error } = await supabase
      .from('accounts')
      .update(patch)
      .eq('id', found.id)
      .select('id, name, domain, website, address, external_id, source, custom_fields')
      .single()

    if (error) {
      counters.errors++
      if (sampleErrors.length < 10) sampleErrors.push(`update ${found.id}: ${error.message}`)
      continue
    }

    counters.updated++
    accountByBusinessId.set(row.external_id, data as AccountRow)
  }

  if (args.dryRun) {
    counters.inserted = toInsert.length
  } else if (toInsert.length > 0) {
    const inserted = await insertAccounts(supabase, orgId, toInsert)
    counters.inserted = inserted.length
    for (const row of inserted) {
      if (row.external_id) accountByBusinessId.set(row.external_id, row)
    }
  }

  if (!args.skipContactLink) {
    log('Checking GHL contacts for business links...')
    const contacts = await listAllGhlContacts(credentials, { pageDelayMs: PAGE_DELAY_MS })
    counters.linkedContacts = await linkContactsToAccounts(
      supabase,
      orgId,
      contacts,
      accountByBusinessId,
      args.dryRun,
    )
  }

  const { count: finalCount } = await supabase
    .from('accounts')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)

  log(`Summary: inserted=${counters.inserted}, updated=${counters.updated}, skipped=${counters.skipped}, linked_contacts=${counters.linkedContacts}, errors=${counters.errors}`)
  if (sampleErrors.length > 0) log(`Sample errors: ${sampleErrors.join(' | ')}`)
  log(`Final companies in org: ${finalCount ?? '?'}${args.dryRun ? ' (dry-run, unchanged)' : ''}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
