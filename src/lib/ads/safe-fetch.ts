// Fetch a user/AI-supplied media URL from the server, safely.
//
// meta.media.upload_image downloads an image the caller points at and relays
// the bytes to Meta. The URL comes from an MCP client or the dashboard, so an
// unguarded fetch is a server-side request forgery primitive: "upload
// http://169.254.169.254/latest/meta-data" or "http://localhost:6379". This
// module only follows https URLs whose host resolves exclusively to public
// addresses — re-checked on every redirect hop — and caps size and time.

import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export class SafeFetchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SafeFetchError'
  }
}

const MAX_REDIRECTS = 3

/** Private, loopback, link-local, CGNAT, multicast, reserved — anything not on the public internet. */
export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number)
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    )
  }
  const v6 = address.toLowerCase()
  if (v6 === '::' || v6 === '::1') return true
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7))
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v6)
}

async function assertPublicHttps(raw: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new SafeFetchError('Not a valid URL')
  }
  if (url.protocol !== 'https:') throw new SafeFetchError('Only https URLs are accepted')
  if (url.username || url.password) throw new SafeFetchError('URLs with credentials are not accepted')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address)
  if (addresses.length === 0) throw new SafeFetchError(`Could not resolve ${host}`)
  if (addresses.some(isPrivateAddress)) throw new SafeFetchError(`${host} resolves to a non-public address`)
  return url
}

export async function safeFetchBytes(
  raw: string,
  opts: { maxBytes: number; timeoutMs?: number; accept?: RegExp },
): Promise<{ bytes: Buffer; contentType: string; finalUrl: string }> {
  let current = await assertPublicHttps(raw)
  const deadline = AbortSignal.timeout(opts.timeoutMs ?? 30_000)

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(current, { redirect: 'manual', signal: deadline, cache: 'no-store' })
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location')
      if (!next) throw new SafeFetchError('Redirect without a location')
      current = await assertPublicHttps(new URL(next, current).toString())
      continue
    }
    if (!res.ok) throw new SafeFetchError(`Fetching the file failed with HTTP ${res.status}`)

    const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (opts.accept && !opts.accept.test(contentType)) {
      throw new SafeFetchError(`Unexpected content type ${contentType || '(none)'}`)
    }
    const declared = Number(res.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > opts.maxBytes) {
      throw new SafeFetchError(`File is larger than ${Math.round(opts.maxBytes / 1_048_576)} MB`)
    }

    const reader = res.body?.getReader()
    if (!reader) throw new SafeFetchError('Empty response body')
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > opts.maxBytes) {
        await reader.cancel()
        throw new SafeFetchError(`File is larger than ${Math.round(opts.maxBytes / 1_048_576)} MB`)
      }
      chunks.push(value)
    }
    return { bytes: Buffer.concat(chunks), contentType, finalUrl: current.toString() }
  }
  throw new SafeFetchError('Too many redirects')
}

/** Resolve-only check for URLs the platform fetches itself (Meta video file_url). */
export async function assertPublicHttpsUrl(raw: string): Promise<void> {
  await assertPublicHttps(raw)
}
