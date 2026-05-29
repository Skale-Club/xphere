// scripts/titlecase-contact-names.ts
// One-off: normalises contact name casing to Title Case (with exceptions),
// scoped to one org, over the REST API (service-role). The bulk imports
// (GHL migration + CSV) stored names exactly as the source had them — often
// fully lowercase (e.g. "aaron jaeger") — and nothing in the app re-cases the
// name on display, so they render lowercase. This rewrites first_name,
// last_name and name in place.
//
// Casing rules (Title Case WITH exceptions):
//   - Tokens that already have MIXED case (e.g. "McDonald", "iPhone",
//     "DeSouza") are left untouched — assumed intentional. Only all-lower or
//     all-upper tokens are normalised.
//   - Particles ("de", "da", "von", "van", "of"…) stay lowercase unless first.
//   - "Mc" prefix → "McDonald"; apostrophes → "O'Brien"; hyphens →
//     "Jean-Pierre"; roman numerals (ii, iii, iv…) → uppercase.
//   - Acronyms (e.g. "IBM") are NOT detectable in a free-text name field and
//     become "Ibm" — accepted tradeoff.
//
// Idempotent: re-running only rewrites rows whose normalised value differs.
//
// Usage:
//   npx tsx scripts/titlecase-contact-names.ts --org "Skale Club" [--dry-run]

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

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

// ── Casing engine ────────────────────────────────────────────────────────────

// Lowercased mid-name particles (kept lowercase unless they are the first word).
const PARTICLES = new Set([
  'de', 'da', 'do', 'das', 'dos', 'di', 'du', 'del', 'della', 'dello',
  'von', 'van', 'der', 'den', 'ter', 'la', 'le', 'el', 'lo', 'li',
  'e', 'y', 'of', 'the', 'bin', 'al',
])

// Roman numerals worth uppercasing as suffixes. Single letters (i, v, x) are
// excluded on purpose so middle initials are not mangled.
const ROMAN = new Set(['ii', 'iii', 'iv', 'vi', 'vii', 'viii', 'ix', 'xi', 'xii', 'xiii'])

function cap(s: string): string {
  if (!s) return s
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function hasMixedCase(token: string): boolean {
  const hasUpper = token !== token.toLowerCase()
  const hasLower = token !== token.toUpperCase()
  return hasUpper && hasLower
}

// Title-cases a single, already-lowercased word, applying Mc / apostrophe /
// hyphen rules.
function titleCaseWord(lower: string): string {
  if (lower.includes('-')) {
    return lower.split('-').map(titleCaseWord).join('-')
  }
  if (lower.includes("'") || lower.includes('’')) {
    const sep = lower.includes('’') ? '’' : "'"
    // Capitalise the first segment and any segment of length >= 2 ("O'Brien",
    // "D'Angelo"); leave a trailing single char lowercase so the possessive
    // "papa's" stays "Papa's" instead of "Papa'S".
    return lower.split(sep).map((p, i) => (i === 0 || p.length >= 2 ? cap(p) : p)).join(sep)
  }
  if (/^mc[a-zà-ÿ].+/.test(lower)) {
    return 'Mc' + cap(lower.slice(2))
  }
  return cap(lower)
}

// Decides the canonical casing for one whitespace-separated token at `index`.
function processToken(token: string, index: number): string {
  if (hasMixedCase(token)) return token // intentional casing — leave it
  const lower = token.toLowerCase()
  if (ROMAN.has(lower)) return lower.toUpperCase()
  if (index > 0 && PARTICLES.has(lower)) return lower
  return titleCaseWord(lower)
}

// Returns the normalised name, or the original value unchanged when there is
// nothing to do (null/empty preserved as-is).
// `startIndex` lets a continuation field (last_name, when first_name is
// present) be treated as mid-name so a leading particle ("de Paula") stays
// lowercase instead of being capitalised as the first word.
export function normaliseNameCasing(value: string | null | undefined, startIndex = 0): string | null {
  if (value == null) return value ?? null
  const trimmed = value.replace(/\s+/g, ' ').trim()
  if (!trimmed) return value // keep original (could be "" vs null)
  const out = trimmed.split(' ').map((tok, i) => processToken(tok, startIndex + i)).join(' ')
  return out
}

// ── Org resolution ───────────────────────────────────────────────────────────

const PAGE = 1000
function log(msg: string) {
  process.stdout.write(`${new Date().toISOString()}  ${msg}\n`)
}

async function resolveOrgId(supabase: SupabaseClient, args: ReturnType<typeof parseArgs>): Promise<string> {
  if (args.orgId) return args.orgId
  if (!args.org) throw new Error('Provide --org "<name>" or --org-id <uuid>')
  const { data, error } = await supabase.from('organizations').select('id, name').ilike('name', args.org).single()
  if (error || !data) throw new Error(`Org not found "${args.org}": ${error?.message ?? 'no row'}`)
  log(`Org: ${data.name} (${data.id})`)
  return data.id as string
}

interface ContactRow {
  id: string
  first_name: string | null
  last_name: string | null
  name: string | null
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

  // ── Read every contact's name fields (paged) ───────────────────────────────
  const updates: Array<{ row: ContactRow; patch: Partial<ContactRow> }> = []
  let scanned = 0
  let from = 0
  for (;;) {
    const { data, error } = await supabase
      .from('contacts')
      .select('id, first_name, last_name, name')
      .eq('org_id', orgId)
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`contacts read failed: ${error.message}`)
    if (!data || data.length === 0) break
    for (const c of data as ContactRow[]) {
      scanned++
      const firstHasTokens = Boolean(c.first_name && c.first_name.trim())
      const nf = normaliseNameCasing(c.first_name, 0)
      const nl = normaliseNameCasing(c.last_name, firstHasTokens ? 1 : 0)
      const nn = normaliseNameCasing(c.name, 0)
      const patch: Partial<ContactRow> = {}
      if (nf !== c.first_name) patch.first_name = nf
      if (nl !== c.last_name) patch.last_name = nl
      if (nn !== c.name) patch.name = nn
      if (Object.keys(patch).length > 0) updates.push({ row: c, patch })
    }
    if (data.length < PAGE) break
    from += PAGE
  }
  log(`Scanned ${scanned} contacts  |  would change ${updates.length}`)

  if (args.dryRun) {
    const sample = updates.slice(0, 25)
    for (const { row, patch } of sample) {
      const before = [row.first_name, row.last_name].filter(Boolean).join(' ') || row.name || '(unnamed)'
      const afterFirst = 'first_name' in patch ? patch.first_name : row.first_name
      const afterLast = 'last_name' in patch ? patch.last_name : row.last_name
      const afterName = 'name' in patch ? patch.name : row.name
      const after = [afterFirst, afterLast].filter(Boolean).join(' ') || afterName || '(unnamed)'
      log(`  "${before}"  →  "${after}"`)
    }
    if (updates.length > sample.length) log(`  … and ${updates.length - sample.length} more`)
    log(`DRY RUN — no writes performed`)
    return
  }

  // ── Apply updates (small parallel batches) ──────────────────────────────────
  const BATCH = 25
  let done = 0
  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH)
    const results = await Promise.all(
      batch.map(({ row, patch }) =>
        supabase.from('contacts').update(patch).eq('id', row.id).then((r) => r.error),
      ),
    )
    const failed = results.filter(Boolean)
    if (failed.length > 0) throw new Error(`update failed for ${failed.length} rows: ${failed[0]!.message}`)
    done += batch.length
    log(`  updated ${done}/${updates.length}`)
  }

  log('──────────────────────────────────────────')
  log(`DONE — ${done} contacts re-cased`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
