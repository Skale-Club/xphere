/**
 * Thin HTTP client for the Meta Graph API.
 *
 *   - Adds `Authorization: Bearer ${accessToken}` automatically
 *   - Retries on 429 + 5xx with exponential backoff (3 attempts)
 *   - Surfaces structured Meta errors instead of opaque "fetch failed"
 *
 * Never logs the access token. Errors include only the Meta-side fields.
 */

import type { CloudAccount, MetaApiError } from './types'

const META_GRAPH_BASE = 'https://graph.facebook.com/v21.0'
const RETRY_STATUS = new Set([429, 500, 502, 503, 504])
const MAX_ATTEMPTS = 3

export class MetaApiException extends Error {
  readonly status: number
  readonly metaError: MetaApiError

  constructor(status: number, metaError: MetaApiError) {
    super(`Meta API ${status}: ${metaError.message} (code ${metaError.code})`)
    this.status = status
    this.metaError = metaError
    this.name = 'MetaApiException'
  }
}

interface MetaFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /** JSON body — will be stringified. */
  body?: unknown
  /** Extra query params for GETs. */
  query?: Record<string, string | number | boolean | undefined>
  /** Override base URL (rare). */
  base?: string
}

export async function metaFetch<T>(
  account: Pick<CloudAccount, 'accessToken'>,
  path: string,
  opts: MetaFetchOptions = {},
): Promise<T> {
  const base = opts.base ?? META_GRAPH_BASE
  const qs = opts.query
    ? '?' +
      Object.entries(opts.query)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
    : ''
  const url = `${base}${path.startsWith('/') ? '' : '/'}${path}${qs}`

  const init: RequestInit = {
    method: opts.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${account.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  }

  let lastError: Error | undefined
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let res: Response
    try {
      res = await fetch(url, init)
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt < MAX_ATTEMPTS) {
        await sleep(backoffMs(attempt))
        continue
      }
      throw lastError
    }

    if (res.ok) {
      // 204 / empty body safety
      const text = await res.text()
      if (!text) return {} as T
      return JSON.parse(text) as T
    }

    // Try to parse Meta error envelope
    let metaError: MetaApiError | undefined
    try {
      const data = (await res.json()) as { error?: MetaApiError }
      metaError = data.error
    } catch {
      // body not JSON; fall through with generic
    }

    if (RETRY_STATUS.has(res.status) && attempt < MAX_ATTEMPTS) {
      await sleep(backoffMs(attempt))
      continue
    }

    throw new MetaApiException(
      res.status,
      metaError ?? { message: `HTTP ${res.status}`, code: res.status },
    )
  }

  throw lastError ?? new Error('Meta API: exhausted retries')
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function backoffMs(attempt: number) {
  // 250ms, 750ms, 2250ms — capped jitter
  return 250 * 3 ** (attempt - 1) + Math.floor(Math.random() * 150)
}
