import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/manychat/resolve-rule', () => ({
  resolveRule: vi.fn(),
}))

vi.mock('@/lib/action-engine/resolve-tool-by-id', () => ({
  resolveToolById: vi.fn(),
}))

vi.mock('@/lib/action-engine/execute-action', () => ({
  executeAction: vi.fn(),
}))

vi.mock('@/lib/crypto', () => ({
  decrypt: vi.fn().mockResolvedValue('decrypted-key'),
}))

import { resolveRule } from '@/lib/manychat/resolve-rule'
import { resolveToolById } from '@/lib/action-engine/resolve-tool-by-id'
import { executeAction } from '@/lib/action-engine/execute-action'

function buildDispatchSupabase(opts: { logId?: string | null; logError?: string | null } = {}) {
  // action_logs.insert(...).select('id').single() returns {id}
  const singleSpy = vi.fn().mockResolvedValue({
    data: opts.logId !== undefined ? { id: opts.logId } : { id: 'log-default' },
    error: opts.logError ? { message: opts.logError } : null,
  })
  const selectSpy = vi.fn().mockReturnValue({ single: singleSpy })
  const actionLogsInsertSpy = vi.fn().mockReturnValue({ select: selectSpy })

  // manychat_events.update(...).eq('id', eventId) → {data, error}
  const eventsUpdateEqSpy = vi.fn().mockResolvedValue({ data: null, error: null })
  const eventsUpdateSpy = vi.fn().mockReturnValue({ eq: eventsUpdateEqSpy })

  const fromMock = vi.fn((table: string) => {
    if (table === 'action_logs') return { insert: actionLogsInsertSpy }
    if (table === 'manychat_events') return { update: eventsUpdateSpy }
    return {}
  })

  return {
    from: fromMock,
    _actionLogsInsertSpy: actionLogsInsertSpy,
    _eventsUpdateSpy: eventsUpdateSpy,
    _eventsUpdateEqSpy: eventsUpdateEqSpy,
  }
}

const fakeTool = {
  id: 'tool-1',
  organization_id: 'org-1',
  integration_id: 'int-1',
  tool_name: 'create_contact',
  action_type: 'create_contact' as const,
  config: {},
  fallback_message: 'Service unavailable.',
  is_active: true,
  integrations: {
    id: 'int-1',
    encrypted_api_key: 'iv:cipher',
    location_id: 'loc-1',
    provider: 'gohighlevel' as const,
    config: {},
  },
}

const fakeRule = {
  id: 'rule-1',
  org_id: 'org-1',
  channel_id: 'channel-1',
  event_type: 'flow_completed',
  condition: {},
  tool_config_id: 'tool-1',
  is_active: true,
  priority: 0,
  created_at: '2026-05-06',
  updated_at: '2026-05-06',
}

describe('ROUTING-03: dispatchManychatEvent — match path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('returns early (no UPDATE) when no rule matches', async () => {
    vi.mocked(resolveRule).mockResolvedValue(null)
    const supabase = buildDispatchSupabase()
    const { dispatchManychatEvent } = await import('@/lib/manychat/dispatch-event')
    await dispatchManychatEvent(
      { eventId: 'evt-1', orgId: 'org-1', channelId: 'channel-1', eventType: 'flow_completed', payload: {} },
      // @ts-expect-error mock client
      supabase
    )
    expect(supabase._eventsUpdateSpy).not.toHaveBeenCalled()
    expect(executeAction).not.toHaveBeenCalled()
  })

  it('calls executeAction with action_type, payload, credentials, ctx on rule match', async () => {
    vi.mocked(resolveRule).mockResolvedValue(fakeRule)
    vi.mocked(resolveToolById).mockResolvedValue(fakeTool)
    vi.mocked(executeAction).mockResolvedValue('ok')
    const supabase = buildDispatchSupabase({ logId: 'log-1' })
    const { dispatchManychatEvent } = await import('@/lib/manychat/dispatch-event')
    await dispatchManychatEvent(
      { eventId: 'evt-1', orgId: 'org-1', channelId: 'channel-1', eventType: 'flow_completed', payload: { x: 1 } },
      // @ts-expect-error mock client
      supabase
    )
    expect(executeAction).toHaveBeenCalledWith(
      'create_contact',
      { x: 1 },
      expect.objectContaining({ apiKey: 'decrypted-key', locationId: 'loc-1' }),
      expect.objectContaining({ organizationId: 'org-1' })
    )
  })

  it('writes status=error when resolveToolById returns null', async () => {
    vi.mocked(resolveRule).mockResolvedValue(fakeRule)
    vi.mocked(resolveToolById).mockResolvedValue(null)
    const supabase = buildDispatchSupabase()
    const { dispatchManychatEvent } = await import('@/lib/manychat/dispatch-event')
    await dispatchManychatEvent(
      { eventId: 'evt-1', orgId: 'org-1', channelId: 'channel-1', eventType: 'x', payload: {} },
      // @ts-expect-error mock client
      supabase
    )
    expect(supabase._eventsUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error', matched_rule_id: 'rule-1' })
    )
  })

  it('writes status=error when executeAction throws', async () => {
    vi.mocked(resolveRule).mockResolvedValue(fakeRule)
    vi.mocked(resolveToolById).mockResolvedValue(fakeTool)
    vi.mocked(executeAction).mockRejectedValue(new Error('boom'))
    const supabase = buildDispatchSupabase({ logId: 'log-1' })
    const { dispatchManychatEvent } = await import('@/lib/manychat/dispatch-event')
    await dispatchManychatEvent(
      { eventId: 'evt-1', orgId: 'org-1', channelId: 'channel-1', eventType: 'x', payload: {} },
      // @ts-expect-error mock client
      supabase
    )
    expect(supabase._eventsUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error', matched_rule_id: 'rule-1' })
    )
  })

  it('routes manychat_add_tag action_type through to executeAction unchanged', async () => {
    // @ts-expect-error — Wave 0 RED: manychat_add_tag not yet a valid action_type literal
    const manychatTool = { ...fakeTool, action_type: 'manychat_add_tag' as const, tool_name: 'add_vip_tag' }
    vi.mocked(resolveRule).mockResolvedValue(fakeRule)
    vi.mocked(resolveToolById).mockResolvedValue(manychatTool)
    vi.mocked(executeAction).mockResolvedValue('Tag tag-vip added to subscriber sub-1.')
    const supabase = buildDispatchSupabase({ logId: 'log-1' })
    const { dispatchManychatEvent } = await import('@/lib/manychat/dispatch-event')
    await dispatchManychatEvent(
      {
        eventId: 'e1',
        orgId: 'org-1',
        channelId: 'ch-1',
        eventType: 'flow_completed',
        payload: { subscriber_id: 'sub-1', tag_id: 'tag-vip' },
      },
      // @ts-expect-error mock client
      supabase
    )
    expect(executeAction).toHaveBeenCalledWith(
      'manychat_add_tag',
      { subscriber_id: 'sub-1', tag_id: 'tag-vip' },
      expect.objectContaining({ apiKey: 'decrypted-key' }),
      expect.objectContaining({ organizationId: 'org-1' })
    )
  })
})

describe('ROUTING-04: action_log_id linking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('writes the new action_logs.id back to manychat_events.action_log_id (and status=matched)', async () => {
    vi.mocked(resolveRule).mockResolvedValue(fakeRule)
    vi.mocked(resolveToolById).mockResolvedValue(fakeTool)
    vi.mocked(executeAction).mockResolvedValue('done')
    const supabase = buildDispatchSupabase({ logId: 'log-xyz' })
    const { dispatchManychatEvent } = await import('@/lib/manychat/dispatch-event')
    await dispatchManychatEvent(
      { eventId: 'evt-1', orgId: 'org-1', channelId: 'channel-1', eventType: 'x', payload: {} },
      // @ts-expect-error mock client
      supabase
    )
    expect(supabase._eventsUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'matched',
        action_log_id: 'log-xyz',
        matched_rule_id: 'rule-1',
      })
    )
    expect(supabase._eventsUpdateEqSpy).toHaveBeenCalledWith('id', 'evt-1')
  })

  it('uses synthetic vapi_call_id="manychat:{event_id}" in the action_logs insert', async () => {
    vi.mocked(resolveRule).mockResolvedValue(fakeRule)
    vi.mocked(resolveToolById).mockResolvedValue(fakeTool)
    vi.mocked(executeAction).mockResolvedValue('done')
    const supabase = buildDispatchSupabase({ logId: 'log-1' })
    const { dispatchManychatEvent } = await import('@/lib/manychat/dispatch-event')
    await dispatchManychatEvent(
      { eventId: 'evt-42', orgId: 'org-1', channelId: 'channel-1', eventType: 'x', payload: {} },
      // @ts-expect-error mock client
      supabase
    )
    expect(supabase._actionLogsInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ vapi_call_id: 'manychat:evt-42' })
    )
  })
})
