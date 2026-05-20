import { describe, it, expect } from 'vitest'
import { getBadgeLabel } from '@/components/notifications/notification-bell'

describe('getBadgeLabel', () => {
  it('returns null when unread count is 0', () => {
    expect(getBadgeLabel(0)).toBeNull()
  })

  it('returns exact number string when unread count is 1-9', () => {
    expect(getBadgeLabel(1)).toBe('1')
    expect(getBadgeLabel(5)).toBe('5')
    expect(getBadgeLabel(9)).toBe('9')
  })

  it("returns '9+' when unread count exceeds 9", () => {
    expect(getBadgeLabel(10)).toBe('9+')
    expect(getBadgeLabel(99)).toBe('9+')
  })

  it('given notifications array with 2 unread + 1 read, unreadCount is 2', () => {
    const notifications = [
      { read_at: null },
      { read_at: null },
      { read_at: new Date().toISOString() },
    ]
    const unreadCount = notifications.filter((n) => !n.read_at).length
    expect(unreadCount).toBe(2)
    expect(getBadgeLabel(unreadCount)).toBe('2')
  })
})
