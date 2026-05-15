// src/lib/ghl/list-opportunities.ts
// Phase 32 (v1.9): Lists GHL opportunities with cursor pagination.
// Pattern source: 32-RESEARCH.md Pattern 2 + Medium @tuguidragos cursor article.
//
// OPEN QUESTION Q1 (staging probe): the exact name of the date-filter query
// param is one of { 'date', 'endDate', 'lastStatusChangeStartDate' }. We default
// to 'date' here and rely on the JS-side date guard (Plan 03 runner) as
// defense in depth. If staging shows otherwise, change ONLY the constant
// GHL_DATE_FILTER_PARAM below.

import { ghlFetchJson, type GhlCredentials } from './client'

export interface GhlContactRef {
  id: string
  firstName?: string | null
  phone?: string | null
}

export interface GhlOpportunity {
  id: string
  status: 'open' | 'won' | 'lost' | 'abandoned'
  updatedAt?: string
  statusChangeDate?: string
  contact: GhlContactRef
}

export interface ListOpportunitiesOptions {
  status?: 'open' | 'won' | 'lost' | 'abandoned'
  updatedBefore?: Date
  limit?: number
  maxPages?: number
  timeoutMs?: number
}

interface PaginationMeta {
  startAfter?: number
  startAfterId?: string
  nextPageUrl?: string | null
  total?: number
  currentPage?: number
}

interface OpportunitiesSearchResponse {
  opportunities: GhlOpportunity[]
  meta: PaginationMeta
}

// CHANGE this constant if staging probe reveals a different GHL date-filter
// param name. JS-side date guard in the runner protects against silent
// mismatch (over-fetching but not over-sending).
export const GHL_DATE_FILTER_PARAM = 'date'

const LIST_TIMEOUT_MS_DEFAULT = 10_000   // cron budget; 25× hot-path default
const DEFAULT_LIMIT = 100
const DEFAULT_MAX_PAGES = 50

export async function listOpportunities(
  credentials: GhlCredentials,
  opts: ListOpportunitiesOptions = {},
): Promise<GhlOpportunity[]> {
  const out: GhlOpportunity[] = []
  const limit = String(opts.limit ?? DEFAULT_LIMIT)
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES
  const timeoutMs = opts.timeoutMs ?? LIST_TIMEOUT_MS_DEFAULT
  const cutoffMs = opts.updatedBefore?.getTime() ?? null

  let startAfter: string | undefined
  let startAfterId: string | undefined

  for (let page = 0; page < maxPages; page++) {
    const qp: Record<string, string> = {
      location_id: credentials.locationId,
      limit,
    }
    if (opts.status) qp.status = opts.status
    if (opts.updatedBefore) qp[GHL_DATE_FILTER_PARAM] = opts.updatedBefore.toISOString()
    if (startAfter) qp.startAfter = startAfter
    if (startAfterId) qp.startAfterId = startAfterId

    const data = await ghlFetchJson<OpportunitiesSearchResponse>(
      '/opportunities/search',
      'GET',
      null,
      credentials,
      qp,
      timeoutMs,
    )

    for (const opp of data.opportunities) {
      // Status defense (Pitfall 3 / Assumption A3)
      if (opts.status && opp.status !== opts.status) continue
      // JS-side date defense (Pitfall 1 / Assumption A2)
      if (cutoffMs !== null) {
        const ts = opp.updatedAt ?? opp.statusChangeDate
        const parsed = ts ? Date.parse(ts) : NaN
        if (!Number.isFinite(parsed) || parsed >= cutoffMs) continue
      }
      out.push(opp)
    }

    if (!data.meta.startAfter || !data.meta.startAfterId) break
    startAfter = String(data.meta.startAfter)
    startAfterId = data.meta.startAfterId
  }

  return out
}
