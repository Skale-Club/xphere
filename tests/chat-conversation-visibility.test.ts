import { describe, expect, it } from 'vitest'

import { matchesInboxStatusFilter } from '@/lib/chat/conversation-visibility'

describe('matchesInboxStatusFilter', () => {
  it('hides archived conversations when no status filter is selected', () => {
    expect(matchesInboxStatusFilter('closed', null)).toBe(false)
  })

  it('keeps every non-archived status in the default Inbox', () => {
    for (const status of ['open', 'pending', 'waiting', 'resolved'] as const) {
      expect(matchesInboxStatusFilter(status, null)).toBe(true)
    }
  })

  it('shows archived conversations when the Archived filter is selected', () => {
    expect(matchesInboxStatusFilter('closed', 'closed')).toBe(true)
  })

  it('removes restored conversations from the Archived view', () => {
    expect(matchesInboxStatusFilter('open', 'closed')).toBe(false)
  })
})
