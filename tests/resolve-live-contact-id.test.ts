import { vi, describe, it, expect, beforeEach } from 'vitest'

// MUST be first — server-only throws on import outside Next bundling.
// vi.mock is hoisted by Vitest so this neutralizes the throw before the SUT loads.
vi.mock('server-only', () => ({}))

const mockMaybeSingle = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: mockMaybeSingle }),
      }),
    }),
  }),
}))

import { resolveLiveContactId } from '@/lib/contacts/server'

describe('resolveLiveContactId', () => {
  beforeEach(() => {
    mockMaybeSingle.mockReset()
  })

  it('returns input for live contact', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: 'live-1', identity_status: 'identified', merged_into_contact_id: null },
      error: null,
    })
    expect(await resolveLiveContactId('live-1')).toBe('live-1')
  })

  it('returns merged_into for archived contact (one hop)', async () => {
    mockMaybeSingle
      .mockResolvedValueOnce({
        data: { id: 'arch-1', identity_status: 'archived_duplicate', merged_into_contact_id: 'live-2' },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: 'live-2', identity_status: 'identified', merged_into_contact_id: null },
        error: null,
      })
    expect(await resolveLiveContactId('arch-1')).toBe('live-2')
  })

  it('returns input on DB error (defensive)', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
    expect(await resolveLiveContactId('any')).toBe('any')
  })

  it('returns input for not-found contact', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null })
    expect(await resolveLiveContactId('missing')).toBe('missing')
  })

  it('returns input for archived row with null merged_into (defensive)', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: 'orphan', identity_status: 'archived_duplicate', merged_into_contact_id: null },
      error: null,
    })
    expect(await resolveLiveContactId('orphan')).toBe('orphan')
  })

  it('returns empty string unchanged', async () => {
    expect(await resolveLiveContactId('')).toBe('')
    expect(mockMaybeSingle).not.toHaveBeenCalled()
  })
})
