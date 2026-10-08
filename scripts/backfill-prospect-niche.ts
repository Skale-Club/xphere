// scripts/backfill-prospect-niche.ts
//
// 2026-10-08. Xcraper now stamps a `niche` on every scrape ("barbershop", "nail_salon") and Xphere
// keeps one Meta audience per niche. Prospects scraped BEFORE that carry no niche, so a niche
// audience would start empty. This script tags them from the scrape that found them: the query of
// their prospect source (`prospect_sources.metadata.query`, else the label "<query> — <location>").
//
// Built-in rule: a query containing barber / barbershop / barbearia -> `barbershop`. Anything else
// is NOT guessed: it is counted as unmapped and its queries are listed so you can add a rule with
// --rule "regex=niche".
//
// It also reports how many of the tagged accounts have a Google Maps `category` that does not
// look like a barber, i.e. the neighbours (hair salons, spas...) a barbershop scrape pulled in.
// That is only a report; nothing is excluded.
//
// Which runs an account came from: its `prospect_source_id` (the latest run that touched it) plus
// every `imported` engagement event (all the runs that touched it), so an account found by two
// niche scrapes ends up with both niches. Existing niches are never dropped.
//
// DRY RUN BY DEFAULT: reads, prints the counts and writes nothing. --apply writes
// `custom_fields.niche` / `custom_fields.niches` and then marks the org's enabled Meta audiences
// dirty so the next sync picks the niche members up.
//
// Usage:
//   npx tsx scripts/backfill-prospect-niche.ts                         # dry run, every org
//   npx tsx scripts/backfill-prospect-niche.ts --org "Skale Club"      # dry run, one org
//   npx tsx scripts/backfill-prospect-niche.ts --org "Skale Club" --apply
//   npx tsx scripts/backfill-prospect-niche.ts --rule "nail=nail_salon" --rule "lash=lash_studio"
//
// DO NOT point this at production without the owner's go-ahead (CLAUDE.md: never point a local
// process at the production database by accident); it reads .env.local for the Supabase keys.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { markMetaAudiencesDirty } from '@/lib/meta/audience-dirty'
import { DEFAULT_SCRAPE_SOURCE_TYPES } from '@/lib/meta/audience-source'
import {
  backfilledCustomFields,
  DEFAULT_NICHE_RULES,
  looksLikeBarber,
  nicheForQuery,
  parseNicheRule,
  queryOfSource,
  type NicheRule,
} from '@/lib/prospects/niche-backfill'

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

interface Args {
  org?: string
  orgId?: string
  apply: boolean
  rules: NicheRule[]
}

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, rules: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--apply') args.apply = true
    else if (a === '--dry-run') args.apply = false
    else if (a === '--org') args.org = argv[++i]
    else if (a === '--org-id') args.orgId = argv[++i]
    else if (a === '--rule') args.rules.push(parseNicheRule(argv[++i] ?? ''))
    else throw new Error(`Unknown argument "${a}"`)
  }
  return args
}

const PAGE = 1000
const ID_CHUNK = 100

function log(msg: string) {
  process.stdout.write(`${new Date().toISOString()}  ${msg}\n`)
}

async function resolveOrgId(supabase: SupabaseClient, args: Args): Promise<string | null> {
  if (args.orgId) return args.orgId
  if (!args.org) return null
  const { data, error } = await supabase.from('organizations').select('id, name').ilike('name', args.org).single()
  if (error || !data) throw new Error(`Org not found "${args.org}": ${error?.message ?? 'no row'}`)
  log(`Org: ${data.name} (${data.id})`)
  return data.id as string
}

type SourceRow = { id: string; label: string | null; metadata: unknown }

/** Every scrape source of the scrape types, as id -> query. */
async function loadSourceQueries(supabase: SupabaseClient, orgId: string | null): Promise<Map<string, string | null>> {
  const queries = new Map<string, string | null>()
  let lastId: string | null = null
  for (;;) {
    let query = supabase
      .from('prospect_sources')
      .select('id, label, metadata')
      .in('source_type', [...DEFAULT_SCRAPE_SOURCE_TYPES])
      .order('id', { ascending: true })
      .limit(PAGE)
    if (lastId) query = query.gt('id', lastId)
    if (orgId) query = query.eq('org_id', orgId)
    const { data, error } = await query
    if (error) throw new Error(`prospect_sources read failed: ${error.message}`)
    const rows = (data ?? []) as SourceRow[]
    for (const row of rows) queries.set(row.id, queryOfSource(row))
    if (rows.length < PAGE) break
    lastId = rows[rows.length - 1].id
  }
  return queries
}

/** account id -> source run ids from the `imported` engagement events (all the runs that touched it). */
async function loadImportRuns(supabase: SupabaseClient, accountIds: string[]): Promise<Map<string, Set<string>>> {
  const runs = new Map<string, Set<string>>()
  for (let i = 0; i < accountIds.length; i += ID_CHUNK) {
    const chunk = accountIds.slice(i, i + ID_CHUNK)
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('prospect_engagement_events')
        .select('entity_id, payload')
        .eq('entity_type', 'account')
        .eq('event_type', 'imported')
        .in('entity_id', chunk)
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) throw new Error(`prospect_engagement_events read failed: ${error.message}`)
      const rows = (data ?? []) as Array<{ entity_id: string; payload: unknown }>
      for (const row of rows) {
        const payload = row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
          ? (row.payload as Record<string, unknown>)
          : {}
        const runId = payload.source_run_id
        if (typeof runId !== 'string') continue
        const set = runs.get(row.entity_id) ?? new Set<string>()
        set.add(runId)
        runs.set(row.entity_id, set)
      }
      if (rows.length < PAGE) break
    }
  }
  return runs
}

type AccountRow = {
  id: string
  org_id: string
  prospect_source_id: string | null
  custom_fields: Record<string, unknown> | null
}

async function main() {
  loadEnv()
  const args = parseArgs(process.argv.slice(2))
  const rules = [...args.rules, ...DEFAULT_NICHE_RULES]
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })

  const orgId = await resolveOrgId(supabase, args)
  log(args.apply ? 'Mode: APPLY (writes)' : 'Mode: DRY RUN (no writes; pass --apply to write)')
  log(orgId ? `Scope: org ${orgId}` : 'Scope: every org')
  log(`Rules: ${rules.map((rule) => `/${rule.pattern.source}/i -> ${rule.niche}`).join(', ')}`)

  const sourceQueries = await loadSourceQueries(supabase, orgId)
  log(`Scrape sources read: ${sourceQueries.size}`)

  let scanned = 0
  let tagged = 0
  let alreadyOk = 0
  let unmapped = 0
  let written = 0
  const perNiche = new Map<string, number>()
  const unmappedQueries = new Map<string, number>()
  const categoriesOutsideBarber = new Map<string, number>()
  let barberNicheAccounts = 0
  let barberNicheNotBarber = 0
  const orgsTouched = new Set<string>()

  let lastId: string | null = null
  for (;;) {
    let query = supabase
      .from('accounts')
      .select('id, org_id, prospect_source_id, custom_fields')
      .in('source_type', [...DEFAULT_SCRAPE_SOURCE_TYPES])
      .order('id', { ascending: true })
      .limit(PAGE)
    if (lastId) query = query.gt('id', lastId)
    if (orgId) query = query.eq('org_id', orgId)
    const { data, error } = await query
    if (error) throw new Error(`accounts read failed: ${error.message}`)
    const rows = (data ?? []) as AccountRow[]
    if (rows.length === 0) break

    const importRuns = await loadImportRuns(supabase, rows.map((row) => row.id))
    for (const row of rows) {
      scanned++
      const runIds = new Set<string>(importRuns.get(row.id) ?? [])
      if (row.prospect_source_id) runIds.add(row.prospect_source_id)

      const implied = new Set<string>()
      const queriesSeen: string[] = []
      for (const runId of runIds) {
        const sourceQuery = sourceQueries.get(runId) ?? null
        if (sourceQuery) queriesSeen.push(sourceQuery)
        const niche = nicheForQuery(sourceQuery, rules)
        if (niche) implied.add(niche)
      }

      if (implied.size === 0) {
        unmapped++
        const key = queriesSeen[0] ?? '(no scrape query on record)'
        unmappedQueries.set(key, (unmappedQueries.get(key) ?? 0) + 1)
        continue
      }

      for (const niche of implied) perNiche.set(niche, (perNiche.get(niche) ?? 0) + 1)
      if (implied.has('barbershop')) {
        barberNicheAccounts++
        const category = row.custom_fields?.category
        if (!looksLikeBarber(category)) {
          barberNicheNotBarber++
          const key = typeof category === 'string' && category.trim() ? category.trim() : '(no category)'
          categoriesOutsideBarber.set(key, (categoriesOutsideBarber.get(key) ?? 0) + 1)
        }
      }

      const next = backfilledCustomFields(row.custom_fields, [...implied])
      if (!next) {
        alreadyOk++
        continue
      }
      tagged++
      if (args.apply) {
        const { error: updateError } = await supabase
          .from('accounts')
          .update({ custom_fields: next })
          .eq('id', row.id)
          .eq('org_id', row.org_id)
        if (updateError) throw new Error(`accounts update failed for ${row.id}: ${updateError.message}`)
        written++
        orgsTouched.add(row.org_id)
      }
    }

    log(`  accounts scanned ${scanned} so far`)
    lastId = rows[rows.length - 1].id
    if (rows.length < PAGE) break
  }

  if (args.apply) {
    for (const touchedOrg of orgsTouched) {
      const { marked } = await markMetaAudiencesDirty(supabase as never, { orgId: touchedOrg, reason: 'niche_backfill' })
      log(`Org ${touchedOrg}: ${marked} enabled Meta audience(s) marked dirty`)
    }
  }

  log('──────────────────────────────────────────')
  log(`Xcraper accounts scanned: ${scanned}`)
  log(`Niche resolved from a scrape query: ${scanned - unmapped}  (${args.apply ? 'written' : 'would be written'}: ${args.apply ? written : tagged}; already tagged: ${alreadyOk})`)
  log(`No niche rule matched (left untouched): ${unmapped}`)
  log('Accounts per niche (an account found by two niche scrapes counts in both):')
  for (const [niche, count] of [...perNiche.entries()].sort((a, b) => b[1] - a[1])) log(`  ${niche}: ${count}`)
  if (barberNicheAccounts > 0) {
    log(`Barbershop niche: ${barberNicheAccounts} accounts, ${barberNicheNotBarber} with a Google category that does not look like a barber (neighbours the scrape pulled in):`)
    for (const [category, count] of [...categoriesOutsideBarber.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
      log(`  ${category}: ${count}`)
    }
  }
  if (unmappedQueries.size > 0) {
    log('Queries with no rule (add one with --rule "regex=niche"):')
    for (const [q, count] of [...unmappedQueries.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) log(`  ${q}: ${count}`)
  }
  if (!args.apply) log('DRY RUN: nothing was written. Re-run with --apply to write.')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
