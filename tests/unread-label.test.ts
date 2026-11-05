import { describe, expect, it } from 'vitest'
import { unreadLabel } from '@/lib/unread-label'

describe('unreadLabel', () => {
  it('shows the exact count up to 99', () => {
    expect(unreadLabel(1)).toBe('1')
    expect(unreadLabel(99)).toBe('99')
  })

  it('caps at 99+', () => {
    expect(unreadLabel(100)).toBe('99+')
    expect(unreadLabel(2057)).toBe('99+')
  })
})
