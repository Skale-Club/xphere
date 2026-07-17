// @vitest-environment jsdom
// Phase 4 widget unit tests — RED until src/widget/index.ts is implemented in Plan 02

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

const DEFAULT_WIDGET_CONFIG = {
  displayName: 'AI Assistant',
  primaryColor: '#18181B',
  welcomeMessage: 'Hi! How can I help?',
}

// jsdom's localStorage may not implement all methods — use a Map-based mock
const localStorageMock = (() => {
  let store: Map<string, string> = new Map()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store = new Map() },
    get length() { return store.size },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
  }
})()

vi.stubGlobal('localStorage', localStorageMock)

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

// Compatibility wrapper — clears our mock
function clearLocalStorage(): void {
  localStorageMock.clear()
}

// Helper: evaluate the built widget script in the jsdom environment
// The widget is an IIFE — evaluating it triggers init.
function loadWidget(token: string, scriptSrc: string): void {
  // Set up document.currentScript mock BEFORE evaluating widget
  const scriptEl = document.createElement('script')
  scriptEl.setAttribute('data-token', token)
  scriptEl.src = scriptSrc
  Object.defineProperty(document, 'currentScript', {
    value: scriptEl,
    configurable: true,
    writable: true,
  })

  const WIDGET_PATH = resolve(process.cwd(), 'public', 'widget.js')
  if (!existsSync(WIDGET_PATH)) {
    throw new Error('public/widget.js not found — run npm run build:widget first')
  }
  const code = readFileSync(WIDGET_PATH, 'utf-8')
  // Evaluate widget IIFE in jsdom context
  // eslint-disable-next-line no-eval
  eval(code)
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function getShadowRoot(): ShadowRoot {
  const host = document.getElementById('opps-root')
  expect(host).not.toBeNull()
  expect(host!.shadowRoot).not.toBeNull()
  return host!.shadowRoot!
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('Widget — token extraction and init guard (WIDGET-02, WIDGET-04)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    clearLocalStorage()
    fetchMock.mockReset()
    // Remove any existing opps-root
    document.getElementById('opps-root')?.remove()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.getElementById('opps-root')?.remove()
  })

  it('reads data-token from the script element before any async boundary', () => {
    // Widget must not error when token is present
    expect(() => loadWidget('test-token-123', 'https://example.com/widget.js')).not.toThrow()
  })

  it('creates div#opps-root in document.body on init', () => {
    loadWidget('test-token-123', 'https://example.com/widget.js')
    expect(document.getElementById('opps-root')).not.toBeNull()
  })

  it('does not create a second opps-root if already initialized (double-init guard)', () => {
    loadWidget('test-token-123', 'https://example.com/widget.js')
    loadWidget('test-token-123', 'https://example.com/widget.js')
    const roots = document.querySelectorAll('#opps-root')
    expect(roots.length).toBe(1)
  })

  it('does not init if data-token is missing', () => {
    const scriptEl = document.createElement('script')
    scriptEl.src = 'https://example.com/widget.js'
    // No data-token set
    Object.defineProperty(document, 'currentScript', {
      value: scriptEl,
      configurable: true,
      writable: true,
    })
    const WIDGET_PATH = resolve(process.cwd(), 'public', 'widget.js')
    if (!existsSync(WIDGET_PATH)) throw new Error('public/widget.js not found')
    const code = readFileSync(WIDGET_PATH, 'utf-8')
    // eslint-disable-next-line no-eval
    eval(code)
    expect(document.getElementById('opps-root')).toBeNull()
  })
})

describe('Widget — session localStorage (WIDGET-05, D-12, D-13)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    clearLocalStorage()
    fetchMock.mockReset()
    document.getElementById('opps-root')?.remove()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.getElementById('opps-root')?.remove()
  })

  it('reads existing sessionId from localStorage using opps_{token}_sessionId key', () => {
    const token = 'test-token-abc'
    const storageKey = `opps_${token}_sessionId`
    localStorage.setItem(storageKey, 'existing-session-uuid')

    // Widget init should not throw even when sessionId exists in localStorage
    expect(() => loadWidget(token, 'https://example.com/widget.js')).not.toThrow()
  })

  it('does not throw when localStorage is inaccessible (private browsing simulation)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError: The operation is insecure.')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('SecurityError: The operation is insecure.')
    })
    expect(() => loadWidget('test-token-xyz', 'https://example.com/widget.js')).not.toThrow()
  })
})

describe('Widget — Shadow DOM isolation (WIDGET-03, D-01, D-02)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    clearLocalStorage()
    fetchMock.mockReset()
    document.getElementById('opps-root')?.remove()
  })

  afterEach(() => {
    document.getElementById('opps-root')?.remove()
  })

  it('attaches a shadow root to div#opps-root', () => {
    loadWidget('test-token-123', 'https://example.com/widget.js')
    const host = document.getElementById('opps-root')
    expect(host).not.toBeNull()
    expect(host!.shadowRoot).not.toBeNull()
  })

  it('renders a style element inside the shadow root (inline CSS, no external sheet)', () => {
    loadWidget('test-token-123', 'https://example.com/widget.js')
    const host = document.getElementById('opps-root')!
    const shadow = host.shadowRoot!
    const styles = shadow.querySelectorAll('style')
    expect(styles.length).toBeGreaterThan(0)
  })
})

describe('Widget — commerce re-dispatch bundle assertion (CRT-04)', () => {
  it('the built public/widget.js contains the xphere:commerce re-dispatch', () => {
    const WIDGET_PATH = resolve(process.cwd(), 'public', 'widget.js')
    if (!existsSync(WIDGET_PATH)) throw new Error('public/widget.js not found — run npm run build:widget first')
    const code = readFileSync(WIDGET_PATH, 'utf-8')
    expect(code).toContain('xphere:commerce')
  })
})

describe('Widget — runtime config hydration and fallback (ADMIN-01)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    clearLocalStorage()
    fetchMock.mockReset()
    document.getElementById('opps-root')?.remove()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.getElementById('opps-root')?.remove()
  })

  it('hydrates display name, primary color, and welcome message from the public config endpoint', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        displayName: 'Skale Concierge',
        primaryColor: '#22C55E',
        welcomeMessage: 'Welcome to Skale!',
      })
    )

    loadWidget('config-token', 'https://example.com/widget.js')
    await flushAsyncWork()

    const host = document.getElementById('opps-root') as HTMLDivElement
    const shadow = getShadowRoot()

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/api/widget/config-token/config?u=' + encodeURIComponent(location.href),
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
      }
    )
    expect(host.style.getPropertyValue('--opps-primary-color')).toBe('#22C55E')
    expect(shadow.querySelector('.opps-bot-name')?.textContent).toBe('Skale Concierge')
    expect(shadow.querySelector('.opps-avatar')?.textContent).toBe('S')
    expect(shadow.querySelector('.opps-empty-avatar')?.textContent).toBe('S')
    expect(shadow.querySelector('.opps-empty-heading')?.textContent).toBe('Welcome to Skale!')
  })

  it('falls back to Phase 4 defaults when the config request fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'))

    loadWidget('fallback-token', 'https://example.com/widget.js')
    await flushAsyncWork()

    const host = document.getElementById('opps-root') as HTMLDivElement
    const shadow = getShadowRoot()

    expect(host.style.getPropertyValue('--opps-primary-color')).toBe(DEFAULT_WIDGET_CONFIG.primaryColor)
    expect(shadow.querySelector('.opps-bot-name')?.textContent).toBe(DEFAULT_WIDGET_CONFIG.displayName)
    expect(shadow.querySelector('.opps-empty-heading')?.textContent).toBe(DEFAULT_WIDGET_CONFIG.welcomeMessage)
  })

  it('still shows the unavailable message when chat send returns 401 after config hydration', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(DEFAULT_WIDGET_CONFIG))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))

    loadWidget('invalid-token', 'https://example.com/widget.js')
    await flushAsyncWork()

    const shadow = getShadowRoot()
    const bubble = shadow.querySelector('.opps-bubble') as HTMLButtonElement
    bubble.click()

    const input = shadow.querySelector('.opps-input') as HTMLInputElement
    const sendBtn = shadow.querySelector('.opps-send') as HTMLButtonElement
    input.value = 'Hello there'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    sendBtn.click()
    await flushAsyncWork()

    const errorBubble = shadow.querySelector('.opps-bubble-error')
    expect(errorBubble?.textContent).toBe('This chat is unavailable right now.')
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://example.com/api/chat/invalid-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello there', pageUrl: location.href }),
    })
  })
})

describe('Widget — product cards renderer (UIX-01)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    clearLocalStorage()
    fetchMock.mockReset()
    document.getElementById('opps-root')?.remove()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.getElementById('opps-root')?.remove()
  })

  // Builds a Response whose body is a newline-delimited-JSON stream, mirroring
  // the real chat route's SSE-style NDJSON framing consumed by consumeStream().
  function ndjsonResponse(events: Record<string, unknown>[], status = 200): Response {
    const text = events.map((e) => JSON.stringify(e)).join('\n') + '\n'
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(text))
        controller.close()
      },
    })
    return new Response(stream, { status, headers: { 'Content-Type': 'application/x-ndjson' } })
  }

  async function loadAndOpen(token: string): Promise<{
    shadow: ShadowRoot
    input: HTMLInputElement
    sendBtn: HTMLButtonElement
  }> {
    fetchMock.mockResolvedValueOnce(jsonResponse(DEFAULT_WIDGET_CONFIG))
    loadWidget(token, 'https://example.com/widget.js')
    await flushAsyncWork()
    const shadow = getShadowRoot()
    const bubble = shadow.querySelector('.opps-bubble') as HTMLButtonElement
    bubble.click()
    const input = shadow.querySelector('.opps-input') as HTMLInputElement
    const sendBtn = shadow.querySelector('.opps-send') as HTMLButtonElement
    return { shadow, input, sendBtn }
  }

  function sendText(input: HTMLInputElement, sendBtn: HTMLButtonElement, text: string): void {
    input.value = text
    input.dispatchEvent(new Event('input', { bubbles: true }))
    sendBtn.click()
  }

  it('renders a .opps-cards block with one card (title/price via textContent, View anchor, Add button) after ui + done', async () => {
    const { shadow, input, sendBtn } = await loadAndOpen('cards-token')

    fetchMock.mockResolvedValueOnce(
      ndjsonResponse([
        { event: 'session', sessionId: 's1' },
        { event: 'token', text: 'Here you go' },
        {
          event: 'ui',
          component: 'product_cards',
          items: [
            {
              id: 'p1',
              variantId: 'v1',
              title: 'Sweatshirt',
              thumbnail: 'https://img/1.png',
              price: '€35.00',
              handle: 'sweatshirt',
              url: '/dk/products/sweatshirt',
            },
          ],
        },
        { event: 'done' },
      ])
    )
    sendText(input, sendBtn, 'Show me a sweatshirt')
    await flushAsyncWork()

    const cardsContainer = shadow.querySelector('.opps-cards')
    expect(cardsContainer).not.toBeNull()
    const cards = shadow.querySelectorAll('.opps-card')
    expect(cards.length).toBe(1)

    expect(shadow.querySelector('.opps-card-title')?.textContent).toBe('Sweatshirt')
    expect(shadow.querySelector('.opps-card-price')?.textContent).toBe('€35.00')

    const view = shadow.querySelector('.opps-card-view') as HTMLAnchorElement
    expect(view).not.toBeNull()
    expect(view.getAttribute('href')).toBe('/dk/products/sweatshirt')
    expect(view.getAttribute('target')).toBe('_top')
    expect(view.getAttribute('rel')).toBe('noopener')

    const addBtn = shadow.querySelector('.opps-card-add') as HTMLButtonElement
    expect(addBtn).not.toBeNull()

    fetchMock.mockResolvedValueOnce(ndjsonResponse([{ event: 'done' }]))
    addBtn.click()
    await flushAsyncWork()

    const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit]
    expect(lastCall[0]).toBe('https://example.com/api/chat/cards-token')
    const sentBody = JSON.parse(String(lastCall[1].body)) as { message: string }
    expect(sentBody.message).toContain('Add "Sweatshirt" to my cart')
  })

  it('renders a card with no url without a View anchor (graceful)', async () => {
    const { shadow, input, sendBtn } = await loadAndOpen('nourl-token')

    fetchMock.mockResolvedValueOnce(
      ndjsonResponse([
        {
          event: 'ui',
          component: 'product_cards',
          items: [
            { id: 'p2', variantId: 'v2', title: 'No URL Item', thumbnail: 'https://img/2.png', price: '€10.00', handle: 'no-url' },
          ],
        },
        { event: 'done' },
      ])
    )
    sendText(input, sendBtn, 'Show me something')
    await flushAsyncWork()

    expect(shadow.querySelector('.opps-cards')).not.toBeNull()
    expect(shadow.querySelector('.opps-card-view')).toBeNull()
  })

  it('ignores unknown ui component types -- no .opps-cards rendered, no error thrown (old-bundle degradation)', async () => {
    const { shadow, input, sendBtn } = await loadAndOpen('unknown-token')

    fetchMock.mockResolvedValueOnce(
      ndjsonResponse([
        { event: 'ui', component: 'something_else', items: [{ id: 'x' }] },
        { event: 'done' },
      ])
    )
    expect(() => sendText(input, sendBtn, 'Hello')).not.toThrow()
    await flushAsyncWork()

    expect(shadow.querySelector('.opps-cards')).toBeNull()
  })
})

describe('Widget — product-cards bundle assertion (UIX-01)', () => {
  it('the built public/widget.js contains the opps-cards renderer', () => {
    const WIDGET_PATH = resolve(process.cwd(), 'public', 'widget.js')
    if (!existsSync(WIDGET_PATH)) throw new Error('public/widget.js not found — run npm run build:widget first')
    const code = readFileSync(WIDGET_PATH, 'utf-8')
    expect(code).toContain('opps-cards')
  })
})
