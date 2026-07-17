// src/lib/medusa/context.ts
// Signed commerce-context verification + pinning (anti-IDOR core). Verifies
// the storefront-minted HMAC token and merges its claims into
// conversations.memory.commerce, under the pinned key names Phase 132's
// executors already read (see pinned-context.ts / actions/get-cart.ts).
// See .planning/research/INTEGRATION-CONTRACT.md §3.
//
// The verify half is a structural clone of src/lib/email/unsubscribe-token.ts
// — the ONE change is the HMAC key source: raw UTF-8 bytes of the xph_...
// connection token (NOT the hex-decoded ENCRYPTION_SECRET that
// unsubscribe-token.ts / crypto.ts use). Node's createHmac('sha256', s) with
// a string key uses that string's UTF-8 bytes as the key; this must match
// byte-for-byte with stuscle's mint.
//
// No `server-only` import — this module is imported by the nodejs-runtime
// chat route AND by vitest (node env); keep it dependency-light (zod + Web
// Crypto globals only).

import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadPinnedContext } from './pinned-context'
import type { MedusaExecCtx } from './client'

const encoder = new TextEncoder()

// Copied verbatim from src/lib/email/unsubscribe-token.ts.
function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>
}

// CRITICAL: key = raw UTF-8 bytes of the xph_... connection-token STRING.
// Do NOT hex-decode (unlike unsubscribe-token.ts's ENCRYPTION_SECRET, a
// 64-char hex string decoded to 32 key bytes). Do NOT strip the xph_ prefix.
async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'verify',
  ])
}

const ClaimsSchema = z.object({
  v: z.number(),
  org: z.string(),
  cart: z.string().nullable(),
  cus: z.string().nullable(),
  email: z.string().nullable(),
  wishlist_ref: z.string().nullable(),
  country_code: z.string(),
  region_id: z.string().nullable(),
  iat: z.number(),
  exp: z.number(),
})

export type CommerceClaims = z.infer<typeof ClaimsSchema>

/**
 * Verify a storefront-minted commerce-context token (contract §3): split on
 * ".", recompute HMAC-SHA256 over the base64url payload STRING using the
 * org's decrypted Medusa connection token as raw-UTF8 key bytes, constant-time
 * compare via crypto.subtle.verify, then check v===1 / exp (unix seconds) /
 * org. Fail-soft: any invalid input (expired, tampered, wrong-org, malformed
 * base64/JSON) returns null — NEVER throws.
 */
export async function verifyCommerceContext(
  token: string,
  secret: string,
  expectedOrg: string,
): Promise<CommerceClaims | null> {
  try {
    const dot = token.indexOf('.')
    if (dot === -1) return null
    const payloadB64 = token.slice(0, dot)
    const sigB64 = token.slice(dot + 1)
    const key = await hmacKey(secret)
    const ok = await crypto.subtle.verify('HMAC', key, b64urlDecode(sigB64), encoder.encode(payloadB64))
    if (!ok) return null
    const raw: unknown = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64)))
    const claims = ClaimsSchema.safeParse(raw)
    if (!claims.success) return null
    const c = claims.data
    if (c.v !== 1) return null
    if (c.exp <= Math.floor(Date.now() / 1000)) return null // exp is UNIX SECONDS, not ms
    if (c.org !== expectedOrg) return null // cross-org replay barrier
    return c
  } catch {
    return null
  }
}

/**
 * Merge verified claims into conversations.memory.commerce under the
 * VERBATIM contract §3 claim names — `cart` (matches the shipped
 * actions/get-cart.ts reader `commerce.cart`) and `cus` (the raw claim
 * name, not a longer synonym). Read-merge-write so other `memory` keys
 * survive; both the read and the update are scoped by conversation id +
 * org_id. Returns
 * `{ repinnedFrom }` when a different cart was previously pinned — a fresh
 * VERIFIED token is the sole authority for re-pinning (never message text or
 * model output).
 */
export async function writeCommerceContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  conversationId: string,
  orgId: string,
  claims: CommerceClaims,
): Promise<{ repinnedFrom?: string } | null> {
  const { data: row } = await supabase
    .from('conversations')
    .select('memory')
    .eq('id', conversationId)
    .eq('org_id', orgId)
    .maybeSingle()
  const memory = (row?.memory as Record<string, unknown> | null) ?? {}
  const prev = (memory.commerce as Record<string, unknown> | undefined) ?? {}

  const commerce = {
    cart: claims.cart, // key actions/get-cart.ts reads (commerce.cart) — keep this exact key.
    cus: claims.cus, // verbatim claim name — future readers (Ph135/137) read commerce.cus.
    email: claims.email,
    wishlist_ref: claims.wishlist_ref,
    country_code: claims.country_code,
    region_id: claims.region_id,
    verified_at: new Date().toISOString(),
  }

  await supabase
    .from('conversations')
    .update({ memory: { ...memory, commerce } })
    .eq('id', conversationId)
    .eq('org_id', orgId)

  const oldCart = typeof prev.cart === 'string' ? prev.cart : undefined
  return oldCart && oldCart !== claims.cart ? { repinnedFrom: oldCart } : null
}

/**
 * Thin wrapper around Phase 132's shipped loadPinnedContext — the canonical
 * reader for the pinned commerce context. Does NOT fork a second, divergent
 * query shape (see 133-RESEARCH.md Open Q3): it delegates entirely.
 */
export async function readCommerceContext(ctx: MedusaExecCtx): Promise<Record<string, unknown>> {
  const { commerce } = await loadPinnedContext(ctx)
  return commerce
}

/**
 * Cart-only re-pin after a write executor creates a cart with no prior
 * pinned token (contract §3 — the ONE legitimate non-token re-pin). Same
 * read-merge-write shape as writeCommerceContext, but touches ONLY
 * `commerce.cart` — it does NOT reconstruct a full CommerceClaims and does
 * NOT stamp `verified_at` (a self-created cart is not a verified-token
 * claim; see 134-RESEARCH.md Pitfall 5). All other commerce keys
 * (region_id/cus/email/wishlist_ref/write_count/...) survive unchanged.
 */
export async function pinCartId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  conversationId: string,
  orgId: string,
  cartId: string,
): Promise<void> {
  const { data: row } = await supabase
    .from('conversations')
    .select('memory')
    .eq('id', conversationId)
    .eq('org_id', orgId)
    .maybeSingle()
  const memory = (row?.memory as Record<string, unknown> | null) ?? {}
  const prev = (memory.commerce as Record<string, unknown> | undefined) ?? {}

  await supabase
    .from('conversations')
    .update({ memory: { ...memory, commerce: { ...prev, cart: cartId } } })
    .eq('id', conversationId)
    .eq('org_id', orgId)
}

/**
 * Per-conversation write budget (CRT-02's 25-writes-per-conversation cap,
 * on top of R7/R8's time-windowed limits). Read-merge-write scoped by id +
 * org_id, folded into the same `memory.commerce` object pinCartId touches —
 * durable across turns/invocations, no Redis dependency. Returns
 * `{ allowed: false, count }` WITHOUT writing once `write_count` reaches
 * `cap`; callers MUST turn a denial into a clean tool-result string, never a
 * throw. All other commerce keys survive unchanged on both the allow and
 * deny paths.
 */
export async function bumpConversationWriteCount(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  conversationId: string,
  orgId: string,
  cap = 25,
): Promise<{ allowed: boolean; count: number }> {
  const { data: row } = await supabase
    .from('conversations')
    .select('memory')
    .eq('id', conversationId)
    .eq('org_id', orgId)
    .maybeSingle()
  const memory = (row?.memory as Record<string, unknown> | null) ?? {}
  const prev = (memory.commerce as Record<string, unknown> | undefined) ?? {}
  const count = typeof prev.write_count === 'number' ? prev.write_count : 0

  if (count >= cap) return { allowed: false, count }

  const nextCount = count + 1
  await supabase
    .from('conversations')
    .update({ memory: { ...memory, commerce: { ...prev, write_count: nextCount } } })
    .eq('id', conversationId)
    .eq('org_id', orgId)

  return { allowed: true, count: nextCount }
}
