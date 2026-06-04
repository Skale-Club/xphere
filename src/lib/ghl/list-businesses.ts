// src/lib/ghl/list-businesses.ts
// Skip-paginated reader for GHL businesses. Live probe against Skale Club
// confirmed: GET /businesses/?locationId=...&limit=...&skip=... returns
// { success, businesses } with no meta cursor.

import { ghlFetchJson, type GhlCredentials } from './client'

export interface GhlBusinessCustomField {
  id: string
  value: unknown
}

export interface GhlBusiness {
  id: string
  locationId?: string
  name?: string | null
  website?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  createdBy?: unknown
  customFields?: GhlBusinessCustomField[]
}

interface BusinessesListResponse {
  success?: boolean
  businesses?: GhlBusiness[]
}

export interface ListBusinessesOptions {
  limit?: number
  maxPages?: number
  timeoutMs?: number
  onPage?: (businesses: GhlBusiness[], pageIndex: number) => void | Promise<void>
  pageDelayMs?: number
}

const LIST_TIMEOUT_MS_DEFAULT = 10_000
const DEFAULT_LIMIT = 100
const DEFAULT_MAX_PAGES = 500

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function listAllGhlBusinesses(
  credentials: GhlCredentials,
  opts: ListBusinessesOptions = {},
): Promise<GhlBusiness[]> {
  const out: GhlBusiness[] = []
  const limit = opts.limit ?? DEFAULT_LIMIT
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES
  const timeoutMs = opts.timeoutMs ?? LIST_TIMEOUT_MS_DEFAULT

  for (let page = 0; page < maxPages; page++) {
    const businesses = (await ghlFetchJson<BusinessesListResponse>(
      '/businesses/',
      'GET',
      null,
      credentials,
      {
        locationId: credentials.locationId,
        limit: String(limit),
        skip: String(page * limit),
      },
      timeoutMs,
    )).businesses ?? []

    out.push(...businesses)
    if (opts.onPage) await opts.onPage(businesses, page)

    if (businesses.length < limit) break
    if (opts.pageDelayMs && page < maxPages - 1) await sleep(opts.pageDelayMs)
  }

  return out
}
