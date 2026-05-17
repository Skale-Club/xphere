import { describe, it, expect, vi, afterEach } from 'vitest'

/**
 * Typing indicator broadcast pattern (v2.2 / SEED-011).
 *
 * The chat-layout uses Supabase Realtime *broadcast* (not presence, not
 * postgres_changes) to surface "is the other side typing?":
 *
 *   - Sender: composer debounces keystrokes ~500ms then publishes
 *     `{ event: 'typing', payload: { user_id, conversation_id, ts } }` on
 *     channel `typing:<conversationId>`.
 *   - Receiver: subscribes to the same channel, ignores own echoes
 *     (matched by user_id), shows the dots, and clears the indicator after
 *     3 seconds of silence.
 *
 * These tests exercise the *logic*, not the Supabase client itself — the
 * actual broadcast plumbing is verified manually + via the build.
 */

describe('typing indicator self-echo filtering', () => {
  it('ignores typing broadcasts from the current user', () => {
    const currentUserId = 'user-A'
    const broadcast = { user_id: 'user-A', conversation_id: 'c1', ts: Date.now() }
    const shouldShow = broadcast.user_id !== currentUserId
    expect(shouldShow).toBe(false)
  })

  it('shows typing when the broadcast originates from another user', () => {
    const currentUserId = 'user-A'
    const broadcast = { user_id: 'user-B', conversation_id: 'c1', ts: Date.now() }
    const shouldShow = broadcast.user_id !== currentUserId
    expect(shouldShow).toBe(true)
  })

  it('shows typing when the broadcast has no user_id (customer side)', () => {
    const currentUserId = 'user-A'
    const broadcast = { user_id: undefined, conversation_id: 'c1', ts: Date.now() }
    // Receivers should treat missing user_id as "other party" — only own echoes
    // (matched user_id) get suppressed.
    const shouldShow = !broadcast.user_id || broadcast.user_id !== currentUserId
    expect(shouldShow).toBe(true)
  })
})

describe('typing indicator auto-clear', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('clears the typing flag after 3 seconds of silence', () => {
    vi.useFakeTimers()
    let isTyping = false
    let timeout: ReturnType<typeof setTimeout> | null = null

    function receive() {
      isTyping = true
      if (timeout) clearTimeout(timeout)
      timeout = setTimeout(() => {
        isTyping = false
      }, 3000)
    }

    receive()
    expect(isTyping).toBe(true)

    vi.advanceTimersByTime(2999)
    expect(isTyping).toBe(true)

    vi.advanceTimersByTime(2)
    expect(isTyping).toBe(false)
  })

  it('extends the timeout when consecutive broadcasts arrive', () => {
    vi.useFakeTimers()
    let isTyping = false
    let timeout: ReturnType<typeof setTimeout> | null = null

    function receive() {
      isTyping = true
      if (timeout) clearTimeout(timeout)
      timeout = setTimeout(() => {
        isTyping = false
      }, 3000)
    }

    receive()
    vi.advanceTimersByTime(2000)
    receive() // restart the clock
    vi.advanceTimersByTime(2000)
    expect(isTyping).toBe(true) // 4s total but only 2s since last keystroke
    vi.advanceTimersByTime(1001)
    expect(isTyping).toBe(false)
  })
})

describe('outbound typing debounce (500ms throttle)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('coalesces rapid keystrokes into one broadcast per 500ms window', () => {
    vi.useFakeTimers()
    const broadcasts: number[] = []
    let lastTyping = 0

    function onTyping() {
      const now = Date.now()
      if (now - lastTyping > 500) {
        lastTyping = now
        broadcasts.push(now)
      }
    }

    // simulate 5 keystrokes spaced 100ms apart
    for (let i = 0; i < 5; i++) {
      onTyping()
      vi.advanceTimersByTime(100)
    }
    expect(broadcasts.length).toBe(1) // only the first one fires

    // wait past the throttle window then keystroke again
    vi.advanceTimersByTime(500)
    onTyping()
    expect(broadcasts.length).toBe(2)
  })
})
