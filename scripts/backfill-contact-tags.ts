// scripts/backfill-contact-tags.ts
// Backfills the entity-based tag system (tags registry + contact_tags junction)
// from the legacy contacts.tags text[] array, scoped to one org. Mirrors
// migration 061 but runs over the REST API (service-role) so it can target the
// correct project and be re-run safely.
//
// Why: bulk imports (CSV worker + GHL migration) only write contacts.tags[],
// which the Settings → Tags page does not read. This registers each distinct
// tag and links it to its contacts so it shows up and gets usage counts.
//
// Idempotent: tags upsert ignores (org_id, slug) conflicts; contact_tags upsert
// ignores (contact_id, tag_id) conflicts.
//
// Usage:
//   npx tsx scripts/backfill-contact-tags.ts --org "Skale Club" [--dry-run]

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

// Matches the app's toSlug (settings/tags/actions.ts) so slugs collide with
// any tags created via the UI, and satisfies the slug CHECK (^[a-z0-9][a-z0-9-]*$).
function toSlug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

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

async function main() {
  loadEnv()
  const args = parseArgs(process.argv.slice(2))
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })

  const orgId = await resolveOrgId(supabase, args)
  log(args.dryRun ? 'Mode: DRY RUN (no writes)' : 'Mode: LIVE')

  // ── 1. Read every contact's tags (paged) ────────────────────────────────────
  const slugToName = new Map<string, string>()           // slug → display name (first wins)
  const contactSlugs: Array<{ contactId: string; slugs: string[] }> = []
  let from = 0
  for (;;) {
    const { data, error } = await supabase
      .from('contacts')
      .select('id, tags')
      .eq('org_id', orgId)
      .not('tags', 'eq', '{}')
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`contacts read failed: ${error.message}`)
    if (!data || data.length === 0) break
    for (const c of data) {
      const tags: string[] = Array.isArray(c.tags) ? c.tags : []
      const slugs: string[] = []
      for (const raw of tags) {
        if (typeof raw !== 'string') continue
        const name = raw.trim()
        if (!name) continue
        const slug = toSlug(name)
        if (!slug) continue
        if (!slugToName.has(slug)) slugToName.set(slug, name)
        if (!slugs.includes(slug)) slugs.push(slug)
      }
      if (slugs.length > 0) contactSlugs.push({ contactId: c.id, slugs })
    }
    if (data.length < PAGE) break
    from += PAGE
  }
  log(`Contacts with tags: ${contactSlugs.length}  |  distinct tags: ${slugToName.size}`)

  if (args.dryRun) {
    const pairs = contactSlugs.reduce((n, c) => n + c.slugs.length, 0)
    log(`DRY RUN — would upsert ${slugToName.size} tags and ${pairs} contact_tags links`)
    log('Tags: ' + [...slugToName.values()].sort().join(', '))
    return
  }

  // ── 2. Upsert tag registry rows ──────────────────────────────────────────────
  const tagRows = [...slugToName.entries()].map(([slug, name]) => ({
    org_id: orgId, name, slug, color: '#6B7280',
  }))
  if (tagRows.length > 0) {
    const { error } = await supabase
      .from('tags')
      .upsert(tagRows, { onConflict: 'org_id,slug', ignoreDuplicates: true })
    if (error) throw new Error(`tags upsert failed: ${error.message}`)
  }

  // ── 3. Map slug → tag_id ─────────────────────────────────────────────────────
  const slugToId = new Map<string, string>()
  {
    let tfrom = 0
    for (;;) {
      const { data, error } = await supabase
        .from('tags').select('id, slug').eq('org_id', orgId).range(tfrom, tfrom + PAGE - 1)
      if (error) throw new Error(`tags read failed: ${error.message}`)
      if (!data || data.length === 0) break
      for (const t of data) slugToId.set(t.slug, t.id)
      if (data.length < PAGE) break
      tfrom += PAGE
    }
  }

  // ── 4. Upsert contact_tags links (batched) ───────────────────────────────────
  const links: Array<{ contact_id: string; tag_id: string }> = []
  for (const { contactId, slugs } of contactSlugs) {
    for (const slug of slugs) {
      const tagId = slugToId.get(slug)
      if (tagId) links.push({ contact_id: contactId, tag_id: tagId })
    }
  }
  let inserted = 0
  for (let i = 0; i < links.length; i += PAGE) {
    const batch = links.slice(i, i + PAGE)
    const { error } = await supabase
      .from('contact_tags')
      .upsert(batch, { onConflict: 'contact_id,tag_id', ignoreDuplicates: true })
    if (error) throw new Error(`contact_tags upsert failed: ${error.message}`)
    inserted += batch.length
    log(`  linked ${Math.min(i + PAGE, links.length)}/${links.length}`)
  }

  log('──────────────────────────────────────────')
  log(`DONE — ${slugToName.size} tags registered, ${inserted} contact_tags links upserted`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
