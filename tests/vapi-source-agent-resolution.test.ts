// Which agent's prompt a Vapi assistant speaks when its config is pushed.
//
// agent_channel_defaults holds one row per channel, so before assistant-level
// binding an org had exactly one voice persona. An org that answers in two
// languages, or that runs an outbound callback assistant beside the one that
// answers the phone, binds each assistant through
// assistant_mappings.entry_agent_id.
//
// The case that matters most here is the NEGATIVE one: a mapping that names an
// agent must never quietly fall back to the channel default. That fallback
// would push the web-widget generalist's prompt onto a live phone number and
// look completely successful while doing it.

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { resolveSourceAgentId } from '@/lib/vapi/sync-assistant-config'

type ChannelDefaultRow = { channel: string; agent_id: string }

/**
 * Just enough of the query builder for the two reads under test: a terminal
 * .maybeSingle() for the mapping and an awaited .in() for the channel
 * defaults. Every filter is a no-op — what a filter would have selected is
 * decided by the fixture handed in.
 */
function fakeSupabase(fixture: {
  mapping?: { entry_agent_id: string | null } | null
  channelDefaults?: ChannelDefaultRow[]
}) {
  const tablesRead: string[] = []

  const builder = (table: string) => {
    const result =
      table === 'assistant_mappings'
        ? { data: fixture.mapping ?? null, error: null }
        : { data: fixture.channelDefaults ?? [], error: null }

    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      in: () => Promise.resolve(result),
      maybeSingle: () => Promise.resolve(result),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
    }
    return chain
  }

  return {
    client: {
      from: (table: string) => {
        tablesRead.push(table)
        return builder(table)
      },
    } as unknown as SupabaseClient<Database>,
    tablesRead,
  }
}

const ORG = 'org-1'
const ASSISTANT = 'vapi-assistant-1'

describe('resolveSourceAgentId', () => {
  it('uses the agent bound to the mapping when there is one', async () => {
    const { client } = fakeSupabase({
      mapping: { entry_agent_id: 'agent-outbound-pt' },
      channelDefaults: [{ channel: 'voice', agent_id: 'agent-reception' }],
    })

    const result = await resolveSourceAgentId(client, ORG, ASSISTANT)

    expect(result).toEqual({ agentId: 'agent-outbound-pt', source: 'mapping' })
  })

  it('does not even read the channel defaults when a binding exists', async () => {
    const { client, tablesRead } = fakeSupabase({
      mapping: { entry_agent_id: 'agent-outbound-pt' },
      channelDefaults: [{ channel: 'voice', agent_id: 'agent-reception' }],
    })

    await resolveSourceAgentId(client, ORG, ASSISTANT)

    expect(tablesRead).toEqual(['assistant_mappings'])
  })

  it('falls back to the voice channel default when the mapping binds nothing', async () => {
    const { client } = fakeSupabase({
      mapping: { entry_agent_id: null },
      channelDefaults: [
        { channel: 'web_widget', agent_id: 'agent-widget' },
        { channel: 'voice', agent_id: 'agent-reception' },
      ],
    })

    const result = await resolveSourceAgentId(client, ORG, ASSISTANT)

    expect(result).toEqual({ agentId: 'agent-reception', source: 'channel_default' })
  })

  it('prefers voice over web_widget, and takes web_widget when voice is unset', async () => {
    const { client } = fakeSupabase({
      mapping: null,
      channelDefaults: [{ channel: 'web_widget', agent_id: 'agent-widget' }],
    })

    const result = await resolveSourceAgentId(client, ORG, ASSISTANT)

    expect(result).toEqual({ agentId: 'agent-widget', source: 'channel_default' })
  })

  it('errors instead of guessing when the org has no default at all', async () => {
    const { client } = fakeSupabase({ mapping: null, channelDefaults: [] })

    const result = await resolveSourceAgentId(client, ORG, ASSISTANT)

    expect(result).toEqual({
      error: 'No voice or web_widget default agent configured for this org.',
    })
  })

  it('treats an unmapped assistant the same as an unbound one', async () => {
    const { client } = fakeSupabase({
      mapping: null,
      channelDefaults: [{ channel: 'voice', agent_id: 'agent-reception' }],
    })

    const result = await resolveSourceAgentId(client, ORG, ASSISTANT)

    expect(result).toEqual({ agentId: 'agent-reception', source: 'channel_default' })
  })
})
