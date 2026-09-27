// Burst coalescing: only the newest inbound message of a burst gets a reply,
// and it routes on the text of the whole burst.

import { describe, it, expect, vi } from 'vitest'
import { coalesceInbound, coalesceWindowMs } from '@/lib/agent-runtime/coalesce'

type Result = { data: unknown; error: unknown }

/** First query: "is there a newer message?"; second: the recent rows, newest first. */
function supabaseReturning(newer: Result | Error, recent: Result = { data: [], error: null }) {
  const calls: string[] = []
  const make = (terminal: () => Promise<Result>) => {
    const chain: Record<string, unknown> = {}
    const self = (name: string) => (...args: unknown[]) => {
      calls.push(`${name}:${JSON.stringify(args)}`)
      return chain
    }
    for (const m of ['select', 'eq', 'neq', 'gt', 'gte', 'lte', 'order']) chain[m] = self(m)
    chain.limit = (...args: unknown[]) => {
      calls.push(`limit:${JSON.stringify(args)}`)
      const result = terminal()
      return Object.assign(result, { maybeSingle: () => result })
    }
    chain.maybeSingle = () => terminal()
    return chain
  }
  let n = 0
  const client = {
    from: vi.fn(() => {
      n += 1
      if (n === 1) return make(() => (newer instanceof Error ? Promise.reject(newer) : Promise.resolve(newer)))
      return make(() => Promise.resolve(recent))
    }),
  }
  return { client: client as never, calls, from: client.from }
}

const base = { conversationId: 'c1', sentAt: '2026-09-27T12:00:06.000Z', text: 'uns 50', windowMs: 1 }

describe('coalesceInbound', () => {
  it('the newest message routes on the whole burst, oldest first', async () => {
    const { client } = supabaseReturning(
      { data: null, error: null },
      {
        data: [
          { role: 'user', content: 'uns 50' },
          { role: 'user', content: 'quanto custa o chaveiro?' },
          { role: 'assistant', content: 'Oi! Em que posso ajudar?' },
          { role: 'user', content: 'oi' },
        ],
        error: null,
      },
    )
    await expect(coalesceInbound({ supabase: client, ...base })).resolves.toEqual({
      latest: true,
      routingText: 'quanto custa o chaveiro?\nuns 50',
    })
  })

  it('stands down when a newer message in the burst will answer', async () => {
    const { client } = supabaseReturning({ data: { id: 'm2' }, error: null })
    await expect(coalesceInbound({ supabase: client, ...base })).resolves.toMatchObject({ latest: false })
  })

  it('answers alone on a query error or failure rather than dropping the reply', async () => {
    const failed = supabaseReturning({ data: null, error: { message: 'boom' } })
    await expect(coalesceInbound({ supabase: failed.client, ...base })).resolves.toEqual({
      latest: true,
      routingText: 'uns 50',
    })
    const threw = supabaseReturning(new Error('network'))
    await expect(coalesceInbound({ supabase: threw.client, ...base })).resolves.toEqual({
      latest: true,
      routingText: 'uns 50',
    })
  })

  it('a zero window skips the wait and every query', async () => {
    const { client, from } = supabaseReturning({ data: { id: 'm2' }, error: null })
    await expect(coalesceInbound({ supabase: client, ...base, windowMs: 0 })).resolves.toEqual({
      latest: true,
      routingText: 'uns 50',
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('the window is configurable and never sleeps under test by default', () => {
    expect(coalesceWindowMs()).toBe(0)
    vi.stubEnv('AGENT_REPLY_COALESCE_MS', '2500')
    expect(coalesceWindowMs()).toBe(2500)
    vi.unstubAllEnvs()
  })
})
