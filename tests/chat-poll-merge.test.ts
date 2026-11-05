import { describe, expect, it } from 'vitest'

import { mergePolledMessages } from '@/lib/chat/poll-merge'
import type { ConversationMessage } from '@/types/chat'

function msg(over: Partial<ConversationMessage> & { id: string }): ConversationMessage {
  return {
    conversationId: 'c1',
    role: 'user',
    content: 'hello',
    createdAt: '2026-11-05T10:00:00.000Z',
    metadata: null,
    channel: 'sms',
    ...over,
  }
}

describe('mergePolledMessages', () => {
  it('returns the same array when the polled window matches what is on screen', () => {
    const prev = [msg({ id: 'a' }), msg({ id: 'b', createdAt: '2026-11-05T10:01:00.000Z' })]
    const result = mergePolledMessages(prev, [...prev])
    expect(result.changed).toBe(false)
    expect(result.next).toBe(prev)
    expect(result.inserted).toEqual([])
  })

  it('appends unknown messages in order and reports them as inserted', () => {
    const prev = [msg({ id: 'a' })]
    const b = msg({ id: 'b', createdAt: '2026-11-05T10:01:00.000Z', content: 'second' })
    const c = msg({ id: 'c', createdAt: '2026-11-05T10:02:00.000Z', content: 'third' })
    const result = mergePolledMessages(prev, [prev[0], b, c])
    expect(result.next.map((m) => m.id)).toEqual(['a', 'b', 'c'])
    expect(result.inserted.map((m) => m.id)).toEqual(['b', 'c'])
    expect(result.changed).toBe(true)
    // The input array is never mutated.
    expect(prev).toHaveLength(1)
  })

  it('swaps an optimistic temp bubble for the real message instead of duplicating it', () => {
    const temp = msg({
      id: 'temp-1',
      role: 'assistant',
      content: 'On my way',
      createdAt: '2026-11-05T10:00:00.000Z',
    })
    const real = msg({
      id: 'real-1',
      role: 'assistant',
      content: 'On my way',
      createdAt: '2026-11-05T10:00:05.000Z',
    })
    const result = mergePolledMessages([msg({ id: 'a' }), temp], [real])
    expect(result.next.map((m) => m.id)).toEqual(['a', 'real-1'])
    expect(result.inserted).toEqual([real])
  })

  it('does not match a temp bubble that is too old, or has different content or role', () => {
    const temp = msg({ id: 'temp-1', role: 'assistant', content: 'On my way' })
    const late = msg({
      id: 'x1',
      role: 'assistant',
      content: 'On my way',
      createdAt: '2026-11-05T10:01:00.000Z', // 60s later
    })
    const otherText = msg({ id: 'x2', role: 'assistant', content: 'Different' })
    const otherRole = msg({ id: 'x3', role: 'user', content: 'On my way' })
    const result = mergePolledMessages([temp], [late, otherText, otherRole])
    expect(result.next.map((m) => m.id)).toEqual(['temp-1', 'x1', 'x2', 'x3'])
  })

  it('keeps the optimistic bubble when the send has not landed yet', () => {
    const temp = msg({ id: 'temp-1', role: 'assistant', content: 'Pending' })
    const prev = [msg({ id: 'a' }), temp]
    const result = mergePolledMessages(prev, [prev[0]])
    expect(result.changed).toBe(false)
    expect(result.next).toContain(temp)
  })

  it('applies an in-place update (delivery status in metadata) to a message on screen', () => {
    const prev = [msg({ id: 'a', role: 'assistant', metadata: { delivery_status: 'sent' }, email_from: 'x@y.z' })]
    const updated = msg({ id: 'a', role: 'assistant', metadata: { delivery_status: 'delivered' } })
    const result = mergePolledMessages(prev, [updated])
    expect(result.changed).toBe(true)
    expect(result.inserted).toEqual([])
    expect(result.next[0].metadata).toEqual({ delivery_status: 'delivered' })
    // Fields the polled row does not carry are preserved.
    expect(result.next[0].email_from).toBe('x@y.z')
    expect(prev[0].metadata).toEqual({ delivery_status: 'sent' })
  })

  it('applies an email delivery status change and an edited body', () => {
    const prev = [msg({ id: 'a', email_delivery_status: 'sent' }), msg({ id: 'b', content: 'old' })]
    const result = mergePolledMessages(prev, [
      msg({ id: 'a', email_delivery_status: 'delivered' }),
      msg({ id: 'b', content: 'new' }),
    ])
    expect(result.next.map((m) => [m.email_delivery_status ?? null, m.content])).toEqual([
      ['delivered', 'hello'],
      [null, 'new'],
    ])
  })

  it('leaves older messages loaded with "load more" untouched', () => {
    const older = msg({ id: 'old', createdAt: '2026-11-04T09:00:00.000Z' })
    const a = msg({ id: 'a' })
    const result = mergePolledMessages([older, a], [a, msg({ id: 'b', createdAt: '2026-11-05T10:01:00.000Z' })])
    expect(result.next.map((m) => m.id)).toEqual(['old', 'a', 'b'])
  })

  it('is idempotent: merging the same window twice inserts nothing the second time', () => {
    const polled = [msg({ id: 'a' }), msg({ id: 'b', createdAt: '2026-11-05T10:01:00.000Z' })]
    const first = mergePolledMessages([], polled)
    const second = mergePolledMessages(first.next, polled)
    expect(first.inserted).toHaveLength(2)
    expect(second.changed).toBe(false)
    expect(second.next).toBe(first.next)
  })
})
