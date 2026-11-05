import { beforeEach, describe, expect, it, vi } from 'vitest'

// The Inbox filter panel offered several values per section, an assignee, labels and
// "unread", but the route forwarded only some of them, one value each. These tests pin
// what reaches inbox_entries for every filter.

const rpc = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  getUser: vi.fn(async () => ({ id: '00000000-0000-4000-8000-000000000001' })),
  createClient: vi.fn(async () => ({
    rpc,
    from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) }),
  })),
}))

import { GET } from '@/app/api/chat/conversations/route'

const LABEL = '11111111-1111-4111-8111-111111111111'
const PHONE_A = '22222222-2222-4222-8222-222222222222'
const PHONE_B = '33333333-3333-4333-8333-333333333333'
const MEMBER = '44444444-4444-4444-8444-444444444444'

async function call(query: string) {
  await GET(new Request(`http://localhost/api/chat/conversations?${query}`))
  return rpc.mock.calls
}

function pageArgs(calls: unknown[][]) {
  const page = calls.find(([name, args]) => name === 'inbox_entries' && (args as { p_pinned: boolean }).p_pinned === false)
  return page?.[1] as Record<string, unknown>
}

beforeEach(() => {
  rpc.mockReset()
  rpc.mockImplementation(async (name: string) => ({ data: name === 'inbox_entries_count' ? 0 : [], error: null }))
})

describe('GET /api/chat/conversations filters', () => {
  it('sends every status picked, not just the first', async () => {
    const args = pageArgs(await call('status=open,pending,closed'))
    expect(args.p_statuses).toEqual(['open', 'pending', 'closed'])
  })

  it('drops unknown values instead of sending them', async () => {
    const args = pageArgs(await call('status=open,bogus&priority=urgent,nope&botStatus=paused,x'))
    expect(args.p_statuses).toEqual(['open'])
    expect(args.p_priorities).toEqual(['urgent'])
    expect(args.p_bot_statuses).toEqual(['paused'])
  })

  it('sends unread as its own filter', async () => {
    const args = pageArgs(await call('unread=1'))
    expect(args.p_unread_only).toBe(true)
    expect(args.p_statuses).toBeNull()
  })

  it('sends assignees, unassigned, labels and numbers', async () => {
    const args = pageArgs(
      await call(`assignedUserIds=${MEMBER},unassigned&labelIds=${LABEL}&phone_number_id=${PHONE_A},${PHONE_B}`),
    )
    expect(args.p_assigned_user_ids).toEqual([MEMBER])
    expect(args.p_include_unassigned).toBe(true)
    expect(args.p_label_ids).toEqual([LABEL])
    expect(args.p_phone_number_ids).toEqual([PHONE_A, PHONE_B])
  })

  it('applies the same filters to the pinned section and the count', async () => {
    const calls = await call('status=pending&unread=1')
    for (const [, args] of calls) {
      expect((args as Record<string, unknown>).p_statuses).toEqual(['pending'])
      expect((args as Record<string, unknown>).p_unread_only).toBe(true)
    }
  })

  it('"Pinned" only loads the pinned section', async () => {
    const calls = await call('pinned=1')
    expect(calls.map(([name]) => name)).toEqual(['inbox_entries'])
    expect((calls[0][1] as { p_pinned: boolean }).p_pinned).toBe(true)
  })
})
