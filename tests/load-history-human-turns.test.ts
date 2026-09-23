// loadHistoryWindow: human operator replies are flagged for the model and
// agent reply labels are stripped (migration 1302).

import { describe, it, expect, vi } from 'vitest'
import { loadHistoryWindow, HUMAN_TURN_PREFIX } from '@/lib/agent-runtime/load-history'

function supabaseWith(rowsNewestFirst: Array<Record<string, unknown>>) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: rowsNewestFirst, error: null }),
  }
  return { from: vi.fn(() => chain) }
}

describe('loadHistoryWindow', () => {
  it('marks human turns and strips the bot label', async () => {
    const label = '🤖 Ana (assistente virtual)'
    const supabase = supabaseWith([
      { role: 'user', content: 'e 50?', metadata: {} },
      { role: 'assistant', content: 'Oi, aqui é o Vanildo!', metadata: { sender_type: 'human' } },
      { role: 'system', content: '🤖 Chaveiros NFC assumiu a conversa', metadata: {} },
      {
        role: 'assistant',
        content: `${label}\n20 peças saem por US$ 200.`,
        metadata: { source: 'agent', agent_label: label },
      },
      { role: 'user', content: 'quanto custa o chaveiro?', metadata: {} },
    ])

    const turns = await loadHistoryWindow({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: supabase as any,
      conversationId: 'conv-1',
      currentUserMessage: 'e 50?',
    })

    expect(turns).toEqual([
      { role: 'user', content: 'quanto custa o chaveiro?' },
      { role: 'assistant', content: '20 peças saem por US$ 200.' },
      { role: 'assistant', content: `${HUMAN_TURN_PREFIX}Oi, aqui é o Vanildo!` },
    ])
  })
})
