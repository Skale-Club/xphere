// SSRF-safe page fetch for the SEO crawler.
//
// The crawler fetches URLs an org member typed in — and every URL those pages
// link or redirect to — from inside the box that hosts our other containers.
// Two layers keep it on the public internet:
//
//   1. Every hop (the first request and each redirect Location) goes through
//      `assertPublicHttpUrl`, which rejects bad schemes, blocked hostnames and
//      hosts that resolve to private space.
//   2. The connection itself uses a dispatcher whose DNS `lookup` re-checks
//      the address it is about to connect to. Layer 1 alone is open to DNS
//      rebinding (resolve public for the check, private for the connect);
//      validating inside `lookup` closes that, because the vetted address IS
//      the connected address.
//
// Redirects are followed manually (max 5) so each hop is recorded and checked.

import dns from 'node:dns'
import { gunzipSync } from 'node:zlib'
import { Agent, fetch as undiciFetch } from 'undici'
import { assertPublicHttpUrl, isPrivateAddress } from '@/lib/flows/url-guard'
import { CRAWLER_UA_TOKEN } from './robots'

export const CRAWLER_USER_AGENT = `Mozilla/5.0 (compatible; ${CRAWLER_UA_TOKEN}/1.0; +https://xphere.app/bot)`

const MAX_REDIRECTS = 5
const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void

/**
 * `lookup` for the crawler's sockets: resolves normally, then refuses to hand
 * back any private/internal address. Exported for tests.
 */
export function guardedLookup(hostname: string, options: dns.LookupOptions, callback: LookupCallback): void {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, [])
    const list = addresses as dns.LookupAddress[]
    const blocked = list.find((a) => isPrivateAddress(a.address))
    if (!list.length || blocked) {
      const e: NodeJS.ErrnoException = new Error(
        `Blocked connection to non-public address ${blocked?.address ?? '(none)'} for ${hostname}`,
      )
      e.code = 'ESSRFBLOCKED'
      return callback(e, [])
    }
    if (options.all) return callback(null, list)
    callback(null, list[0].address, list[0].family)
  })
}

let dispatcher: Agent | null = null
function crawlerDispatcher(): Agent {
  dispatcher ??= new Agent({
    connect: { lookup: guardedLookup as never, timeout: 10_000 },
    keepAliveTimeout: 10_000,
    connections: 8,
  })
  return dispatcher
}

export interface RedirectHop {
  url: string
  status: number
}

export type FetchPageResult =
  | {
      ok: true
      /** Requested URL. */
      url: string
      /** URL that produced the final response (== url when not redirected). */
      finalUrl: string
      /** Every 3xx hop, in order. Empty when not redirected. */
      redirects: RedirectHop[]
      status: number
      headers: Record<string, string>
      contentType: string
      /** Body text; only read for HTML/XML/text responses. */
      body: string | null
      bytes: number
      /** True when the body was cut at maxBytes. */
      truncated: boolean
      ttfbMs: number
    }
  | { ok: false; url: string; error: string; blocked: boolean; redirects: RedirectHop[] }

export interface FetchPageOptions {
  timeoutMs?: number
  maxBytes?: number
  /** Follow 3xx hops (default true). */
  followRedirects?: boolean
  method?: 'GET' | 'HEAD'
  /** Read the body whatever the content type and gunzip it when it is gzip (sitemap.xml.gz). */
  gunzip?: boolean
}

export async function fetchPage(rawUrl: string, opts: FetchPageOptions = {}): Promise<FetchPageResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES
  const follow = opts.followRedirects ?? true
  const redirects: RedirectHop[] = []
  const signal = AbortSignal.timeout(timeoutMs)

  let current: URL
  try {
    current = await assertPublicHttpUrl(rawUrl)
  } catch (err) {
    return { ok: false, url: rawUrl, error: describeError(err), blocked: true, redirects }
  }

  try {
    for (let hop = 0; ; hop++) {
      const started = Date.now()
      const res = await undiciFetch(current, {
        method: opts.method ?? 'GET',
        redirect: 'manual',
        signal,
        dispatcher: crawlerDispatcher(),
        headers: {
          'user-agent': CRAWLER_USER_AGENT,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5',
          'accept-language': 'en-US,en;q=0.8,pt-BR;q=0.6',
        },
      })
      const ttfbMs = Date.now() - started

      if (follow && res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        await res.body?.cancel().catch(() => {})
        redirects.push({ url: current.toString(), status: res.status })
        if (hop >= MAX_REDIRECTS) {
          return { ok: false, url: rawUrl, error: `More than ${MAX_REDIRECTS} redirects`, blocked: false, redirects }
        }
        const next = new URL(res.headers.get('location')!, current).toString()
        try {
          current = await assertPublicHttpUrl(next)
        } catch (err) {
          return { ok: false, url: rawUrl, error: describeError(err), blocked: true, redirects }
        }
        continue
      }

      const headers: Record<string, string> = {}
      res.headers.forEach((value, key) => {
        headers[key] = value
      })
      const contentType = (headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
      const readable =
        opts.method !== 'HEAD' && (opts.gunzip || /html|xml|text\/plain|json/.test(contentType || 'text/html'))

      let body: string | null = null
      let bytes = 0
      let truncated = false
      if (readable && res.body) {
        const read = await readCapped(res.body as ReadableStream<Uint8Array>, maxBytes)
        bytes = read.buffer.byteLength
        truncated = read.truncated
        const gzipped = read.buffer[0] === 0x1f && read.buffer[1] === 0x8b
        body =
          opts.gunzip && gzipped && !truncated
            ? gunzipSync(read.buffer, { maxOutputLength: maxBytes * 10 }).toString('utf8')
            : read.buffer.toString('utf8')
      } else {
        await res.body?.cancel().catch(() => {})
        bytes = Number(headers['content-length']) || 0
      }

      return {
        ok: true,
        url: rawUrl,
        finalUrl: current.toString(),
        redirects,
        status: res.status,
        headers,
        contentType,
        body,
        bytes,
        truncated,
        ttfbMs,
      }
    }
  } catch (err) {
    const blocked = (err as { cause?: { code?: string } })?.cause?.code === 'ESSRFBLOCKED'
    return { ok: false, url: rawUrl, error: describeError(err), blocked, redirects }
  }
}

async function readCapped(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<{ buffer: Buffer; truncated: boolean }> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  let truncated = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      chunks.push(value.subarray(0, value.byteLength - (total - maxBytes)))
      truncated = true
      await reader.cancel().catch(() => {})
      break
    }
    chunks.push(value)
  }
  return { buffer: Buffer.concat(chunks), truncated }
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'Timed out'
    const cause = (err as { cause?: { code?: string; message?: string } }).cause
    if (cause?.code === 'ESSRFBLOCKED') return cause.message ?? 'Blocked non-public address'
    if (cause?.code) return `${cause.code}${cause.message ? `: ${cause.message}` : ''}`
    return err.message.replace(/^http_request:\s*/, '')
  }
  return String(err)
}
