/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  computePollDelay,
  usePolling,
  type UsePollingOptions,
  type UsePollingResult,
} from '@/hooks/use-polling'

let root: Root
let container: HTMLDivElement
let hidden = false
let latest: UsePollingResult | null = null

function Harness({ fetcher, options }: { fetcher: () => unknown; options: UsePollingOptions }) {
  latest = usePolling(fetcher, options)
  return null
}

async function mount(fetcher: () => unknown, options: UsePollingOptions) {
  await act(async () => {
    root.render(createElement(Harness, { fetcher, options }))
  })
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

function setHidden(next: boolean) {
  hidden = next
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  // Zero jitter: (0.5 * 2 - 1) * jitter === 0.
  vi.spyOn(Math, 'random').mockReturnValue(0.5)
  hidden = false
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  latest = null
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('computePollDelay', () => {
  it('is the interval when there are no failures and jitter is neutral', () => {
    expect(computePollDelay(3000, 0, { random: () => 0.5 })).toBe(3000)
  })

  it('spreads by +/- jitter around the interval', () => {
    expect(computePollDelay(1000, 0, { jitter: 0.2, random: () => 0 })).toBe(800)
    expect(computePollDelay(1000, 0, { jitter: 0.2, random: () => 1 })).toBe(1200)
  })

  it('doubles per failure and is capped', () => {
    const opts = { maxBackoffMs: 5000, random: () => 0.5 }
    expect([1, 2, 3, 4].map((f) => computePollDelay(1000, f, opts))).toEqual([2000, 4000, 5000, 5000])
  })

  it('never caps below the base interval', () => {
    expect(computePollDelay(30_000, 3, { maxBackoffMs: 5000, random: () => 0.5 })).toBe(30_000)
  })
})

describe('usePolling', () => {
  it('runs immediately, then every interval', async () => {
    const fetcher = vi.fn().mockResolvedValue(undefined)
    await mount(fetcher, { intervalMs: 3000 })
    expect(fetcher).toHaveBeenCalledTimes(1)

    await advance(2999)
    expect(fetcher).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(fetcher).toHaveBeenCalledTimes(2)
    await advance(3000)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('waits one interval before the first run when immediate is false', async () => {
    const fetcher = vi.fn().mockResolvedValue(undefined)
    await mount(fetcher, { intervalMs: 3000, immediate: false })
    expect(fetcher).not.toHaveBeenCalled()
    await advance(3000)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('does not run while disabled and starts when enabled', async () => {
    const fetcher = vi.fn().mockResolvedValue(undefined)
    await mount(fetcher, { intervalMs: 1000, enabled: false })
    await advance(5000)
    expect(fetcher).not.toHaveBeenCalled()

    await mount(fetcher, { intervalMs: 1000, enabled: true })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('pauses while the tab is hidden and refetches immediately when visible again', async () => {
    const fetcher = vi.fn().mockResolvedValue(undefined)
    await mount(fetcher, { intervalMs: 3000 })
    expect(fetcher).toHaveBeenCalledTimes(1)

    await act(async () => setHidden(true))
    await advance(60_000)
    expect(fetcher).toHaveBeenCalledTimes(1)

    await act(async () => setHidden(false))
    expect(fetcher).toHaveBeenCalledTimes(2)
    // ...and the loop resumes after that.
    await advance(3000)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('does not run on mount in a hidden tab, then runs when it becomes visible', async () => {
    hidden = true
    const fetcher = vi.fn().mockResolvedValue(undefined)
    await mount(fetcher, { intervalMs: 3000 })
    await advance(10_000)
    expect(fetcher).not.toHaveBeenCalled()

    await act(async () => setHidden(false))
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('refetches immediately when the window regains focus', async () => {
    const fetcher = vi.fn().mockResolvedValue(undefined)
    await mount(fetcher, { intervalMs: 30_000 })
    expect(fetcher).toHaveBeenCalledTimes(1)

    await advance(5000)
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('coalesces the visibility + focus pair fired together on return', async () => {
    const fetcher = vi.fn().mockResolvedValue(undefined)
    await mount(fetcher, { intervalMs: 30_000 })
    await act(async () => setHidden(true))
    await advance(5000)
    await act(async () => {
      setHidden(false)
      window.dispatchEvent(new Event('focus'))
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('never overlaps requests', async () => {
    let release: () => void = () => {}
    const fetcher = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    await mount(fetcher, { intervalMs: 1000 })
    expect(fetcher).toHaveBeenCalledTimes(1)

    // Many intervals pass while the first request is still pending.
    await advance(20_000)
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(fetcher).toHaveBeenCalledTimes(1)

    await act(async () => release())
    await advance(1000)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('backs off exponentially on errors, caps it, and resets after a success', async () => {
    let calls = 0
    const times: number[] = []
    const start = Date.now()
    const fetcher = vi.fn(async () => {
      calls += 1
      times.push(Date.now() - start)
      if (calls <= 4) throw new Error('boom')
    })
    await mount(fetcher, { intervalMs: 1000, maxBackoffMs: 5000 })

    await advance(60_000)
    // t=0 fail -> +2000 fail -> +4000 fail -> +5000 (cap) fail -> +5000 ok -> +1000 ...
    expect(times.slice(0, 6)).toEqual([0, 2000, 6000, 11_000, 16_000, 17_000])
  })

  it('stops after unmount', async () => {
    const fetcher = vi.fn().mockResolvedValue(undefined)
    await mount(fetcher, { intervalMs: 1000 })
    expect(fetcher).toHaveBeenCalledTimes(1)

    await act(async () => root.unmount())
    await advance(10_000)
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
    root = createRoot(container) // so afterEach can unmount a live root
  })

  it('uses the latest fetcher without restarting the loop', async () => {
    const first = vi.fn().mockResolvedValue(undefined)
    const second = vi.fn().mockResolvedValue(undefined)
    await mount(first, { intervalMs: 1000 })
    expect(first).toHaveBeenCalledTimes(1)

    await mount(second, { intervalMs: 1000 })
    expect(second).not.toHaveBeenCalled() // no extra immediate run on re-render
    await advance(1000)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('refetch() runs now, and runs once more if one was in flight', async () => {
    const resolvers: Array<() => void> = []
    const fetcher = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve)
        }),
    )
    await mount(fetcher, { intervalMs: 60_000 })
    expect(fetcher).toHaveBeenCalledTimes(1)

    // Asked for while the first is pending: queued, not started.
    await act(async () => {
      void latest!.refetch()
    })
    expect(fetcher).toHaveBeenCalledTimes(1)

    await act(async () => resolvers[0]())
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(resolvers).toHaveLength(2)
  })

  it('arms one timer when woken inside the wake gap after a hidden run ended', async () => {
    const resolvers: Array<() => void> = []
    const fetcher = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve)
        }),
    )
    await mount(fetcher, { intervalMs: 3000 })
    await act(async () => setHidden(true))
    await act(async () => resolvers[0]()) // ends hidden: nothing scheduled
    // Visible again 0ms after the run started (fake clock has not moved).
    await act(async () => setHidden(false))
    expect(fetcher).toHaveBeenCalledTimes(1) // inside the gap: no immediate run
    await advance(3000)
    expect(fetcher).toHaveBeenCalledTimes(2) // exactly one timer fired
    await act(async () => resolvers[1]())
    await advance(3000)
    expect(fetcher).toHaveBeenCalledTimes(3) // and the loop continues
  })

  it('keeps polling at hiddenIntervalMs while the tab is hidden', async () => {
    const fetcher = vi.fn().mockResolvedValue(undefined)
    await mount(fetcher, { intervalMs: 3000, hiddenIntervalMs: 10_000 })
    expect(fetcher).toHaveBeenCalledTimes(1)

    await act(async () => setHidden(true))
    await advance(9_999)
    expect(fetcher).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(fetcher).toHaveBeenCalledTimes(2)
    await advance(10_000)
    expect(fetcher).toHaveBeenCalledTimes(3)

    // Back to the visible rate (and an immediate refetch) on return.
    await advance(1_000)
    await act(async () => setHidden(false))
    expect(fetcher).toHaveBeenCalledTimes(4)
    await advance(3000)
    expect(fetcher).toHaveBeenCalledTimes(5)
  })
})
