import 'server-only'

// Citation / NAP check (Phase 7, option B — no BrightLocal). For each
// directory that matters in the business's country, one Google search
// `site:<directory> "<business name>" <area>` through SerpAPI tells whether
// the business is listed there and whether the name, phone and street number
// in the result match the profile. Each search spends one scan point.

import { randomUUID } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

import { businessSearchKey } from './credentials'
import { normalizeName } from './matching'
import { checkPointsQuota, periodStart } from './quota'

type Admin = SupabaseClient<Database>

export type Directory = { name: string; domain: string }

const DIRECTORIES: Record<string, Directory[]> = {
  us: [
    { name: 'Yelp', domain: 'yelp.com' },
    { name: 'Facebook', domain: 'facebook.com' },
    { name: 'Better Business Bureau', domain: 'bbb.org' },
    { name: 'Yellow Pages', domain: 'yellowpages.com' },
    { name: 'Foursquare', domain: 'foursquare.com' },
    { name: 'MapQuest', domain: 'mapquest.com' },
    { name: 'Nextdoor', domain: 'nextdoor.com' },
    { name: 'Tripadvisor', domain: 'tripadvisor.com' },
  ],
  br: [
    { name: 'Facebook', domain: 'facebook.com' },
    { name: 'Instagram', domain: 'instagram.com' },
    { name: 'Guia Mais', domain: 'guiamais.com.br' },
    { name: 'Apontador', domain: 'apontador.com.br' },
    { name: 'TeleListas', domain: 'telelistas.net' },
    { name: 'Reclame Aqui', domain: 'reclameaqui.com.br' },
    { name: 'Tripadvisor', domain: 'tripadvisor.com.br' },
    { name: 'Foursquare', domain: 'foursquare.com' },
  ],
}
const DEFAULT_DIRECTORIES: Directory[] = [
  { name: 'Facebook', domain: 'facebook.com' },
  { name: 'Yelp', domain: 'yelp.com' },
  { name: 'Foursquare', domain: 'foursquare.com' },
  { name: 'Tripadvisor', domain: 'tripadvisor.com' },
]

export function directoriesFor(country: string): Directory[] {
  return DIRECTORIES[country.toLowerCase()] ?? DEFAULT_DIRECTORIES
}

/** Best guess of the city from a free-form address ("Rua X, 12 - Bairro, São Paulo - SP, 01310-100"). */
export function guessArea(address: string | null): string {
  if (!address) return ''
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean)
  // Drop postal codes and country names at the end, then take the last
  // remaining chunk, without a trailing state code ("São Paulo - SP").
  const cleaned = parts.filter(
    (p) =>
      !/^\d[\d-]{3,}$/.test(p) && // postal code alone
      !/^[A-Z]{2}\s+\d{5}(-\d{4})?$/.test(p) && // US "MA 02043"
      !/^(usa|united states|brazil|brasil)$/i.test(p),
  )
  const candidate = cleaned.length > 1 ? cleaned[cleaned.length - 1] : (cleaned[0] ?? '')
  return candidate.replace(/\s+-\s+[A-Z]{2}$/, '').replace(/\s+[A-Z]{2}\s+\d{5}(-\d{4})?$/, '').trim()
}

type OrganicResult = { link?: string; title?: string; snippet?: string }

export type CitationVerdict = {
  found: boolean
  url: string | null
  listedName: string | null
  snippet: string | null
  nameMatch: boolean | null
  phoneMatch: boolean | null
  addressMatch: boolean | null
}

/** Judge the first result on the directory against the business NAP. Pure. */
export function judgeCitation(
  results: OrganicResult[],
  domain: string,
  target: { name: string; phone: string | null; address: string | null },
): CitationVerdict {
  const hit = results.find((r) => {
    try {
      return !!r.link && new URL(r.link).hostname.replace(/^www\./, '').endsWith(domain)
    } catch {
      return false
    }
  })
  if (!hit) return { found: false, url: null, listedName: null, snippet: null, nameMatch: null, phoneMatch: null, addressMatch: null }
  const text = `${hit.title ?? ''} ${hit.snippet ?? ''}`
  const digits = text.replace(/\D/g, '')
  const phone = target.phone?.replace(/\D/g, '').slice(-8) ?? ''
  const streetNo = target.address?.match(/\b\d{1,6}\b/)?.[0] ?? null
  const name = normalizeName(target.name)
  return {
    found: true,
    url: hit.link ?? null,
    listedName: hit.title?.split(/\s[|\-–—]\s/)[0]?.trim() ?? null,
    snippet: hit.snippet?.slice(0, 300) ?? null,
    nameMatch: name ? normalizeName(text).includes(name) : null,
    // Snippets often omit the phone/address: unknown is null, not false.
    phoneMatch: phone.length >= 7 && digits.length >= 7 ? digits.includes(phone) : null,
    addressMatch: streetNo && /\d/.test(hit.snippet ?? '') ? new RegExp(`\\b${streetNo}\\b`).test(text) : null,
  }
}

export async function runCitationCheck(
  admin: Admin,
  input: { orgId: string; locationId: string; area?: string },
): Promise<{ ok: true; runId: string; found: number; total: number } | { ok: false; error: string }> {
  const { data: loc } = await admin.from('local_seo_locations').select('*').eq('id', input.locationId).eq('org_id', input.orgId).maybeSingle()
  if (!loc) return { ok: false, error: 'Location not found.' }
  const key = await businessSearchKey(admin, input.orgId)
  if (!key) return { ok: false, error: 'No SerpAPI key is configured for citation checks.' }
  const directories = directoriesFor(loc.country)
  const quota = await checkPointsQuota(admin, input.orgId, directories.length)
  if (!quota.ok) return { ok: false, error: quota.error }

  const area = (input.area ?? guessArea(loc.address)).trim()
  const runId = randomUUID()
  const target = { name: loc.business_name, phone: loc.phone, address: loc.address }
  const rows = await Promise.all(
    directories.map(async (d) => {
      const params = new URLSearchParams({
        engine: 'google',
        q: `site:${d.domain} "${loc.business_name}"${area ? ` ${area}` : ''}`,
        num: '5',
        hl: loc.language,
        gl: loc.country,
        api_key: key,
      })
      try {
        const res = await fetch(`https://serpapi.com/search.json?${params.toString()}`, { signal: AbortSignal.timeout(30_000) })
        const json = (await res.json().catch(() => ({}))) as { organic_results?: OrganicResult[]; error?: string }
        if (!res.ok || (json.error && !/hasn't returned any results/i.test(json.error))) {
          throw new Error(json.error ?? `SerpAPI ${res.status}`)
        }
        const v = judgeCitation(json.organic_results ?? [], d.domain, target)
        return { directory: d.name, domain: d.domain, found: v.found, url: v.url, listed_name: v.listedName, snippet: v.snippet, name_match: v.nameMatch, phone_match: v.phoneMatch, address_match: v.addressMatch, error: null }
      } catch (err) {
        return { directory: d.name, domain: d.domain, found: false, url: null, listed_name: null, snippet: null, name_match: null, phone_match: null, address_match: null, error: (err as Error).message.slice(0, 300) }
      }
    }),
  )

  await admin.from('local_seo_citation_checks').insert(rows.map((r) => ({ ...r, org_id: input.orgId, location_id: loc.id, run_id: runId })))
  await admin.from('local_seo_usage_ledger').insert({
    org_id: input.orgId,
    points: directories.length,
    cost_usd: directories.length * 0.015,
    provider: 'serpapi',
    billable: true,
    period: periodStart(),
  })
  return { ok: true, runId, found: rows.filter((r) => r.found).length, total: rows.length }
}
