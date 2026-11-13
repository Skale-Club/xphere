// src/lib/websites/site-info.ts
// GET /api/v1/site on a Skale Club Websites tenant: the business's contact details,
// opening hours, published services and active service areas, formatted for an AI agent.
//
// Why a tool and not the knowledge base: the site is where an owner edits services and
// areas, so a copy in the KB goes stale the day a service is added. Reading it live keeps
// the agent's answer equal to what the visitor sees on the page.
//
// Credentials (Settings → Integrations → Websites): location_id is the tenant's public site
// URL, api_key is the SAME Xphere key the tenant stores under its own Integrations → Xphere
// (one secret authenticates both directions, as with Xkedule). Nothing lives in the env.

import type { SupabaseClient } from '@supabase/supabase-js'
import { memoTtl } from '@/lib/cache/ttl-memo'
import { getUrlCredentials } from '@/lib/integrations/url-credentials'
import { assertSafeBaseUrl } from '@/lib/medusa/client'

export interface WebsitesCredentials {
  baseUrl: string
  apiKey: string
}

interface DayHours {
  isOpen?: boolean
  start?: string
  end?: string
}

export interface SiteSnapshot {
  schema_version?: string
  site?: { domain?: string; url?: string }
  business?: {
    name?: string | null
    phone?: string | null
    email?: string | null
    address?: string | null
    business_type?: string | null
    hours?: Record<string, DayHours> | null
  }
  services?: Array<{ slug: string; title: string; summary?: string | null; url?: string }>
  areas?: Array<{ slug: string; name: string; city?: string; state?: string; description?: string | null; url?: string }>
}

// The owner edits a service or an area a few times a month; five minutes keeps a long
// conversation from re-reading the site on every turn without serving stale content for long.
const SITE_INFO_CACHE_TTL_MS = 300_000
const FETCH_TIMEOUT_MS = 10_000
const DAY_ORDER = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const

export async function getWebsitesCredentialsForOrg(
  orgId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
): Promise<WebsitesCredentials | null> {
  return getUrlCredentials(orgId, 'websites', supabase)
}

function titleCase(day: string): string {
  return day.charAt(0).toUpperCase() + day.slice(1)
}

function formatHours(hours: Record<string, DayHours> | null | undefined): string {
  if (!hours) return ''
  const lines = DAY_ORDER.filter((day) => hours[day]).map((day) => {
    const entry = hours[day]
    return entry.isOpen && entry.start && entry.end
      ? `${titleCase(day)}: ${entry.start}–${entry.end}`
      : `${titleCase(day)}: closed`
  })
  return lines.length ? `\nOpening hours:\n${lines.join('\n')}` : ''
}

/** Pure: turns the site snapshot into the text the agent reads. */
export function formatSiteInfo(snapshot: SiteSnapshot): string {
  const b = snapshot.business ?? {}
  const header = [
    b.name ? `Business: ${b.name}` : null,
    b.business_type ? `Type: ${b.business_type}` : null,
    b.phone ? `Phone: ${b.phone}` : null,
    b.email ? `Email: ${b.email}` : null,
    b.address ? `Address: ${b.address}` : null,
    snapshot.site?.url ? `Website: ${snapshot.site.url}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  const services = snapshot.services ?? []
  const servicesBlock = services.length
    ? `\nServices offered:\n${services.map((s) => `- ${s.title}${s.summary ? `: ${s.summary}` : ''}`).join('\n')}`
    : '\nServices offered: none published on the site yet — do not invent services.'

  const areas = snapshot.areas ?? []
  const areasBlock = areas.length
    ? `\nService areas: ${areas.map((a) => (a.state ? `${a.name}, ${a.state}` : a.name)).join('; ')}`
    : '\nService areas: none published — say you will check where the business works rather than guessing.'

  return `${header}${formatHours(b.hours)}${servicesBlock}${areasBlock}`.trim()
}

async function fetchSnapshot(credentials: WebsitesCredentials): Promise<SiteSnapshot> {
  try {
    assertSafeBaseUrl(credentials.baseUrl)
  } catch {
    throw new Error('The Websites integration URL is not allowed (use the public https site URL).')
  }
  const response = await fetch(`${credentials.baseUrl.replace(/\/$/, '')}/api/v1/site`, {
    headers: { Authorization: `Bearer ${credentials.apiKey}`, Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (response.status === 401) {
    throw new Error('The site rejected the Xphere key. Paste the same key in the tenant\'s Integrations → Xphere and enable it.')
  }
  if (!response.ok) throw new Error(`Websites API error ${response.status}`)
  return (await response.json()) as SiteSnapshot
}

export async function getWebsitesSiteInfo(
  _params: Record<string, unknown>,
  credentials: WebsitesCredentials,
): Promise<string> {
  const snapshot = await memoTtl(
    `websites:site:${credentials.baseUrl}`,
    SITE_INFO_CACHE_TTL_MS,
    () => fetchSnapshot(credentials),
  )
  return formatSiteInfo(snapshot)
}
