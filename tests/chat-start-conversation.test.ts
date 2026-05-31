import { describe, it, expect, vi, beforeEach } from 'vitest'

// Shared client the mocked createClient() returns. Reassigned per test.
type AnyObj = Record<string, unknown>
let mockClient: AnyObj
let lastInserts: Array<{ table: string; values: AnyObj }>
let lastUpdates: Array<{ table: string; values: AnyObj }>

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => mockClient,
  getUser: () => ({ id: 'user-1' }),
}))

vi.mock('@/lib/contacts/server', () => ({
  // Identity passthrough — tests don't exercise the merge-redirect path.
  resolveLiveContactId: (id: string) => id,
}))

/**
 * Build a chainable Supabase-like client whose terminal calls (maybeSingle /
 * single) resolve based on the table being queried and whether insert() was
 * called in that chain.
 */
function makeClient(opts: {
  orgId?: string | null
  existingConversation?: AnyObj | null
  createdConversation?: AnyObj | null
  contact?: AnyObj | null
  twilioNumber?: AnyObj | null
}) {
  lastInserts = []
  lastUpdates = []
  return {
    rpc: vi.fn().mockResolvedValue({ data: opts.orgId ?? 'org-1' }),
    from: vi.fn((table: string) => {
      let isInsert = false
      const builder: AnyObj = {}
      const chain = () => builder
      Object.assign(builder, {
        select: vi.fn(chain),
        eq: vi.fn(chain),
        order: vi.fn(chain),
        limit: vi.fn(chain),
        insert: vi.fn((values: AnyObj) => {
          isInsert = true
          lastInserts.push({ table, values })
          return builder
        }),
        update: vi.fn((values: AnyObj) => {
          lastUpdates.push({ table, values })
          return builder
        }),
        maybeSingle: vi.fn(() => Promise.resolve(resolve())),
        single: vi.fn(() => Promise.resolve(resolve())),
      })
      function resolve() {
        if (table === 'conversations') {
          return isInsert
            ? { data: opts.createdConversation ?? null, error: null }
            : { data: opts.existingConversation ?? null, error: null }
        }
        if (table === 'contacts') return { data: opts.contact ?? null, error: null }
        if (table === 'twilio_phone_numbers') return { data: opts.twilioNumber ?? null, error: null }
        return { data: null, error: null }
      }
      return builder
    }),
  }
}

import { createContactConversation } from '@/app/(dashboard)/chat/actions'

const CONV_ROW = {
  id: 'conv-1',
  status: 'open',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  channel: 'sms',
  channel_metadata: { to_number: '+15551230000' },
  bot_status: 'active',
  contact_id: 'contact-1',
  visitor_phone: '+15551230000',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createContactConversation', () => {
  it('reuses an existing conversation on the same channel (no insert)', async () => {
    mockClient = makeClient({ existingConversation: CONV_ROW })
    const res = await createContactConversation('contact-1', 'sms')
    expect('conversation' in res).toBe(true)
    if ('conversation' in res) {
      expect(res.conversation.id).toBe('conv-1')
      expect(res.conversation.botStatus).toBe('paused')
    }
    expect(lastInserts.length).toBe(0)
    expect(lastUpdates.find((u) => u.table === 'conversations')?.values).toMatchObject({
      bot_status: 'paused',
    })
  })

  it('creates an SMS conversation with visitor_phone + to_number metadata', async () => {
    mockClient = makeClient({
      existingConversation: null,
      contact: { phone: '+1 555 123 0000', phone_e164: '+15551230000' },
      twilioNumber: { id: 'num-1' },
      createdConversation: CONV_ROW,
    })
    const res = await createContactConversation('contact-1', 'sms')
    expect('conversation' in res).toBe(true)
    const convInsert = lastInserts.find((i) => i.table === 'conversations')
    expect(convInsert).toBeTruthy()
    expect(convInsert?.values).toMatchObject({
      channel: 'sms',
      contact_id: 'contact-1',
      bot_status: 'paused',
      visitor_phone: '+15551230000',
      channel_metadata: { to_number: '+15551230000' },
      phone_number_id: 'num-1',
    })
  })

  it('errors when starting SMS for a contact without a phone', async () => {
    mockClient = makeClient({
      existingConversation: null,
      contact: { phone: null, phone_e164: null },
    })
    const res = await createContactConversation('contact-1', 'sms')
    expect('error' in res).toBe(true)
    expect(lastInserts.find((i) => i.table === 'conversations')).toBeUndefined()
  })

  it('creates a manual placeholder when no real channel is available', async () => {
    mockClient = makeClient({
      existingConversation: null,
      createdConversation: { ...CONV_ROW, channel: 'manual' },
    })
    const res = await createContactConversation('contact-1', 'manual')
    expect('conversation' in res).toBe(true)
    const convInsert = lastInserts.find((i) => i.table === 'conversations')
    expect(convInsert?.values).toMatchObject({
      channel: 'manual',
      contact_id: 'contact-1',
      bot_status: 'paused',
    })
  })
})
