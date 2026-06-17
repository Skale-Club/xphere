// Meta Graph API — shared primitives.
//
// Hashing, phone normalization, and HTTP wrappers reused across the Meta
// integrations (Custom Audiences sync + Conversions API). Graph API v20.0,
// matching META_ADS_GRAPH_VERSION. Web Crypto only (Edge-runtime safe).

import { META_ADS_GRAPH_VERSION } from '@/lib/ads/meta-oauth'

export const GRAPH_BASE = `https://graph.facebook.com/${META_ADS_GRAPH_VERSION}`

/** Lower-case, trim, then SHA-256 → lowercase hex (Meta's normalization rule). */
export async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value.toLowerCase().trim())
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Meta hashes phone numbers as digits only — country code + number, with no
 * '+', spaces, or punctuation (e.g. "+1 (555) 123-4567" → "15551234567").
 * Keeping the leading '+' yields a hash that never matches Meta's records,
 * so strip every non-digit. Callers should pass phone_e164 for a country code.
 */
export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '')
}

async function readGraphError(res: Response): Promise<string> {
  let msg = `Meta API ${res.status}`
  try {
    const err = (await res.json()) as { error?: { message?: string; code?: number } }
    msg = err.error?.message ?? msg
  } catch { /* ignore */ }
  return msg
}

export async function graphPost<T>(
  path: string,
  token: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${GRAPH_BASE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ ...body, access_token: token }),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(await readGraphError(res))
  return res.json() as Promise<T>
}

/**
 * DELETE with a JSON body. Meta's Customer List Custom Audience API removes
 * users via an HTTP DELETE to `/{audience_id}/users` carrying the same hashed
 * `payload` body as the ADD (POST) call. The Graph API accepts a JSON request
 * body on DELETE, so we send it the same way graphPost does.
 * https://developers.facebook.com/docs/marketing-api/audiences/guides/custom-audiences#remove-users
 */
export async function graphDelete<T>(
  path: string,
  token: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${GRAPH_BASE}/${path}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ ...body, access_token: token }),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(await readGraphError(res))
  return res.json() as Promise<T>
}

export async function graphGet<T>(
  path: string,
  token: string,
  params?: Record<string, string>,
): Promise<T> {
  const url = new URL(`${GRAPH_BASE}/${path}`)
  url.searchParams.set('access_token', token)
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  }
  const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store' })
  if (!res.ok) throw new Error(await readGraphError(res))
  return res.json() as Promise<T>
}
