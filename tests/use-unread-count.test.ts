/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  UNREAD_DECREMENT_EVENT,
  UNREAD_REFRESH_EVENT,
  fetchUnreadCount,
  useUnreadCount,
} from '@/hooks/use-unread-count'
import { POLL_UNREAD_COUNT_MS } from '@/lib/polling/intervals'

let root: Root
let container: HTMLDivElement
let hidden = false
let shown = -1
const fetchMock = vi.fn()

function Harness({ userId, initial }: { userId: string | null; initial: number }) {
  shown = useUnreadCount(userId, initial)
  return null
}

async function mount(userId: string | null, initial = 0) {
  await act(async () => {
    root.render(createElement(Harness, { userId, initial }))
  })
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

function countResponse(count: number) {
  return Promise.resolve(new Response(JSON.stringify({ count }), { status: 200 }))
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.spyOn(Math, 'random').mockReturnValue(0.5)
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  hidden = false
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  shown = -1
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('fetchUnreadCount', () => {
  it('reads the count from the unread-count route', async () => {
    fetchMock.mockReturnValueOnce(countResponse(7))
    await expect(fetchUnreadCount()).resolves.toBe(7)
    expect(fetchMock).toHaveBeenCalledWith('/api/chat/unread-count')
  })

  it('throws on a non-OK response instead of returning 0', async () => {
    fetchMock.mockReturnValueOnce(Promise.resolve(new Response('no', { status: 401 })))
    await expect(fetchUnreadCount()).rejects.toThrow('401')
  })
})

describe('useUnreadCount', () => {
  it('paints the server seed, then reconciles to the fetched count', async () => {
    fetchMock.mockReturnValue(countResponse(4))
    await mount('u1', 2)
    expect(shown).toBe(4)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does nothing without a user', async () => {
    await mount(null, 3)
    await advance(POLL_UNREAD_COUNT_MS * 3)
    expect(shown).toBe(3)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('polls every POLL_UNREAD_COUNT_MS and picks up changes', async () => {
    fetchMock.mockReturnValueOnce(countResponse(1)).mockReturnValue(countResponse(5))
    await mount('u1')
    expect(shown).toBe(1)

    await advance(POLL_UNREAD_COUNT_MS - 1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(shown).toBe(5)
  })

  it('does not poll while the tab is hidden, and refreshes when it is visible again', async () => {
    fetchMock.mockReturnValueOnce(countResponse(1)).mockReturnValue(countResponse(9))
    await mount('u1')
    await act(async () => {
      hidden = true
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await advance(POLL_UNREAD_COUNT_MS * 4)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(shown).toBe(1)

    await act(async () => {
      hidden = false
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(shown).toBe(9)
  })

  it('keeps the last known count when a poll fails', async () => {
    fetchMock
      .mockReturnValueOnce(countResponse(6))
      .mockReturnValueOnce(Promise.resolve(new Response('boom', { status: 500 })))
    await mount('u1')
    expect(shown).toBe(6)
    await advance(POLL_UNREAD_COUNT_MS)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(shown).toBe(6)
  })

  it('drops the badge by one on the decrement event, never below zero', async () => {
    fetchMock.mockReturnValue(countResponse(1))
    await mount('u1')
    expect(shown).toBe(1)

    await act(async () => {
      window.dispatchEvent(new Event(UNREAD_DECREMENT_EVENT))
    })
    expect(shown).toBe(0)
    await act(async () => {
      window.dispatchEvent(new Event(UNREAD_DECREMENT_EVENT))
    })
    expect(shown).toBe(0)
  })

  it('refetches right away on the refresh event', async () => {
    fetchMock.mockReturnValueOnce(countResponse(2)).mockReturnValue(countResponse(3))
    await mount('u1')
    expect(shown).toBe(2)

    await act(async () => {
      window.dispatchEvent(new Event(UNREAD_REFRESH_EVENT))
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(shown).toBe(3)
  })

  it('stops listening and polling after unmount', async () => {
    fetchMock.mockReturnValue(countResponse(2))
    await mount('u1')
    await act(async () => root.unmount())
    await advance(POLL_UNREAD_COUNT_MS * 3)
    await act(async () => {
      window.dispatchEvent(new Event(UNREAD_REFRESH_EVENT))
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    root = createRoot(container)
  })
})
