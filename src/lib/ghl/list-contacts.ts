// src/lib/ghl/list-contacts.ts
// Cursor-paginated reader for GHL contacts. Mirrors the proven pattern in
// list-opportunities.ts: GET /contacts/ with startAfter (ms epoch) +
// startAfterId, looping until meta stops returning a cursor.
//
// Confirmed against the live Skale Club location: GET /contacts/ returns
// { contacts, meta: { total, startAfter, startAfterId, nextPageUrl, ... } }.

import { ghlFetchJson, type GhlCredentials } from './client'

export interface GhlContactCustomField {
  id: string
  value: unknown
}

export interface GhlContact {
  id: string
  contactName?: string | null
  firstName?: string | null
  lastName?: string | null
  email?: string | null
  phone?: string | null
  companyName?: string | null
  tags?: string[]
  customFields?: GhlContactCustomField[]
}

interface ContactsPaginationMeta {
  total?: number
  startAfter?: number
  startAfterId?: string
  nextPageUrl?: string | null
}

interface ContactsListResponse {
  contacts: GhlContact[]
  meta: ContactsPaginationMeta
}

export interface ListContactsOptions {
  limit?: number
  maxPages?: number
  timeoutMs?: number
  /** Called once per fetched page (post-fetch). Useful for progress logging. */
  onPage?: (contacts: GhlContact[], pageIndex: number, total?: number) => void | Promise<void>
  /** Milliseconds to wait between page fetches; eases GHL rate limits. */
  pageDelayMs?: number
}

const LIST_TIMEOUT_MS_DEFAULT = 10_000 // batch budget; 25× hot-path default
const DEFAULT_LIMIT = 100 // GHL max page size for /contacts/
const DEFAULT_MAX_PAGES = 500 // 500 × 100 = 50k contacts ceiling

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Fetches every contact for the location, paging until the cursor is exhausted.
 * Accumulates into a single array. For very large locations, supply `onPage`
 * to stream batches instead of relying solely on the return value.
 */
export async function listAllGhlContacts(
  credentials: GhlCredentials,
  opts: ListContactsOptions = {},
): Promise<GhlContact[]> {
  const out: GhlContact[] = []
  const limit = String(opts.limit ?? DEFAULT_LIMIT)
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES
  const timeoutMs = opts.timeoutMs ?? LIST_TIMEOUT_MS_DEFAULT

  let startAfter: string | undefined
  let startAfterId: string | undefined

  for (let page = 0; page < maxPages; page++) {
    const qp: Record<string, string> = {
      locationId: credentials.locationId,
      limit,
    }
    if (startAfter) qp.startAfter = startAfter
    if (startAfterId) qp.startAfterId = startAfterId

    const data = await ghlFetchJson<ContactsListResponse>(
      '/contacts/',
      'GET',
      null,
      credentials,
      qp,
      timeoutMs,
    )

    const contacts = data.contacts ?? []
    out.push(...contacts)
    if (opts.onPage) await opts.onPage(contacts, page, data.meta?.total)

    if (!data.meta?.startAfter || !data.meta?.startAfterId) break
    startAfter = String(data.meta.startAfter)
    startAfterId = data.meta.startAfterId

    if (opts.pageDelayMs && page < maxPages - 1) await sleep(opts.pageDelayMs)
  }

  return out
}
