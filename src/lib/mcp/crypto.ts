// Web-Crypto helpers used by the MCP OAuth layer.
// One-way SHA-256 hashing (for tokens we only need to compare, never display)
// + opaque token generators. Edge-runtime safe | uses Web Crypto only.

const HEX_CHARS = '0123456789abcdef'

function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]
    out += HEX_CHARS[(b >>> 4) & 0x0f] + HEX_CHARS[b & 0x0f]
  }
  return out
}

function bytesToBase64Url(bytes: Uint8Array): string {
  const b64 = btoa(String.fromCharCode(...bytes))
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return bytesToHex(new Uint8Array(digest))
}

/**
 * Generates a 256-bit random token in base64url (no padding).
 * Used for authorization codes, access tokens and refresh tokens.
 */
export function randomOpaqueToken(byteLen = 32): string {
  const bytes = new Uint8Array(byteLen)
  crypto.getRandomValues(bytes)
  return bytesToBase64Url(bytes)
}

/**
 * Generates a public client identifier in the form mcp_client_<hex>.
 */
export function randomClientId(): string {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return `mcp_client_${bytesToHex(bytes)}`
}

/**
 * Computes PKCE S256 challenge from a verifier (RFC 7636).
 */
export async function computeS256Challenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return bytesToBase64Url(new Uint8Array(digest))
}
