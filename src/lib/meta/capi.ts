// Meta Conversions API (CAPI) — server-side event sender.
//
// Sends conversion events to a Pixel/Dataset's events endpoint with SHA-256
// hashed user_data plus fbc/fbp/ip/ua for matching. Reuses the shared Graph
// primitives. Spec:
// https://developers.facebook.com/docs/marketing-api/conversions-api

import { sha256Hex, normalizePhone, GRAPH_BASE } from '@/lib/meta/graph'

export class MetaCapiError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
    public readonly subcode?: number,
  ) {
    super(message)
    this.name = 'MetaCapiError'
  }
}

export interface CapiUserInput {
  email?: string | null
  phone?: string | null
  firstName?: string | null
  lastName?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  country?: string | null
  externalId?: string | null
  fbc?: string | null
  fbp?: string | null
  clientIp?: string | null
  clientUserAgent?: string | null
}

/** Hashed + plain user_data per Meta's spec. Omits empty fields. */
export async function buildUserData(input: CapiUserInput): Promise<Record<string, unknown>> {
  const ud: Record<string, unknown> = {}
  if (input.email) ud.em = [await sha256Hex(input.email)]
  if (input.phone) {
    const norm = normalizePhone(input.phone)
    if (norm) ud.ph = [await sha256Hex(norm)]
  }
  if (input.firstName) ud.fn = [await sha256Hex(input.firstName)]
  if (input.lastName) ud.ln = [await sha256Hex(input.lastName)]
  if (input.city) ud.ct = [await sha256Hex(input.city)]
  if (input.state) ud.st = [await sha256Hex(input.state)]
  if (input.zip) ud.zp = [await sha256Hex(input.zip)]
  if (input.country) ud.country = [await sha256Hex(input.country)]
  if (input.externalId) ud.external_id = [await sha256Hex(input.externalId)]
  // Not hashed — used verbatim for matching.
  if (input.fbc) ud.fbc = input.fbc
  if (input.fbp) ud.fbp = input.fbp
  if (input.clientIp) ud.client_ip_address = input.clientIp
  if (input.clientUserAgent) ud.client_user_agent = input.clientUserAgent
  return ud
}

export interface CapiEvent {
  event_name: string
  event_time: number          // unix seconds
  event_id: string
  action_source: 'website' | 'system_generated'
  event_source_url?: string
  user_data: Record<string, unknown>
  custom_data?: Record<string, unknown>
}

export interface SendResult {
  events_received: number
  fbtrace_id: string | null
  messages?: unknown[]
}

const MAX_PER_REQUEST = 1000

/**
 * POST events to /{dataset_id}/events. Batches at 1000/request. Throws
 * MetaCapiError on the first failing batch (caller handles retry/backoff).
 */
export async function sendCapiEvents(
  datasetId: string,
  token: string,
  events: CapiEvent[],
  opts: { testEventCode?: string | null } = {},
): Promise<SendResult> {
  let received = 0
  let trace: string | null = null

  for (let i = 0; i < events.length; i += MAX_PER_REQUEST) {
    const chunk = events.slice(i, i + MAX_PER_REQUEST)
    const body: Record<string, unknown> = { data: chunk, access_token: token }
    if (opts.testEventCode) body.test_event_code = opts.testEventCode

    const res = await fetch(`${GRAPH_BASE}/${datasetId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    })

    const json = (await res.json().catch(() => ({}))) as {
      events_received?: number
      fbtrace_id?: string
      messages?: unknown[]
      error?: { message?: string; code?: number; error_subcode?: number }
    }

    if (!res.ok || json.error) {
      throw new MetaCapiError(
        json.error?.message ?? `Meta CAPI error ${res.status}`,
        json.error?.code,
        json.error?.error_subcode,
      )
    }

    received += json.events_received ?? chunk.length
    trace = json.fbtrace_id ?? trace
  }

  return { events_received: received, fbtrace_id: trace }
}
