// SSRF guard for workflow-authored outbound HTTP (http_request node).
//
// A workflow's http_request URL is authored by an org member and can point
// anywhere — including cloud metadata endpoints (169.254.169.254), loopback,
// and private RFC1918 ranges. Any authenticated member could otherwise use a
// workflow to reach internal services. This module rejects non-public targets
// BEFORE the request is issued.
//
// Note: we resolve the hostname and check the resolved address, which closes
// the obvious "DNS points at an internal IP" vector. A determined attacker can
// still attempt DNS-rebinding (resolve public here, re-resolve private at
// fetch time); pinning the connection to the vetted IP would require a custom
// agent. The resolve-and-check below is the pragmatic mitigation for the
// authenticated-member threat model.

import { lookup } from 'node:dns/promises'
import net from 'node:net'

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata',
])

/** True for loopback / private / link-local / reserved addresses (IPv4 + IPv6). */
export function isPrivateAddress(ip: string): boolean {
  const family = net.isIP(ip)
  if (family === 4) return isPrivateIPv4(ip)
  if (family === 6) return isPrivateIPv6(ip)
  return true // not a parseable IP → treat as unsafe
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p))
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true
  }
  const [a, b] = parts
  if (a === 0) return true // 0.0.0.0/8 "this host"
  if (a === 10) return true // 10.0.0.0/8
  if (a === 127) return true // loopback
  if (a === 169 && b === 254) return true // link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 192 && b === 168) return true // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 CGNAT
  if (a >= 224) return true // multicast + reserved
  return false
}

function isPrivateIPv6(ip: string): boolean {
  const addr = ip.toLowerCase().split('%')[0] // strip zone id
  if (addr === '::1' || addr === '::') return true
  // IPv4-mapped (::ffff:a.b.c.d) → validate the embedded IPv4.
  const mapped = addr.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isPrivateIPv4(mapped[1])
  if (addr.startsWith('fe80')) return true // link-local
  if (addr.startsWith('fc') || addr.startsWith('fd')) return true // unique local fc00::/7
  if (addr.startsWith('ff')) return true // multicast
  return false
}

/**
 * Validate an outbound workflow URL. Throws with a descriptive message when the
 * target is not a public http(s) endpoint. Returns the parsed URL on success.
 */
export async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('http_request: invalid url')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`http_request: unsupported scheme "${url.protocol}" (only http/https allowed)`)
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new Error(`http_request: blocked host "${host}"`)
  }

  const addresses: string[] = []
  if (net.isIP(host)) {
    addresses.push(host)
  } else {
    let resolved: Array<{ address: string }>
    try {
      resolved = await lookup(host, { all: true })
    } catch {
      throw new Error(`http_request: could not resolve host "${host}"`)
    }
    if (resolved.length === 0) throw new Error(`http_request: could not resolve host "${host}"`)
    for (const r of resolved) addresses.push(r.address)
  }

  for (const ip of addresses) {
    if (isPrivateAddress(ip)) {
      throw new Error(`http_request: blocked private/internal address (${ip}) for host "${host}"`)
    }
  }

  return url
}
