import { describe, it, expect } from 'vitest'
import type { ConversationSummary } from '../src/types/chat'
import { applyChannelAndBotFilter } from '../src/components/chat/channel-icon'
import type { ChannelFilter, BotStateFilter } from '../src/components/chat/channel-icon'

// Factory helper
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

const conversations: ConversationSummary[] = [
  makeConversation({ id: '1', channel: 'widget', botStatus: 'active' }),
  makeConversation({ id: '2', channel: 'instagram', botStatus: 'active' }),
  makeConversation({ id: '3', channel: 'messenger', botStatus: 'paused' }),
  makeConversation({ id: '4', channel: 'widget', botStatus: 'paused' }),
]

describe('ConversationList channel + bot-state filter', () => {
  it('filter "widget" shows only widget conversations', () => {
    const result = applyChannelAndBotFilter(conversations, 'widget' as ChannelFilter, 'all' as BotStateFilter)
    expect(result.every((c) => c.channel === 'widget')).toBe(true)
    expect(result).toHaveLength(2)
  })

  it('filter "instagram" shows only instagram conversations', () => {
    const result = applyChannelAndBotFilter(conversations, 'instagram' as ChannelFilter, 'all' as BotStateFilter)
    expect(result.every((c) => c.channel === 'instagram')).toBe(true)
    expect(result).toHaveLength(1)
  })

  it('filter "messenger" shows only messenger conversations', () => {
    const result = applyChannelAndBotFilter(conversations, 'messenger' as ChannelFilter, 'all' as BotStateFilter)
    expect(result.every((c) => c.channel === 'messenger')).toBe(true)
    expect(result).toHaveLength(1)
  })

  it('filter "all" shows conversations of every channel', () => {
    const result = applyChannelAndBotFilter(conversations, 'all' as ChannelFilter, 'all' as BotStateFilter)
    expect(result).toHaveLength(conversations.length)
  })

  it('bot-state filter "bot-active" shows only conversations where botStatus is active', () => {
    const result = applyChannelAndBotFilter(conversations, 'all' as ChannelFilter, 'bot-active' as BotStateFilter)
    expect(result.every((c) => c.botStatus === 'active')).toBe(true)
    expect(result).toHaveLength(2)
  })

  it('bot-state filter "bot-paused" shows only conversations where botStatus is paused', () => {
    const result = applyChannelAndBotFilter(conversations, 'all' as ChannelFilter, 'bot-paused' as BotStateFilter)
    expect(result.every((c) => c.botStatus === 'paused')).toBe(true)
    expect(result).toHaveLength(2)
  })

  it('channel filter value "Website" maps to channel === "widget" not channel === "website"', () => {
    // The filter pill labelled "Website" should use the key 'widget' (not 'website')
    // Filtering by 'widget' returns widget conversations
    const byWidget = applyChannelAndBotFilter(conversations, 'widget' as ChannelFilter, 'all' as BotStateFilter)
    // Filtering by 'website' (incorrect key) would return nothing
    const byWebsite = applyChannelAndBotFilter(conversations, 'website' as ChannelFilter, 'all' as BotStateFilter)
    expect(byWidget.length).toBeGreaterThan(0)
    expect(byWebsite).toHaveLength(0)
  })
})
