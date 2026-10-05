// Thin Search Console API client (webmasters v3): property list and Search
// Analytics queries. Read-only — the module never writes to Search Console.

const API = 'https://www.googleapis.com/webmasters/v3'

export type GscDimension = 'date' | 'device' | 'query' | 'page' | 'country'

export interface GscRow {
  keys?: string[]
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export interface GscProperty {
  siteUrl: string
  permissionLevel: string
}

export class GscApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message)
    this.name = 'GscApiError'
  }
}

async function call<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  })
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } }
  if (!res.ok) throw new GscApiError(json.error?.message ?? `Search Console HTTP ${res.status}`, res.status)
  return json
}

/** Properties the connected account can read (unverified ones excluded). */
export async function listGscProperties(token: string): Promise<GscProperty[]> {
  const json = await call<{ siteEntry?: GscProperty[] }>(token, '/sites')
  return (json.siteEntry ?? [])
    .filter((s) => s.permissionLevel !== 'siteUnverifiedUser')
    .sort((a, b) => a.siteUrl.localeCompare(b.siteUrl))
}

export interface SearchAnalyticsQuery {
  startDate: string
  endDate: string
  dimensions: GscDimension[]
  rowLimit?: number
  startRow?: number
  /** 'all' includes the last ~2 days of still-settling data. */
  dataState?: 'final' | 'all'
}

export async function querySearchAnalytics(token: string, property: string, q: SearchAnalyticsQuery): Promise<GscRow[]> {
  const json = await call<{ rows?: GscRow[] }>(token, `/sites/${encodeURIComponent(property)}/searchAnalytics/query`, {
    method: 'POST',
    body: JSON.stringify({ type: 'web', rowLimit: 25_000, ...q }),
  })
  return json.rows ?? []
}

/**
 * The property that best matches a site host: the Domain property
 * (sc-domain:) first, then a URL-prefix property for the host or its www twin.
 */
export function suggestProperty(properties: GscProperty[], host: string): string | null {
  const apex = host.replace(/^www\./, '')
  const urls = properties.map((p) => p.siteUrl)
  const candidates = [
    `sc-domain:${apex}`,
    `https://${host}/`,
    `https://www.${apex}/`,
    `https://${apex}/`,
    `http://${host}/`,
    `http://www.${apex}/`,
    `http://${apex}/`,
  ]
  return candidates.find((c) => urls.includes(c)) ?? null
}
