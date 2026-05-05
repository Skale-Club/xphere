import { describe, it } from 'vitest'

describe('ChatArea conversation header enrichment', () => {
  it('shows channel icon and "Instagram" label for instagram conversations', () => {
    throw new Error('not yet implemented — enrich ChatArea header with channel + ChannelIcon')
  })

  it('shows channel icon and "Messenger" label for messenger conversations', () => {
    throw new Error('not yet implemented — enrich ChatArea header with channel + ChannelIcon')
  })

  it('shows channelAccountName (page_name) for Meta conversations', () => {
    throw new Error('not yet implemented — display channelAccountName in ChatArea header')
  })

  it('shows "Website Chat" label for widget conversations', () => {
    throw new Error('not yet implemented — simplified header for widget channel')
  })

  it('shows bot status badge "Bot active" when botStatus is active', () => {
    throw new Error('not yet implemented — add bot status badge to ChatArea header')
  })

  it('shows bot status badge "Bot paused" when botStatus is paused', () => {
    throw new Error('not yet implemented — add bot status badge to ChatArea header')
  })
})
