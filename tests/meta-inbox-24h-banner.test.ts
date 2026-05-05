import { describe, it } from 'vitest'

describe('ChatArea 24h Meta reply window banner', () => {
  it('banner is visible when channel_metadata.window_expired === "true" (string)', () => {
    // IMPORTANT: window_expired is a STRING 'true', not boolean true
    throw new Error('not yet implemented — add 24h warning banner to ChatArea')
  })

  it('banner is NOT visible when window_expired is absent', () => {
    throw new Error('not yet implemented — banner should be hidden for normal conversations')
  })

  it('banner is NOT visible when window_expired === "false"', () => {
    throw new Error('not yet implemented — banner should not appear for non-expired windows')
  })

  it('banner is NOT visible for widget conversations regardless of channel_metadata', () => {
    throw new Error('not yet implemented — banner only applies to Meta channels')
  })

  it('banner text contains "24-hour" and "expired"', () => {
    throw new Error('not yet implemented — verify banner message content')
  })

  it('banner is NOT dismissible (no close button)', () => {
    throw new Error('not yet implemented — banner is server-driven, not user-dismissible')
  })
})
