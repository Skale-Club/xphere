// Meta Marketing API — Custom Audiences (Customer File)
// Graph API v20.0, schema: EMAIL_SHA256 + PHONE_SHA256
// https://developers.facebook.com/docs/marketing-api/audiences/guides/custom-audiences

import { META_ADS_GRAPH_VERSION } from '@/lib/ads/meta-oauth'

const GRAPH_BASE = `https://graph.facebook.com/${META_ADS_GRAPH_VERSION}`
const BATCH_SIZE = 10_000

// ─── Types ────────────────────────────────────────────────────────────────────

export type AudienceUserOperation = 'ADD' | 'REMOVE'

export interface AudienceBatchResult {
  num_received: number
  num_invalid_entries: number
  invalid_entry_samples?: Record<string, string>
}

export interface AudienceStatus {
  id: string
  name: string
  approximate_count_lower_bound: number
  approximate_count_upper_bound: number
  operation_status: { code: number; description: string }
  data_source: { type: string }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value.toLowerCase().trim())
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

function normalizePhone(phone: string): string {
  // Meta hashes phone numbers as digits only — country code + number, with no
  // '+', spaces, or punctuation (e.g. "+1 (555) 123-4567" → "15551234567").
  // Keeping the leading '+' yields a hash that never matches Meta's records,
  // so strip every non-digit. Callers should pass phone_e164 for a country code.
  return phone.replace(/\D/g, '')
}

async function graphPost<T>(
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
  if (!res.ok) {
    let msg = `Meta API ${res.status}`
    try {
      const err = (await res.json()) as { error?: { message?: string; code?: number } }
      msg = err.error?.message ?? msg
    } catch { /* ignore */ }
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

async function graphGet<T>(path: string, token: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${GRAPH_BASE}/${path}`)
  url.searchParams.set('access_token', token)
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  }
  const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store' })
  if (!res.ok) {
    let msg = `Meta API ${res.status}`
    try {
      const err = (await res.json()) as { error?: { message?: string } }
      msg = err.error?.message ?? msg
    } catch { /* ignore */ }
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

// ─── Audience management ──────────────────────────────────────────────────────

export async function createCustomAudience(
  adAccountId: string,
  token: string,
  opts: { name: string; description?: string; consentBasis?: string },
): Promise<{ id: string }> {
  return graphPost<{ id: string }>(`${adAccountId}/customaudiences`, token, {
    name: opts.name,
    subtype: 'CUSTOM',
    description: opts.description ?? 'Xphere CRM sync',
    customer_file_source: opts.consentBasis ?? 'CUSTOMER_FILE_WITH_CONSENT',
  })
}

export async function getAudienceStatus(
  audienceId: string,
  token: string,
): Promise<AudienceStatus> {
  return graphGet<AudienceStatus>(
    audienceId,
    token,
    { fields: 'id,name,approximate_count_lower_bound,approximate_count_upper_bound,operation_status,data_source' },
  )
}

// ─── Contact hashing ──────────────────────────────────────────────────────────

export interface ContactHashEntry {
  email?: string | null
  phone?: string | null
}

export interface HashedPayloadEntry {
  data: string[][]     // [[email_hash, phone_hash], ...] — empty string for missing field
  schema: string[]     // ['EMAIL_SHA256', 'PHONE_SHA256']
}

export async function hashContacts(contacts: ContactHashEntry[]): Promise<HashedPayloadEntry> {
  const schema = ['EMAIL_SHA256', 'PHONE_SHA256']
  const data: string[][] = []

  for (const c of contacts) {
    const emailHash = c.email ? await sha256Hex(c.email) : ''
    const phoneHash = c.phone ? await sha256Hex(normalizePhone(c.phone)) : ''
    // Skip entries with no hashable data
    if (!emailHash && !phoneHash) continue
    data.push([emailHash, phoneHash])
  }

  return { schema, data }
}

// ─── Sync batches ─────────────────────────────────────────────────────────────

export async function syncUsersToAudience(
  audienceId: string,
  token: string,
  contacts: ContactHashEntry[],
  operation: AudienceUserOperation,
): Promise<{ sent: number; invalid: number }> {
  const { schema, data } = await hashContacts(contacts)
  if (data.length === 0) return { sent: 0, invalid: 0 }

  let totalSent = 0
  let totalInvalid = 0

  for (let offset = 0; offset < data.length; offset += BATCH_SIZE) {
    const chunk = data.slice(offset, offset + BATCH_SIZE)
    const result = await graphPost<AudienceBatchResult>(
      `${audienceId}/users`,
      token,
      { payload: { schema, data: chunk } },
    )
    totalSent += result.num_received ?? chunk.length
    totalInvalid += result.num_invalid_entries ?? 0
  }

  return { sent: totalSent, invalid: totalInvalid }
}

export { BATCH_SIZE }
