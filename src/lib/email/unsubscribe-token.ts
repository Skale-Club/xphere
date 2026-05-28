// src/lib/email/unsubscribe-token.ts
// Stateless signed token for email unsubscribe links. Encodes { orgId, email }
// and an HMAC-SHA256 signature so the public /unsubscribe route can trust the
// payload without a per-send DB row. Web Crypto only (Edge Runtime safe).
//
// Reuses ENCRYPTION_SECRET (same 64-char hex as src/lib/crypto.ts) as the HMAC
// key — we never modify crypto.ts, just borrow its secret here.

const encoder = new TextEncoder()

function b64urlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>
}

async function hmacKey(): Promise<CryptoKey> {
  const secret = process.env.ENCRYPTION_SECRET
  if (!secret || !/^[0-9a-fA-F]{64}$/.test(secret)) {
    throw new Error('ENCRYPTION_SECRET must be a 64-character hex string')
  }
  const keyBytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++) keyBytes[i] = parseInt(secret.slice(i * 2, i * 2 + 2), 16)
  return crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])
}

interface UnsubPayload {
  o: string // orgId
  e: string // email (lowercased)
}

/** Build a `<payload>.<sig>` token (both base64url). */
export async function signUnsubscribeToken(orgId: string, email: string): Promise<string> {
  const payload: UnsubPayload = { o: orgId, e: email.trim().toLowerCase() }
  const payloadB64 = b64urlEncode(encoder.encode(JSON.stringify(payload)))
  const key = await hmacKey()
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadB64))
  return `${payloadB64}.${b64urlEncode(new Uint8Array(sig))}`
}

/** Verify a token and return { orgId, email } or null when invalid/tampered. */
export async function verifyUnsubscribeToken(
  token: string,
): Promise<{ orgId: string; email: string } | null> {
  try {
    const dot = token.indexOf('.')
    if (dot === -1) return null
    const payloadB64 = token.slice(0, dot)
    const sigB64 = token.slice(dot + 1)
    const key = await hmacKey()
    const ok = await crypto.subtle.verify(
      'HMAC',
      key,
      b64urlDecode(sigB64),
      encoder.encode(payloadB64),
    )
    if (!ok) return null
    const parsed = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64))) as UnsubPayload
    if (!parsed?.o || !parsed?.e) return null
    return { orgId: parsed.o, email: parsed.e }
  } catch {
    return null
  }
}
