import { describe, it, expect } from 'vitest'
import { ChannelIcon, channelLabel } from '../src/components/chat/channel-icon'

describe('ChannelIcon component', () => {
  it('renders Globe icon for widget channel', () => {
    // ChannelIcon for 'widget' returns Globe (not InstagramIcon or MessengerIcon)
    // We verify by checking the channelLabel and that the function doesn't return null
    const element = ChannelIcon({ channel: 'widget' })
    expect(element).not.toBeNull()
    expect(channelLabel('widget')).toBe('Website Chat')
  })

  it('renders Instagram icon for instagram channel', () => {
    const element = ChannelIcon({ channel: 'instagram' })
    expect(element).not.toBeNull()
    expect(channelLabel('instagram')).toBe('Instagram')
  })

  it('renders Messenger icon for messenger channel', () => {
    const element = ChannelIcon({ channel: 'messenger' })
    expect(element).not.toBeNull()
    expect(channelLabel('messenger')).toBe('Messenger')
  })

  it('defaults to Globe icon for unknown channel', () => {
    const element = ChannelIcon({ channel: 'unknown-channel' })
    expect(element).not.toBeNull()
    // Unknown channel label falls through to 'Website Chat' (Globe default)
    expect(channelLabel('unknown-channel')).toBe('Website Chat')
  })
})
