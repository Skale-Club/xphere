// contact_create tells the team about every message, not only first-time callers.
//
// contact.created fires on a real insert only, so a known contact who phoned
// the receptionist with a problem had the message appended to their notes and
// nobody was told. contact.captured fires on both paths, carrying this call's
// own message.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { emitContactEventMock, state } = vi.hoisted(() => ({
  emitContactEventMock: vi.fn(async () => ({ dispatched: 1, dispatch_id: 'd1' })),
  state: { existing: null as { id: string } | null, notes: 'Primeira ligação: orçamento de site' },
}))

vi.mock('@/lib/contacts/events', () => ({ emitContactEvent: emitContactEventMock }))

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => ({
    from: () => {
      const chain: Record<string, unknown> = {}
      const self = () => chain
      Object.assign(chain, {
        select: self,
        eq: self,
        in: self,
        neq: self,
        order: self,
        limit: () => Promise.resolve({ data: state.existing ? [state.existing] : [], error: null }),
        maybeSingle: () => Promise.resolve({ data: state.existing, error: null }),
        single: () => Promise.resolve({ data: state.existing ? { notes: state.notes } : { id: 'new-1' }, error: null }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        insert: () => chain,
      })
      return chain
    },
  }),
}))

describe('contact_create → contact.captured', () => {
  beforeEach(() => {
    emitContactEventMock.mockClear()
  })

  it('a known caller still reaches the team, with only this call’s message', async () => {
    state.existing = { id: 'contact-1' }
    const { executeCreateCrmContact } = await import('@/lib/action-engine/executors/create-crm-contact')

    await executeCreateCrmContact(
      { name: 'Marcos', notes: 'Chaveiros chegaram e dois não funcionam', source: 'voice_call' },
      'org-1',
      { callerNumber: '+15085550199' },
    )

    const events = emitContactEventMock.mock.calls.map((c) => (c as unknown[])[1])
    expect(events).toEqual(['contact.captured'])
    expect(emitContactEventMock).toHaveBeenCalledWith(
      'org-1',
      'contact.captured',
      'contact-1',
      expect.objectContaining({
        payload: {
          capture: { notes: 'Chaveiros chegaram e dois não funcionam', source: 'voice_call', is_new: false },
        },
      }),
    )
  })

  it('a new caller fires contact.created and contact.captured', async () => {
    state.existing = null
    const { executeCreateCrmContact } = await import('@/lib/action-engine/executors/create-crm-contact')

    await executeCreateCrmContact(
      { name: 'Ana', notes: 'Quer um site', source: 'voice_call' },
      'org-1',
      { callerNumber: '+15085550100' },
    )

    const events = emitContactEventMock.mock.calls.map((c) => (c as unknown[])[1])
    expect(events).toEqual(['contact.created', 'contact.captured'])
    expect(emitContactEventMock).toHaveBeenLastCalledWith(
      'org-1',
      'contact.captured',
      'new-1',
      expect.objectContaining({ payload: { capture: { notes: 'Quer um site', source: 'voice_call', is_new: true } } }),
    )
  })
})
