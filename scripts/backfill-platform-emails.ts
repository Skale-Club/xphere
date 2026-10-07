// scripts/backfill-platform-emails.ts
//
// 2026-10-07. Measured in production: 40 of 6,388 `accounts` rows (0 contacts) carry the support
// address of a booking platform as the business's own email — `help.us@booksy.com` alone is on 38
// of them, plus `safeguarding@vagaro.com` and `privacy@pocketsuite.io`. 12 of the 40 had
// email_status='ok': MillionVerifier credits were spent and they looked valid to the Hermes agent.
// The rule now lives in src/lib/prospects/platform-emails.ts (isPlatformEmail) and is enforced on
// every verification / import / enrol path; this script applies it to the rows that already exist.
//
// For every account/contact whose email isPlatformEmail it sets:
//   email_status                = 'invalid'
//   email_verification_provider = 'platform_rule'
//   email_risk                  = 'high'
// and records what was there before in custom_fields.previous_email_status (plus
// previous_email_verification_provider / previous_email_risk), so the change is reversible.
// It does NOT clear the email and does NOT touch xmail_imported_at or email_verified_at.
//
// Accounts have no `email` column: the address lives in custom_fields.email (same as
// emailFromCustomFields in src/lib/mcp/tools/prospects.ts). Contacts use the `email` column.
//
// Idempotent: a row already carrying provider 'platform_rule' is skipped, so a rerun finds nothing
// left and never overwrites the stored previous_email_status.
//
// DRY RUN BY DEFAULT. Nothing is written unless --apply is passed.
//
// Usage (the env file lives in the main worktree):
//   npx tsx --env-file=../xphere/.env.local scripts/backfill-platform-emails.ts                # dry run
//   npx tsx --env-file=../xphere/.env.local scripts/backfill-platform-emails.ts --org "Skale Club"
//   npx tsx --env-file=../xphere/.env.local scripts/backfill-platform-emails.ts --apply        # writes
//
// DO NOT run with --apply without the owner's go-ahead — it writes to whatever database the env
// file points at (see CLAUDE.md's caution about pointing local tooling at production).

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { isPlatformEmail } from '@/lib/prospects/platform-emails'

/** Loads ./.env.local when present; with --env-file the variables are already in process.env. */
function loadEnv() {
  const file = resolve(process.cwd(), '.env.local')
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split('\n')) {
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
  const args: { org?: string; orgId?: string; apply: boolean } = { apply: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--apply') args.apply = true
    else if (a === '--org') args.org = argv[++i]
    else if (a === '--org-id') args.orgId = argv[++i]
  }
  return args
}

const PAGE = 1000
type Table = 'contacts' | 'accounts'

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

type Row = {
  id: string
  email?: string | null
  custom_fields: Record<string, unknown> | null
  email_status: string | null
  email_verification_provider: string | null
  email_risk: string | null
}

/** contacts.email, or custom_fields.email for accounts (which have no email column). */
function emailOf(table: Table, row: Row): string | null {
  if (table === 'contacts') return typeof row.email === 'string' && row.email.trim() ? row.email.trim() : null
  const e = row.custom_fields?.email
  return typeof e === 'string' && e.includes('@') ? e.trim() : null
}

type Tally = {
  scanned: number
  platform: number
  alreadyDone: number
  toChange: number
  byEmail: Map<string, number>
  byPreviousStatus: Map<string, number>
}

function bump(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1)
}

async function backfillTable(supabase: SupabaseClient, table: Table, orgId: string | null, apply: boolean): Promise<Tally> {
  const tally: Tally = { scanned: 0, platform: 0, alreadyDone: 0, toChange: 0, byEmail: new Map(), byPreviousStatus: new Map() }
  const select =
    table === 'contacts'
      ? 'id, email, custom_fields, email_status, email_verification_provider, email_risk'
      : 'id, custom_fields, email_status, email_verification_provider, email_risk'

  // Keyset pagination (id > last seen id), NEVER offset: live mode rewrites rows as it goes, and an
  // offset window over a set that changes underneath it silently skips rows (the bug
  // backfill-prospect-city.ts hit and fixed on 2026-09-30). Walking by id is immune to that.
  let lastId: string | null = null
  for (;;) {
    let query = supabase.from(table).select(select).order('id', { ascending: true }).limit(PAGE)
    query = table === 'contacts' ? query.not('email', 'is', null) : query.not('custom_fields->>email', 'is', null)
    if (lastId) query = query.gt('id', lastId)
    if (orgId) query = query.eq('org_id', orgId)
    const { data, error } = await query
    if (error) throw new Error(`${table} read failed: ${error.message}`)
    if (!data || data.length === 0) break

    for (const row of data as unknown as Row[]) {
      tally.scanned++
      const email = emailOf(table, row)
      if (!email || !isPlatformEmail(email)) continue
      tally.platform++
      if (row.email_verification_provider === 'platform_rule') {
        tally.alreadyDone++
        continue
      }
      tally.toChange++
      bump(tally.byEmail, email.toLowerCase())
      bump(tally.byPreviousStatus, row.email_status ?? '(null)')

      if (!apply) continue
      const { error: updateError } = await supabase
        .from(table)
        .update({
          email_status: 'invalid',
          email_verification_provider: 'platform_rule',
          email_risk: 'high',
          custom_fields: {
            ...(row.custom_fields ?? {}),
            previous_email_status: row.email_status ?? null,
            previous_email_verification_provider: row.email_verification_provider ?? null,
            previous_email_risk: row.email_risk ?? null,
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
      if (updateError) throw new Error(`${table} update failed for ${row.id}: ${updateError.message}`)
    }

    log(`  ${table}: scanned ${tally.scanned}, platform ${tally.platform} so far`)
    lastId = (data as unknown as Row[])[data.length - 1].id
    if (data.length < PAGE) break
  }
  return tally
}

function printMap(title: string, map: Map<string, number>) {
  log(title)
  for (const [key, n] of [...map.entries()].sort((a, b) => b[1] - a[1])) log(`    ${String(n).padStart(4)}  ${key}`)
}

async function main() {
  loadEnv()
  const args = parseArgs(process.argv.slice(2))
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })

  const orgId = await resolveOrgId(supabase, args)
  log(args.apply ? 'Mode: APPLY (writes)' : 'Mode: DRY RUN (no writes; pass --apply to write)')
  log(orgId ? `Scope: org ${orgId}` : 'Scope: every org')

  const results: Array<[Table, Tally]> = []
  for (const table of ['contacts', 'accounts'] as const) results.push([table, await backfillTable(supabase, table, orgId, args.apply)])

  log('──────────────────────────────────────────')
  const byEmail = new Map<string, number>()
  const byPreviousStatus = new Map<string, number>()
  let total = 0
  for (const [table, t] of results) {
    log(
      `${table}: scanned ${t.scanned} with an email, ${t.platform} on a platform domain, ${t.alreadyDone} already platform_rule, ` +
        `${args.apply ? 'updated' : 'would update'} ${t.toChange}`,
    )
    total += t.toChange
    for (const [k, n] of t.byEmail) byEmail.set(k, (byEmail.get(k) ?? 0) + n)
    for (const [k, n] of t.byPreviousStatus) byPreviousStatus.set(k, (byPreviousStatus.get(k) ?? 0) + n)
  }
  printMap('By email:', byEmail)
  printMap('By previous email_status:', byPreviousStatus)
  log(`TOTAL ${args.apply ? 'updated' : 'would update'}: ${total}`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
