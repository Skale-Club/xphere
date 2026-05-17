import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the 4 executor modules before importing the dispatcher
vi.mock('@/lib/manychat/set-field', () => ({ setManychatField: vi.fn() }))
vi.mock('@/lib/manychat/add-tag', () => ({ addManychatTag: vi.fn() }))
vi.mock('@/lib/manychat/trigger-flow', () => ({ triggerManychatFlow: vi.fn() }))
vi.mock('@/lib/manychat/send-message', () => ({ sendManychatMessage: vi.fn() }))

import { executeAction } from '@/lib/action-engine/execute-action'
import { setManychatField } from '@/lib/manychat/set-field'
import { addManychatTag } from '@/lib/manychat/add-tag'
import { triggerManychatFlow } from '@/lib/manychat/trigger-flow'
import { sendManychatMessage } from '@/lib/manychat/send-message'

describe('OUTBOUND-dispatcher: executeAction routes manychat action types', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(setManychatField).mockResolvedValue('ok')
    vi.mocked(addManychatTag).mockResolvedValue('ok')
    vi.mocked(triggerManychatFlow).mockResolvedValue('ok')
    vi.mocked(sendManychatMessage).mockResolvedValue('ok')
  })

  it('routes manychat_set_field to setManychatField', async () => {
    vi.mocked(setManychatField).mockResolvedValue('Field f set on subscriber s.')
    const result = await executeAction(
      'manychat_set_field',
      { subscriber_id: 's', field_id: 'f', field_value: 'v' },
      { apiKey: 'k', locationId: '' }
    )
    expect(setManychatField).toHaveBeenCalledWith(
      { subscriber_id: 's', field_id: 'f', field_value: 'v' },
      { apiKey: 'k', locationId: '' }
    )
    expect(result).toBe('Field f set on subscriber s.')
  })

  it('routes manychat_add_tag to addManychatTag', async () => {
    vi.mocked(addManychatTag).mockResolvedValue('Tag tag-99 added to subscriber sub-1.')
    const result = await executeAction(
      'manychat_add_tag',
      { subscriber_id: 'sub-1', tag_id: 'tag-99' },
      { apiKey: 'k', locationId: '' }
    )
    expect(addManychatTag).toHaveBeenCalledWith(
      { subscriber_id: 'sub-1', tag_id: 'tag-99' },
      { apiKey: 'k', locationId: '' }
    )
    expect(result).toBe('Tag tag-99 added to subscriber sub-1.')
  })

  it('routes manychat_trigger_flow to triggerManychatFlow', async () => {
    vi.mocked(triggerManychatFlow).mockResolvedValue('Flow ns triggered for subscriber s.')
    const result = await executeAction(
      'manychat_trigger_flow',
      { subscriber_id: 's', flow_ns: 'content...' },
      { apiKey: 'k', locationId: '' }
    )
    expect(triggerManychatFlow).toHaveBeenCalledWith(
      { subscriber_id: 's', flow_ns: 'content...' },
      { apiKey: 'k', locationId: '' }
    )
    expect(result).toBe('Flow ns triggered for subscriber s.')
  })

  it('routes manychat_send_message to sendManychatMessage', async () => {
    vi.mocked(sendManychatMessage).mockResolvedValue('Message sent to subscriber s.')
    const result = await executeAction(
      'manychat_send_message',
      { subscriber_id: 's', data: { version: 'v2' } },
      { apiKey: 'k', locationId: '' }
    )
    expect(sendManychatMessage).toHaveBeenCalledWith(
      { subscriber_id: 's', data: { version: 'v2' } },
      { apiKey: 'k', locationId: '' }
    )
    expect(result).toBe('Message sent to subscriber s.')
  })

  it('throws Unknown action type for truly unrecognized action types (exhaustiveness sanity)', async () => {
    await expect(
      executeAction(
        // @ts-expect-error — intentional invalid type for exhaustiveness check
        'xxx_unknown_type',
        {},
        { apiKey: 'k', locationId: '' }
      )
    ).rejects.toThrow(/Unknown action type/)
  })
})
