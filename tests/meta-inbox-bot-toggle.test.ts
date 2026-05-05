import { describe, it, vi } from 'vitest'

describe('toggleBotStatus server action', () => {
  it('toggles bot_status from active to paused', async () => {
    throw new Error('not yet implemented — create toggleBotStatus server action in actions.ts')
  })

  it('toggles bot_status from paused to active', async () => {
    throw new Error('not yet implemented — create toggleBotStatus server action in actions.ts')
  })

  it('returns { error } when user is not authenticated', async () => {
    throw new Error('not yet implemented — auth check in toggleBotStatus')
  })

  it('returns { botStatus } with new status on success', async () => {
    throw new Error('not yet implemented — success return shape from toggleBotStatus')
  })
})

describe('AdminChatLayout optimistic bot toggle', () => {
  it('immediately updates local botStatus before server action resolves', () => {
    throw new Error('not yet implemented — optimistic update in handleBotStatusToggle')
  })

  it('reverts botStatus and calls toast.error on server action failure', () => {
    throw new Error('not yet implemented — error rollback in handleBotStatusToggle')
  })
})

// Suppress unused import warning
void vi
