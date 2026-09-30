// scripts/backfill-prospect-city.ts
//
// Item 5, 2026-09-30. Measured: `custom_fields.city` (what the `prospect_rows`
// view, migration 1247, reads — there is no dedicated `city` column) is NULL
// on all 1044 existing prospect_rows even though the full street address is
// present in `custom_fields.address` (e.g. "…Tremont St, Boston, MA 02116").
// The ingestion route (src/app/api/v1/prospects/route.ts) now derives
// city/state for NEW rows going forward (see
// src/lib/prospects/location-from-address.ts) — this script backfills the
// existing ones with the exact same derivation logic, so a row that was
// already correct before this fix and a row this script fixes both got
// there the same way.
//
// Idempotent: only ever touches a row whose custom_fields.city is currently
// empty/absent AND whose custom_fields.address/location parses to a city —
// a rerun finds nothing left to do on rows it already fixed. Never
// overwrites an existing non-empty city.
//
// Scope: `contacts` + `accounts` where lifecycle_stage = 'prospect' (the two
// tables prospect_rows unions) across every org unless --org/--org-id
// narrows it — the 1044 measured NULLs are counted platform-wide, not per
// tenant.
//
// Usage:
//   npx tsx scripts/backfill-prospect-city.ts --dry-run              # count only, no writes
//   npx tsx scripts/backfill-prospect-city.ts --dry-run --org "Skale Club"
//   npx tsx scripts/backfill-prospect-city.ts                        # live run, every org
//
// DO NOT run this against production without the owner's go-ahead — see
// CLAUDE.md's "Never point a local server at the production DATABASE_URL"
// caution; the same applies to any script reading .env.local's Supabase keys.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { deriveLocationFromAddress } from '@/lib/prospects/location-from-address'

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

function parseArgs(argv: string[]) {
  const args: { org?: string; orgId?: string; dryRun: boolean } = { dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') args.dryRun = true
    else if (a === '--org') args.org = argv[++i]
    else if (a === '--org-id') args.orgId = argv[++i]
  }
  return args
}

const PAGE = 1000

function log(msg: string) {
  process.stdout.write(`${new Date().toISOString()}  ${msg}\n`)
}

async function resolveOrgId(supabase: SupabaseClient, args: ReturnType<typeof parseArgs>): Promise<string | null> {
  if (args.orgId) return args.orgId
  if (!args.org) return null
  const { data, error } = await supabase.from('organizations').select('id, name').ilike('name', args.org).single()
  if (error || !data) throw new Error(`Org not found "${args.org}": ${error?.message ?? 'no row'}`)
  log(`Org: ${data.name} (${data.id})`)
  return data.id as string
}

type Row = { id: string; custom_fields: Record<string, unknown> | null }

/** Reads whether a row's custom_fields already has a non-empty city. */
function hasCity(customFields: Record<string, unknown> | null): boolean {
  return typeof customFields?.city === 'string' && customFields.city.trim().length > 0
}

/** custom_fields.address, falling back to .location — same source order
 *  withDerivedLocation() (the live ingestion path) uses. */
function addressSource(customFields: Record<string, unknown> | null): string | null {
  const address = typeof customFields?.address === 'string' ? customFields.address.trim() : ''
  if (address) return address
  const location = typeof customFields?.location === 'string' ? customFields.location.trim() : ''
  return location || null
}

async function backfillTable(
  supabase: SupabaseClient,
  table: 'contacts' | 'accounts',
  orgId: string | null,
  dryRun: boolean,
): Promise<{ scanned: number; fixed: number; noAddress: number }> {
  let scanned = 0
  let fixed = 0
  let noAddress = 0
  // Keyset pagination (id > last seen id), NOT offset pagination. The filter below selects rows
  // WITHOUT a city, and live mode fills cities in as it goes — so fixed rows drop out of the set
  // being paged. With `.range(from, from + PAGE - 1)` and `from += PAGE`, page 2 would start PAGE
  // rows into a set that already shrank, silently skipping rows (caught on review, 2026-09-30:
  // dry-run can't show it because it writes nothing). Walking by id is immune to the set changing.
  let lastId: string | null = null
  for (;;) {
    let query = supabase
      .from(table)
      .select('id, custom_fields')
      .eq('lifecycle_stage', 'prospect')
      // NULL/absent city, narrowed server-side so we don't page through
      // every already-fixed prospect on every run.
      .is('custom_fields->city', null)
      .order('id', { ascending: true })
      .limit(PAGE)
    if (lastId) query = query.gt('id', lastId)
    if (orgId) query = query.eq('org_id', orgId)
    const { data, error } = await query
    if (error) throw new Error(`${table} read failed: ${error.message}`)
    if (!data || data.length === 0) break

    const patches: Array<{ id: string; custom_fields: Record<string, unknown> }> = []
    for (const row of data as Row[]) {
      scanned++
      // Idempotency guard even though the query above already filters on a
      // NULL/absent JSON key — `->city` being SQL NULL also matches an
      // empty-string city, so re-check with the same non-empty rule the live
      // path uses before deriving anything.
      if (hasCity(row.custom_fields)) continue
      const source = addressSource(row.custom_fields)
      if (!source) {
        noAddress++
        continue
      }
      const { city, state } = deriveLocationFromAddress(source)
      if (!city) {
        noAddress++
        continue
      }
      const cf = row.custom_fields ?? {}
      patches.push({
        id: row.id,
        custom_fields: { ...cf, city, ...(state && !cf.state ? { state } : {}) },
      })
    }

    if (!dryRun && patches.length > 0) {
      for (const patch of patches) {
        const { error: updateError } = await supabase
          .from(table)
          .update({ custom_fields: patch.custom_fields, updated_at: new Date().toISOString() })
          .eq('id', patch.id)
        if (updateError) throw new Error(`${table} update failed for ${patch.id}: ${updateError.message}`)
      }
    }
    fixed += patches.length
    log(`  ${table}: scanned ${scanned}, fixed ${fixed} so far (this page: ${data.length} rows)`)

    lastId = (data as Row[])[data.length - 1].id
    if (data.length < PAGE) break
  }
  return { scanned, fixed, noAddress }
}

async function main() {
  loadEnv()
  const args = parseArgs(process.argv.slice(2))
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })

  const orgId = await resolveOrgId(supabase, args)
  log(args.dryRun ? 'Mode: DRY RUN (no writes)' : 'Mode: LIVE')
  log(orgId ? `Scope: org ${orgId}` : 'Scope: every org')

  const contactsResult = await backfillTable(supabase, 'contacts', orgId, args.dryRun)
  const accountsResult = await backfillTable(supabase, 'accounts', orgId, args.dryRun)

  log('──────────────────────────────────────────')
  log(
    `contacts: scanned ${contactsResult.scanned} without a city, ${args.dryRun ? 'would fix' : 'fixed'} ${contactsResult.fixed}, ${contactsResult.noAddress} had no address/location to derive from`,
  )
  log(
    `accounts: scanned ${accountsResult.scanned} without a city, ${args.dryRun ? 'would fix' : 'fixed'} ${accountsResult.fixed}, ${accountsResult.noAddress} had no address/location to derive from`,
  )
  log(`TOTAL ${args.dryRun ? 'would fix' : 'fixed'}: ${contactsResult.fixed + accountsResult.fixed}`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
