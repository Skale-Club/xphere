// src/lib/medusa/client.ts
// HTTP client for the Medusa Store API (Stuscle commerce backend). Every call
// enforces the R11 per-org budget BEFORE issuing the network request, sends
// the org's publishable API key, and aborts after 8s. See
// .planning/research/INTEGRATION-CONTRACT.md §4.1.
//
// Note: this file does NOT export an agent/HMAC fetch — the privileged
// /agent/* surface (Phase 135) uses a different signing scheme and owns its
// own client.

import { rateLimit } from '@/lib/rate-limit'
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
