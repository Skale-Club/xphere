// One-off migration: GoHighLevel (Skleanings sub-account) contacts -> Xphere contacts.
// Reads the org's stored GHL integration (decrypts the token with the app's
// ENCRYPTION_SECRET), paginates all GHL contacts, maps + dedups them, and
// inserts into the Skleanings org. Tags flow into contacts.tags[] AND the
// tags / contact_tags system. Extra GHL fields land in custom_fields jsonb.
//
//   node scripts/migrate-skleanings-contacts.mjs            # dry-run (no writes)
//   node scripts/migrate-skleanings-contacts.mjs --execute  # real write
//
// Rollback:  delete from contacts where org_id = '<org>' and source = 'ghl_sync';
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const DRY = !process.argv.includes('--execute')
const ORG_NAME = process.argv.find((a) => a.startsWith('--org='))?.split('=')[1] || 'Skleanings'

// ── env ──────────────────────────────────────────────────────────────────────
const env = readFileSync('.env.local', 'utf8')
const getEnv = (k) => env.match(new RegExp('^' + k + '\\s*=\\s*"?([^"\\r\\n]+)"?', 'm'))?.[1]
const SUPABASE_URL = getEnv('NEXT_PUBLIC_SUPABASE_URL')
const SERVICE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY')
const ENCRYPTION_SECRET = getEnv('ENCRYPTION_SECRET')
if (!SUPABASE_URL || !SERVICE_KEY || !ENCRYPTION_SECRET) throw new Error('missing env')

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

// ── crypto (mirror src/lib/crypto.ts decrypt) ─────────────────────────────────
async function decrypt(stored) {
  const kb = new Uint8Array(32)
  for (let i = 0; i < 32; i++) kb[i] = parseInt(ENCRYPTION_SECRET.slice(i * 2, i * 2 + 2), 16)
  const key = await crypto.subtle.importKey('raw', kb, { name: 'AES-GCM', length: 256 }, false, ['decrypt'])
  const i = stored.indexOf(':')
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(stored.slice(0, i)) }, key, b64(stored.slice(i + 1)))
  return new TextDecoder().decode(pt)
}

// ── normalization (mirror zod-schemas) ────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const EMAIL_BLOCKLIST = new Set(['noemail@email.com', 'test@test.com', 'no@email.com', 'na@na.com', 'none@none.com'])
function normEmail(raw) {
  if (!raw) return null
  const e = String(raw).trim().toLowerCase()
  if (!e || !EMAIL_RE.test(e) || EMAIL_BLOCKLIST.has(e)) return null
  return e
}
function normPhone(raw) {
  if (!raw) return null
  const s = String(raw).trim()
  if (!s) return null
  const digits = s.replace(/\D/g, '')
  return digits ? '+' + digits : null
}
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)
function slugify(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

// ── 1. resolve org + GHL credentials ──────────────────────────────────────────
const { data: org } = await sb.from('organizations').select('id, name').eq('name', ORG_NAME).single()
if (!org) throw new Error(`org ${ORG_NAME} not found`)
const { data: integ } = await sb
  .from('integrations')
  .select('encrypted_api_key, location_id')
  .eq('organization_id', org.id)
  .eq('provider', 'gohighlevel')
  .single()
if (!integ) throw new Error('gohighlevel integration not found for org')
const apiKey = await decrypt(integ.encrypted_api_key)
const locationId = integ.location_id
console.log(`org=${org.id}  location=${locationId}  mode=${DRY ? 'DRY-RUN' : 'EXECUTE'}`)

// ── 2. paginate all GHL contacts ──────────────────────────────────────────────
const headers = { Authorization: `Bearer ${apiKey}`, Version: '2021-07-28' }
let url = `https://services.leadconnectorhq.com/contacts/?locationId=${locationId}&limit=100`
const ghl = []
let total = null
for (let page = 1; url; page++) {
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`GHL page ${page} -> HTTP ${res.status}`)
  const json = await res.json()
  ghl.push(...(json.contacts ?? []))
  total = json.meta?.total ?? total
  url = json.meta?.nextPageUrl ?? null
  if (!json.contacts?.length) break
}
console.log(`fetched ${ghl.length} contacts (GHL meta.total=${total})`)

// ── 3. map + dedup ────────────────────────────────────────────────────────────
const { data: existingRows } = await sb.from('contacts').select('external_id').eq('org_id', org.id)
const existingExt = new Set((existingRows ?? []).map((r) => r.external_id).filter(Boolean))

const seenPhone = new Set()
const seenEmail = new Set()
const stats = { skippedAlready: 0, dedupPhone: 0, dedupEmail: 0, noIdentity: 0, nameOnly: 0, invalidEmail: 0 }
const rows = []
const tagLinks = [] // { extId, tag }

for (const c of ghl) {
  if (c.id && existingExt.has(c.id)) { stats.skippedAlready++; continue }
  const first = c.firstNameRaw || cap(c.firstName) || null
  const last = c.lastNameRaw || cap(c.lastName) || null
  const phone = normPhone(c.phone)
  const rawEmail = (c.email ?? '').trim()
  const email = normEmail(c.email)
  if (rawEmail && !email) stats.invalidEmail++
  const name = [first, last].filter(Boolean).join(' ') || c.contactName || null

  if (!first && !last && !name && !phone && !email) { stats.noIdentity++; continue }
  // DB identity invariant: a contact needs phone OR email (GHL is not a valid
  // channel-identity provider). Name-only contacts cannot be migrated as-is.
  if (!phone && !email) { stats.nameOnly++; continue }
  if (phone) { if (seenPhone.has(phone)) { stats.dedupPhone++; continue } seenPhone.add(phone) }
  if (email) { if (seenEmail.has(email)) { stats.dedupEmail++; continue } seenEmail.add(email) }

  const custom = {
    ghl_id: c.id ?? null, ghl_type: c.type ?? null, ghl_source: c.source ?? null,
    city: c.city ?? null, state: c.state ?? null, postal_code: c.postalCode ?? null,
    address1: c.address1 ?? null, country: c.country ?? null, website: c.website ?? null,
    timezone: c.timezone ?? null, date_of_birth: c.dateOfBirth ?? null, dnd: c.dnd ?? null,
    date_added: c.dateAdded ?? null,
    additional_emails: Array.isArray(c.additionalEmails) && c.additionalEmails.length ? c.additionalEmails : null,
    ghl_custom_fields: Array.isArray(c.customFields) && c.customFields.length ? c.customFields : null,
  }
  for (const k of Object.keys(custom)) if (custom[k] == null) delete custom[k]

  const tags = Array.isArray(c.tags) ? [...new Set(c.tags.map((t) => String(t).trim()).filter(Boolean))] : []
  for (const t of tags) tagLinks.push({ extId: c.id, tag: t })

  rows.push({
    org_id: org.id, first_name: first, last_name: last, name,
    phone, email, company: c.companyName || null,
    tags, custom_fields: custom, source: 'ghl_sync', external_id: c.id ?? null,
  })
}

const uniqueTags = [...new Set(tagLinks.map((l) => l.tag))]
console.log('\n── PLAN ──')
console.log(`would insert : ${rows.length}`)
console.log(`skipped (already imported) : ${stats.skippedAlready}`)
console.log(`dedup phone / email        : ${stats.dedupPhone} / ${stats.dedupEmail}`)
console.log(`no usable identity (skip)  : ${stats.noIdentity}`)
console.log(`name-only, no phone/email (skip) : ${stats.nameOnly}`)
console.log(`invalid emails -> null     : ${stats.invalidEmail}`)
console.log(`with phone / with email    : ${rows.filter((r) => r.phone).length} / ${rows.filter((r) => r.email).length}`)
console.log(`unique tags                : ${uniqueTags.length}${uniqueTags.length ? ' -> ' + uniqueTags.slice(0, 15).join(', ') + (uniqueTags.length > 15 ? ' …' : '') : ''}`)
console.log('sample rows:')
for (const r of rows.slice(0, 3)) console.log('  ', JSON.stringify({ name: r.name, phone: r.phone, email: r.email, company: r.company, tags: r.tags }))

if (DRY) { console.log('\nDRY-RUN — no writes. Re-run with --execute to apply.'); process.exit(0) }

// ── 4. insert contacts in batches ─────────────────────────────────────────────
const extToId = new Map()
for (let i = 0; i < rows.length; i += 200) {
  const batch = rows.slice(i, i + 200)
  const { data, error } = await sb.from('contacts').insert(batch).select('id, external_id')
  if (error) throw new Error(`contacts insert [${i}]: ${error.message}`)
  for (const d of data) if (d.external_id) extToId.set(d.external_id, d.id)
  console.log(`inserted contacts ${i + batch.length}/${rows.length}`)
}

// ── 5. tags system ────────────────────────────────────────────────────────────
if (uniqueTags.length) {
  const tagRows = uniqueTags.map((name) => ({ org_id: org.id, name, slug: slugify(name) })).filter((t) => t.slug)
  const { error: tErr } = await sb.from('tags').upsert(tagRows, { onConflict: 'org_id,slug', ignoreDuplicates: true })
  if (tErr) throw new Error(`tags upsert: ${tErr.message}`)
  const { data: allTags } = await sb.from('tags').select('id, slug').eq('org_id', org.id)
  const slugToId = new Map((allTags ?? []).map((t) => [t.slug, t.id]))
  const ctRows = []
  for (const link of tagLinks) {
    const contactId = extToId.get(link.extId)
    const tagId = slugToId.get(slugify(link.tag))
    if (contactId && tagId) ctRows.push({ contact_id: contactId, tag_id: tagId })
  }
  for (let i = 0; i < ctRows.length; i += 500) {
    const { error: cErr } = await sb.from('contact_tags').upsert(ctRows.slice(i, i + 500), { onConflict: 'contact_id,tag_id', ignoreDuplicates: true })
    if (cErr) throw new Error(`contact_tags insert [${i}]: ${cErr.message}`)
  }
  console.log(`linked ${ctRows.length} contact-tag pairs across ${tagRows.length} tags`)
}

const { count } = await sb.from('contacts').select('*', { count: 'exact', head: true }).eq('org_id', org.id)
console.log(`\n✅ done. contacts in org now: ${count}`)
