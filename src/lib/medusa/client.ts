// src/lib/medusa/client.ts
// HTTP client for the Medusa Store API (Stuscle commerce backend). Every call
// enforces the R11 per-org budget BEFORE issuing the network request, sends
// the org's publishable API key, and aborts after 8s. See
// .planning/research/INTEGRATION-CONTRACT.md §4.1.
//
// Phase 135 adds `medusaAgentFetch` for the privileged, HMAC-signed
// /agent/* surface (contract §4.2) — same R11 budget + 8s timeout, but signs
// the request with the connection token instead of sending the publishable
// key. See ./agent-sig.ts for the signing helper.

import { rateLimit } from '@/lib/rate-limit'
import { signAgentBody } from './agent-sig'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

export interface MedusaCredentials {
  baseUrl: string // integrations.location_id, e.g. http://localhost:9000
  connectionToken: string // decrypt(encrypted_api_key) — used in Phase 135, not here
  publishableKey: string // config.publishable_key — sent as the store API pk header
  storefrontUrl?: string // config.storefront_url
}

// Passed from execute-action's ActionContext (structurally compatible).
export interface MedusaExecCtx {
  organizationId: string
  supabase: SupabaseClient<Database>
  conversationId?: string
  // Streaming SSE emitter (contract §6 `commerce` events, Phase 134). Only
  // run-agent's STREAMING call site passes this through; the blocking path
  // omits it entirely, so executors must null-check (`ctx.emitStructured?.(...)`).
  emitStructured?: (obj: Record<string, unknown>) => void
}

export class MedusaApiError extends Error {
  constructor(
    public status: number,
    body: string,
  ) {
    super(`Medusa API ${status}: ${body}`)
  }
}

export class MedusaRateLimitError extends Error {
  constructor() {
    super('medusa_rate_limited')
  }
}

export async function medusaStoreFetch<T>(
  creds: MedusaCredentials,
  path: string,
  orgId: string,
  init?: RequestInit,
): Promise<T> {
  const rl = await rateLimit(`medusa:org:${orgId}`, 120, 60, { failMode: 'memory' }) // R11 — BEFORE fetch
  if (!rl.allowed) throw new MedusaRateLimitError()

  const url = `${creds.baseUrl.replace(/\/$/, '')}${path}`
  const res = await fetch(url, {
    ...init,
    headers: { 'x-publishable-api-key': creds.publishableKey, ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new MedusaApiError(res.status, await res.text())
  return res.json() as Promise<T>
}

/**
 * Signed POST to the privileged /agent/* surface (contract §4.2). Enforces
 * R11 (shared with medusaStoreFetch) BEFORE the network call, 8s timeout,
 * throws MedusaApiError on non-2xx so callers can branch on `.status`
 * (e.g. 409 wishlist_full).
 *
 * BYTE-AGREEMENT INVARIANT (SECURITY CRITICAL): stringify the body ONCE,
 * sign THAT string, send THAT identical string as the fetch body — do NOT
 * re-stringify. Sign with the exact `ts` string placed in the header.
 */
export async function medusaAgentFetch<T>(
  creds: MedusaCredentials,
  path: string,
  orgId: string,
  body: Record<string, unknown>,
): Promise<T> {
  const rl = await rateLimit(`medusa:org:${orgId}`, 120, 60, { failMode: 'memory' }) // R11 — shared with medusaStoreFetch, BEFORE fetch
  if (!rl.allowed) throw new MedusaRateLimitError()

  const raw = JSON.stringify(body) // stringify ONCE
  const ts = Math.floor(Date.now() / 1000).toString() // seconds, as a STRING
  const sig = await signAgentBody(creds.connectionToken, ts, raw) // bare hex

  const url = `${creds.baseUrl.replace(/\/$/, '')}${path}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Xphere-Timestamp': ts,
      'X-Xphere-Signature': `v1=${sig}`, // the ONLY place the v1= scheme tag is applied
    },
    body: raw, // send the SAME string that was signed
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new MedusaApiError(res.status, await res.text())
  return res.json() as Promise<T>
}
