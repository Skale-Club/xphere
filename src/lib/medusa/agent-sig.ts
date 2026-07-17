// src/lib/medusa/agent-sig.ts
// Sign helper for the privileged /agent/* surface (contract §4.2). Same
// raw-UTF8 key convention as cart-sig.ts's signCartSig; the ONLY difference
// is the message — `${ts}.${rawBody}` instead of a bare cartId. Byte-proven
// cross-repo agreement with stuscle's verify-hmac.ts:
//   const expected = "v1=" + createHmac("sha256", secret).update(`${ts}.${rawStr}`).digest("hex")
// See .planning/research/INTEGRATION-CONTRACT.md §4.2 and 135-RESEARCH.md.
//
// CRITICAL and load-bearing — do NOT "simplify" any of these:
//   1. key usage is ['sign'] (same as cart-sig.ts, NOT context.ts's ['verify']).
//   2. do NOT hex-decode the connection token — it is not a hex string.
//   3. do NOT strip the `xph_` prefix.
//   4. returns BARE lowercase hex — this file NEVER prepends `v1=`. The ONLY
//      place that writes the `v1=` scheme tag is medusaAgentFetch (client.ts).

const encoder = new TextEncoder()

/**
 * `signAgentBody = hex(HMAC_SHA256(key = raw-UTF8 bytes of secret, message =
 * "${ts}.${rawBody}"))`. Cross-repo proof (135-RESEARCH.md): for
 * secret="test-secret", ts="1750000000", rawBody='{"a":1}' this produces
 * "1f11cf9a5d34d98061ca60891c660610b83d4a229b90d9c84c4f47fd5bff50c4" — the
 * exact bytes stuscle's verify-hmac.ts recomputes.
 */
export async function signAgentBody(secret: string, ts: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'], // NOTE: 'sign', not 'verify'
  )
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(`${ts}.${rawBody}`))
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
