// src/lib/medusa/cart-sig.ts
// Sign helper for the cart adoption sig (contract §3/§6). This is the SIGN
// counterpart to context.ts's `hmacKey` (which imports its CryptoKey with
// ['verify'] only — a verify-only key cannot crypto.subtle.sign). Byte-proven
// cross-repo agreement with stuscle's `verifyCartSig`:
//   createHmac('sha256', secret).update(cartId).digest('hex')
// See .planning/research/INTEGRATION-CONTRACT.md §3/§6 and 134-RESEARCH.md
// "The adoption sig".
//
// CRITICAL and load-bearing — do NOT "simplify" any of these:
//   1. key usage is ['sign'] (NOT ['verify'] like context.ts's hmacKey).
//   2. do NOT hex-decode the connection token — it is not a hex string
//      (same trap documented in context.ts's hmacKey).
//   3. do NOT strip the `xph_` prefix.
//   4. output is lowercase HEX, not base64url (unlike the context token's
//      sig, which IS base64url — this is the one difference between the two
//      conventions).
// Same raw-UTF8 key convention as Phase 133's context.ts hmacKey.

const encoder = new TextEncoder()

/**
 * `xphere_sig = hex(HMAC_SHA256(key = raw-UTF8 bytes of secret, message = raw
 * cart_id string))`. Cross-repo proof (134-RESEARCH.md): for
 * secret="xph_test_connection_token_abc123", cartId="cart_01ABC" this
 * produces "f770a654c88db78fceabc6c9aab50149a4209d1b990162085084fd92d53c5a46"
 * — the exact bytes stuscle's verifyCartSig recomputes.
 */
export async function signCartSig(secret: string, cartId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'], // NOTE: 'sign', not 'verify'
  )
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(cartId))
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
