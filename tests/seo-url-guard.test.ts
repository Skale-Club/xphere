import dns from 'node:dns'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/flows/url-guard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/flows/url-guard')>()
  return { ...actual, assertPublicHttpUrl: vi.fn(actual.assertPublicHttpUrl) }
})

import { assertPublicHttpUrl } from '@/lib/flows/url-guard'
import { fetchPage, guardedLookup } from '@/lib/seo/fetch-page'

describe('seo crawler SSRF guard', () => {
  let server: http.Server
  let port: number

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/to-metadata') {
        res.writeHead(301, { location: 'http://169.254.169.254/latest/meta-data/' })
        return res.end()
      }
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html><title>internal</title></html>')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  })

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))
  afterEach(() => vi.restoreAllMocks())

  it('refuses loopback, private and metadata targets up front', async () => {
    for (const url of [
      `http://127.0.0.1:${port}/`,
      'http://localhost/',
      'http://10.1.2.3/',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]/',
      'file:///etc/passwd',
    ]) {
      const res = await fetchPage(url)
      expect(res.ok, url).toBe(false)
      if (!res.ok) expect(res.blocked, url).toBe(true)
    }
  })

  it('re-checks every redirect hop', async () => {
    // Let the first hop through (standing in for a public site), then the
    // site redirects to the cloud metadata IP: the second hop must be refused.
    const guard = vi.mocked(assertPublicHttpUrl)
    guard.mockClear()
    guard.mockImplementationOnce(async (u: string) => new URL(u))

    const res = await fetchPage(`http://127.0.0.1:${port}/to-metadata`, { timeoutMs: 5000 })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.blocked).toBe(true)
      expect(res.redirects).toEqual([{ url: `http://127.0.0.1:${port}/to-metadata`, status: 301 }])
    }
    expect(guard).toHaveBeenCalledTimes(2)
    expect(String(guard.mock.calls[1][0])).toContain('169.254.169.254')
  })

  it('blocks DNS rebinding at connect time', () => {
    // The connect-time lookup returns a private address even though the
    // pre-check saw a public one: the socket must refuse it.
    const cb = vi.fn()
    vi.spyOn(dns, 'lookup').mockImplementation(((_h: string, _o: unknown, done: (...a: unknown[]) => void) =>
      done(null, [{ address: '127.0.0.1', family: 4 }])) as never)
    guardedLookup('rebind.test', {}, cb)
    expect(cb).toHaveBeenCalledTimes(1)
    const [err] = cb.mock.calls[0]
    expect(err?.code).toBe('ESSRFBLOCKED')
  })

  it('lets public addresses through at connect time', () => {
    const cb = vi.fn()
    vi.spyOn(dns, 'lookup').mockImplementation(((_h: string, _o: unknown, done: (...a: unknown[]) => void) =>
      done(null, [{ address: '93.184.216.34', family: 4 }])) as never)
    guardedLookup('example.com', {}, cb)
    expect(cb).toHaveBeenCalledWith(null, '93.184.216.34', 4)
  })
})
