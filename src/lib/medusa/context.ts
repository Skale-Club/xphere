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
