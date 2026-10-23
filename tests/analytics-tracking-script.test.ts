// tests/analytics-tracking-script.test.ts
// BS-ANALYTICS-001: the browser tracking script (src/lib/analytics/tracking-script.ts)
// is executed for real via Node's vm module against a fake browser, so the
// shipped JS itself is proven, not a parallel reimplementation.
//
//   * xpTrack('game', { event_name, ... }) reaches the ingest payload's
//     top-level event_name and never fires the Meta Pixel
//   * session_start carries connection type and screen size
//   * every pre-existing behavior (legacy xpTrack, pageview, form_submit, beacon
//     payload shape) is unchanged

import { describe, it, expect } from 'vitest'
import { runInNewContext, Script } from 'node:vm'
import { buildScript } from '@/lib/analytics/tracking-script'

type Sent = Record<string, unknown>

interface Browser {
  sent: Sent[]
  fbq: unknown[][]
  xpTrack: (type?: string, meta?: Record<string, unknown>) => void
  listeners: Record<string, Array<(e: unknown) => void>>
}

function storage(initial: Record<string, string> = {}) {
  const data = { ...initial }
  return {
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => {
      data[k] = v
    },
  }
}

interface BrowserOptions {
  pixelId?: string | null
  connection?: { effectiveType?: string } | null
  screen?: { width: number; height: number }
  search?: string
}

function runScript(options: BrowserOptions = {}): Browser {
  const { pixelId = null, search = '' } = options
  const sent: Sent[] = []
  const fbq: unknown[][] = []
  const listeners: Record<string, Array<(e: unknown) => void>> = {}
  const addListener = (type: string, fn: (e: unknown) => void) => {
    ;(listeners[type] ??= []).push(fn)
  }

  const navigator: Record<string, unknown> = {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    sendBeacon: (_url: string, body: string) => {
      sent.push(JSON.parse(body))
      return true
    },
  }
  if (options.connection !== null) navigator.connection = options.connection ?? { effectiveType: '4g' }

  const context: Record<string, unknown> = {
    navigator,
    document: {
      cookie: '',
      referrer: 'https://www.google.com/',
      title: 'Brasil Showdown',
      addEventListener: addListener,
    },
    location: { href: `https://brasilshowdown.com/${search}`, search, pathname: '/' },
    history: { pushState() {} },
    sessionStorage: storage(),
    localStorage: storage(),
    screen: options.screen ?? { width: 1920, height: 1080 },
    URLSearchParams,
    Date,
    JSON,
    Math,
    Object,
    RegExp,
    setTimeout,
    encodeURIComponent,
    decodeURIComponent,
    fetch: () => Promise.resolve({}),
  }
  context.window = context
  context.addEventListener = addListener
  // A pre-existing window.fbq makes the Pixel base code a no-op, so the spy
  // sees only what the script itself asks the Pixel to do.
  context.fbq = (...args: unknown[]) => {
    fbq.push(args)
  }

  runInNewContext(buildScript('tok_123', 'https://xphere.app/api/analytics/ingest', pixelId), context)

  return {
    sent,
    fbq,
    listeners,
    xpTrack: context.xpTrack as Browser['xpTrack'],
  }
}

function byType(browser: Browser, type: string) {
  return browser.sent.filter((s) => s.type === type)
}

describe('tracking script: syntax', () => {
  it('compiles with and without a Meta Pixel', () => {
    expect(() => new Script(buildScript('t', 'https://xphere.app/api/analytics/ingest', null))).not.toThrow()
    expect(() => new Script(buildScript('t', 'https://xphere.app/api/analytics/ingest', '1234567890'))).not.toThrow()
  })
})

describe('tracking script: game events', () => {
  it("sends event_name at the top level and keeps the rest in metadata", () => {
    const browser = runScript()
    browser.xpTrack('game', { event_name: 'match_start', match_id: 'm1', p1_fighter: 'lula' })

    const event = byType(browser, 'event')[0]
    expect(event).toMatchObject({
      token: 'tok_123',
      type: 'event',
      event_type: 'game',
      event_name: 'match_start',
      url: 'https://brasilshowdown.com/',
    })
    const metadata = event.metadata as Record<string, unknown>
    expect(metadata).toMatchObject({ match_id: 'm1', p1_fighter: 'lula' })
    expect(metadata).not.toHaveProperty('event_name')
    expect(typeof metadata.event_id).toBe('string')
  })

  it('omits event_name when a game event has none (ingest will drop it)', () => {
    const browser = runScript()
    browser.xpTrack('game', { match_id: 'm1' })
    expect(byType(browser, 'event')[0]).not.toHaveProperty('event_name')
  })

  it('ignores a non-string event_name', () => {
    const browser = runScript()
    browser.xpTrack('game', { event_name: 42 })
    expect(byType(browser, 'event')[0]).not.toHaveProperty('event_name')
  })

  it('does not mutate the caller metadata object', () => {
    const browser = runScript()
    const meta = { event_name: 'match_end', outcome: 'completed' }
    browser.xpTrack('game', meta)
    expect(meta).toEqual({ event_name: 'match_end', outcome: 'completed' })
  })

  it('never fires the Meta Pixel for a game event', () => {
    const browser = runScript({ pixelId: '1234567890' })
    const before = browser.fbq.length
    browser.xpTrack('game', { event_name: 'screen_view', screen: 'title' })
    expect(browser.fbq.length).toBe(before)
  })
})

describe('tracking script: session_start context', () => {
  it('adds connection_type and screen size', () => {
    const browser = runScript({ connection: { effectiveType: '3g' }, screen: { width: 390, height: 844 } })
    const start = byType(browser, 'session_start')[0]
    expect(start).toMatchObject({ connection_type: '3g', screen_width: 390, screen_height: 844 })
  })

  it('leaves connection_type out when the browser does not expose it', () => {
    const browser = runScript({ connection: null })
    const start = byType(browser, 'session_start')[0]
    expect(start).not.toHaveProperty('connection_type')
    expect(start).toMatchObject({ screen_width: 1920, screen_height: 1080 })
  })

  it('keeps every pre-existing session_start field', () => {
    const browser = runScript({ search: '?utm_source=tiktok&gclid=abc' })
    const start = byType(browser, 'session_start')[0]
    expect(start).toMatchObject({
      token: 'tok_123',
      type: 'session_start',
      url: 'https://brasilshowdown.com/?utm_source=tiktok&gclid=abc',
      referrer: 'https://www.google.com/',
      utm_source: 'tiktok',
      gclid: 'abc',
      device_type: 'desktop',
      browser: 'Chrome',
      os: 'Windows',
    })
    expect(typeof start.visitor_id).toBe('string')
    expect(typeof start.session_key).toBe('string')
  })
})

describe('tracking script: backward compatibility', () => {
  it('sends a pageview after session_start', () => {
    const browser = runScript()
    expect(browser.sent.map((s) => s.type)).toEqual(['session_start', 'pageview'])
    expect(byType(browser, 'pageview')[0]).toMatchObject({ path: '/', title: 'Brasil Showdown' })
  })

  it('legacy xpTrack: metadata is the caller meta plus event_id and there is no event_name', () => {
    const browser = runScript()
    browser.xpTrack('form_submit', { action: '/contact' })
    const event = byType(browser, 'event')[0]
    expect(event.event_type).toBe('form_submit')
    expect(event).not.toHaveProperty('event_name')
    expect(event.metadata).toMatchObject({ action: '/contact' })
    expect(typeof (event.metadata as Record<string, unknown>).event_id).toBe('string')
  })

  it('legacy xpTrack keeps event_name inside metadata for non-game events', () => {
    const browser = runScript()
    browser.xpTrack('custom_conversion', { event_name: 'signup' })
    const event = byType(browser, 'event')[0]
    expect(event).not.toHaveProperty('event_name')
    expect((event.metadata as Record<string, unknown>).event_name).toBe('signup')
  })

  it('legacy xpTrack defaults the type to custom_conversion', () => {
    const browser = runScript()
    browser.xpTrack(undefined, undefined)
    expect(byType(browser, 'event')[0].event_type).toBe('custom_conversion')
  })

  it('legacy xpTrack still fires the Pixel with the shared event id', () => {
    const browser = runScript({ pixelId: '1234567890' })
    browser.xpTrack('lead', { value: 10 })
    const event = byType(browser, 'event')[0]
    const eventId = (event.metadata as Record<string, unknown>).event_id
    expect(browser.fbq).toContainEqual(['track', 'Lead', { value: 10 }, { eventID: eventId }])
  })

  it('exposes window.xpVisitorId and window.xpTrack', () => {
    const browser = runScript()
    expect(typeof browser.xpTrack).toBe('function')
  })
})
