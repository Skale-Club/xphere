// resolveInboundAgent: Supabase wiring around the pure routing rules.

import { describe, it, expect, vi } from 'vitest'
import { resolveInboundAgent } from '@/lib/agent-runtime/inbound-agent'

const NOW = new Date('2026-09-23T12:00:00Z')
const iso = (msFromNow: number) => new Date(NOW.getTime() + msFromNow).toISOString()

const NFC_AGENT = {
  id: 'agent-nfc',
  name: 'Chaveiros NFC',
  is_active: true,
  activation_keywords: ['chaveiro', 'chaveiros', 'nfc'],
  message_label: '🤖 Ana (assistente virtual)',
}

interface FakeState {
  conversation: Record<string, unknown> | null
  keywordAgents?: Array<typeof NFC_AGENT>
  defaultAgentId?: string | null
  defaultAgent?: Record<string, unknown> | null
  recentHumanMessage?: boolean
  lastOutbound?: { content: string; metadata: Record<string, unknown> } | null
}

/** Minimal chainable fake: each terminal call resolves from `state` by table. */
function fakeSupabase(state: FakeState) {
  const updates: Array<{ table: string; values: Record<string, unknown> }> = []
  const inserts: Array<{ table: string; values: Record<string, unknown> }> = []

  const from = vi.fn((table: string) => {
    const filters: Record<string, unknown> = {}
    const chain: Record<string, unknown> = {}
    const self = () => chain
    Object.assign(chain, {
      select: vi.fn(self),
      eq: vi.fn((col: string, val: unknown) => {
        filters[col] = val
        return chain
      }),
      contains: vi.fn((col: string, val: unknown) => {
        filters[`contains:${col}`] = val
        return chain
      }),
      gte: vi.fn(self),
      order: vi.fn(self),
      limit: vi.fn(self),
      update: vi.fn((values: Record<string, unknown>) => {
        updates.push({ table, values })
        return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) }
      }),
      insert: vi.fn((values: Record<string, unknown>) => {
        inserts.push({ table, values })
        return Promise.resolve({ data: null, error: null })
      }),
      maybeSingle: vi.fn(async () => {
        if (table === 'conversations') return { data: state.conversation, error: null }
        if (table === 'agent_channel_defaults') {
          return { data: state.defaultAgentId ? { agent_id: state.defaultAgentId } : null, error: null }
        }
        if (table === 'agents') return { data: state.defaultAgent ?? null, error: null }
        if (table === 'conversation_messages') {
          if (filters['contains:metadata']) {
            return { data: state.recentHumanMessage ? { id: 'm-human' } : null, error: null }
          }
          return { data: state.lastOutbound ?? null, error: null }
        }
        return { data: null, error: null }
      }),
      // Awaiting the chain directly = the keyword agents list query.
      then: (resolve: (v: unknown) => void) =>
        resolve({ data: table === 'agents' ? (state.keywordAgents ?? []) : [], error: null }),
    })
    return chain
  })

  return { client: { from }, updates, inserts }
}

async function resolve(state: FakeState, text: string) {
  const fake = fakeSupabase(state)
  const route = await resolveInboundAgent({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: fake.client as any,
    orgId: 'org-1',
    conversationId: 'conv-1',
    channel: 'whatsapp',
    text,
    now: NOW,
  })
  return { route, ...fake }
}

describe('resolveInboundAgent', () => {
  it('stays quiet while a human-reply pause is running', async () => {
    const { route } = await resolve(
      {
        conversation: { bot_status: 'paused', bot_paused_until: iso(60_000) },
        keywordAgents: [NFC_AGENT],
      },
      'chaveiro?',
    )
    expect(route).toBeNull()
  })

  it('a lapsed pause flips the bot back on and routes normally', async () => {
    const { route, updates } = await resolve(
      {
        conversation: { bot_status: 'paused', bot_paused_until: iso(-1) },
        keywordAgents: [NFC_AGENT],
      },
      'quero chaveiros',
    )
    expect(route).toMatchObject({ agentId: 'agent-nfc', decision: { kind: 'keyword' } })
    expect(updates).toContainEqual({
      table: 'conversations',
      values: { bot_status: 'active', bot_paused_until: null, bot_paused_reason: null },
    })
  })

  it('a keyword engages the agent, records it and returns its label', async () => {
    const { route, updates, inserts } = await resolve(
      { conversation: { bot_status: 'active' }, keywordAgents: [NFC_AGENT] },
      'Oi! Quanto custa o chaveiro NFC?',
    )
    expect(route).toEqual({
      agentId: 'agent-nfc',
      agentName: 'Chaveiros NFC',
      label: '🤖 Ana (assistente virtual)',
      decision: { kind: 'keyword', agentId: 'agent-nfc', keyword: 'chaveiro', source: 'inbound' },
    })
    expect(updates).toContainEqual({
      table: 'conversations',
      values: { engaged_agent_id: 'agent-nfc', engaged_at: NOW.toISOString() },
    })
    expect(inserts[0]).toMatchObject({
      table: 'conversation_messages',
      values: { role: 'system', metadata: expect.objectContaining({ type: 'agent_engaged' }) },
    })
  })

  it('an off-topic message with no always-on agent gets no reply', async () => {
    const { route } = await resolve(
      { conversation: { bot_status: 'active' }, keywordAgents: [NFC_AGENT] },
      'Vocês fazem site?',
    )
    expect(route).toBeNull()
  })

  it('follow-ups keep going to the engaged agent', async () => {
    const { route, updates } = await resolve(
      {
        conversation: { bot_status: 'active', engaged_agent_id: 'agent-nfc', engaged_at: iso(-3600_000) },
        keywordAgents: [NFC_AGENT],
      },
      'e 50 peças?',
    )
    expect(route?.decision).toEqual({ kind: 'engaged', agentId: 'agent-nfc' })
    expect(updates).toContainEqual({ table: 'conversations', values: { engaged_at: NOW.toISOString() } })
  })

  it('does not engage over a human who replied recently', async () => {
    const { route } = await resolve(
      { conversation: { bot_status: 'active' }, keywordAgents: [NFC_AGENT], recentHumanMessage: true },
      'e o chaveiro?',
    )
    expect(route).toBeNull()
  })

  it('a reply to our NFC campaign opener engages the agent', async () => {
    const { route } = await resolve(
      {
        conversation: { bot_status: 'active' },
        keywordAgents: [NFC_AGENT],
        lastOutbound: { content: 'Oi! Quer conhecer nossos chaveiros NFC?', metadata: {} },
      },
      'Quero sim',
    )
    expect(route?.decision).toMatchObject({ kind: 'keyword', source: 'outbound' })
  })

  it('falls back to the always-on channel default', async () => {
    const { route } = await resolve(
      {
        conversation: { bot_status: 'active' },
        keywordAgents: [NFC_AGENT],
        defaultAgentId: 'agent-main',
        defaultAgent: { id: 'agent-main', name: 'Ana', is_active: true, activation_keywords: [], message_label: null },
      },
      'Oi, tudo bem?',
    )
    expect(route).toMatchObject({ agentId: 'agent-main', label: null, decision: { kind: 'default' } })
  })
})
