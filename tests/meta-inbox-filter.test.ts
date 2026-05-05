import { describe, it } from 'vitest'
import type { ConversationSummary } from '../src/types/chat'

// Factory helper — use this in Wave 1 implementation
function makeConversation(overrides: Partial<ConversationSummary>): ConversationSummary {
  return {
    id: 'conv-1',
    status: 'open',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    channel: 'widget',
    channelMetadata: {},
    botStatus: 'active',
    channelAccountName: null,
    ...overrides,
  }
}

describe('ConversationList channel + bot-state filter', () => {
  it('filter "widget" shows only widget conversations', () => {
    throw new Error('not yet implemented — extend ConversationList with channelFilter state')
  })

  it('filter "instagram" shows only instagram conversations', () => {
    throw new Error('not yet implemented — extend ConversationList with channelFilter state')
  })

  it('filter "messenger" shows only messenger conversations', () => {
    throw new Error('not yet implemented — extend ConversationList with channelFilter state')
  })

  it('filter "all" shows conversations of every channel', () => {
    throw new Error('not yet implemented — extend ConversationList with channelFilter state')
  })

  it('bot-state filter "bot-active" shows only conversations where botStatus is active', () => {
    throw new Error('not yet implemented — add botStateFilter to ConversationList')
  })

  it('bot-state filter "bot-paused" shows only conversations where botStatus is paused', () => {
    throw new Error('not yet implemented — add botStateFilter to ConversationList')
  })

  it('channel filter value "Website" maps to channel === "widget" not channel === "website"', () => {
    throw new Error('not yet implemented — verify filter key mapping')
  })
})

// Suppress unused variable warning for the factory helper
void makeConversation
