import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

import { FakeDb } from './helpers/fake-supabase'

const dispatched: string[] = []
const proposals: { command: { type: string }; actor: { label: string; autoApproved?: boolean } }[] = []
let googleReviews: unknown[] = []

vi.mock('@/lib/local-seo/workflow-events', () => ({
  dispatchLocalSeoWorkflowEvent: async (_a: unknown, _o: string, event: string) => {
    dispatched.push(event)
    return { dispatched: 0 }
  },
}))
vi.mock('@/lib/notifications/insert', () => ({ insertNotification: async () => {} }))
vi.mock('@/lib/gbp/replies', () => ({
  getReplySettings: async () => ({ tone: 't', signature: null, instructions: null, autoReplyPositive: true, autoReplyMinRating: 4 }),
  generateReplyDraft: async (_a: unknown, i: { reviewId: string }) => ({ ok: true, draftId: `d-${i.reviewId}`, text: 'Thanks!' }),
}))
vi.mock('@/lib/gbp/commands', () => ({
  proposeChange: async (_a: unknown, input: (typeof proposals)[number]) => {
    proposals.push(input)
    return { ok: true, change: { id: 'c', status: 'succeeded', error_message: null }, executed: true }
  },
}))
vi.mock('@/lib/gbp/client', async (orig) => {
  const actual = await orig<typeof import('@/lib/gbp/client')>()
  return {
    ...actual,
    GbpClient: {
      forLocation: async () => ({
        accountName: 'accounts/1',
        locationName: 'locations/1',
        client: { listReviews: async () => ({ reviews: googleReviews, averageRating: 4.6, totalReviewCount: 3 }) },
      }),
    },
  }
})

import { publishDuePosts, syncReviews } from '@/lib/gbp/sync'

const asAdmin = (db: FakeDb) => db as unknown as SupabaseClient<Database>
const review = (id: string, star: string, reply?: string) => ({
  name: `accounts/1/locations/1/reviews/${id}`,
  starRating: star,
  comment: `review ${id}`,
  createTime: '2026-10-01T00:00:00Z',
  reviewer: { displayName: `R${id}` },
  ...(reply ? { reviewReply: { comment: reply } } : {}),
})

function seed(syncedBefore: boolean) {
  const db = new FakeDb((table, row) => (table === 'gbp_reviews' ? { reply_state: 'none', ...row } : row))
  db.rows('local_seo_locations').push({
    id: 'loc', org_id: 'org', name: 'Bigode', business_name: 'Bigode', gbp_location_name: 'locations/1', gbp_connection_id: 'c1',
    gbp_reviews_synced_at: syncedBefore ? '2026-10-01T00:00:00Z' : null,
  })
  return db
}

beforeEach(() => {
  dispatched.length = 0
  proposals.length = 0
})

describe('syncReviews', () => {
  it('imports history silently on the first sync', async () => {
    googleReviews = [review('1', 'FIVE'), review('2', 'ONE', 'We are sorry')]
    const db = seed(false)
    const loc = db.rows('local_seo_locations')[0] as Database['public']['Tables']['local_seo_locations']['Row']
    expect(await syncReviews(asAdmin(db), loc)).toEqual({ fetched: 2, created: 0 })
    expect(db.rows('gbp_reviews')).toMatchObject([
      { rating: 5, reply_state: 'none', reviewer_name: 'R1' },
      { rating: 1, reply_state: 'replied', reply_comment: 'We are sorry' },
    ])
    expect(db.rows('local_seo_locations')[0]).toMatchObject({ rating: 4.6, reviews_count: 3 })
    expect(dispatched).toEqual([])
  })

  it('fires events for new reviews and auto-replies only to positive ones', async () => {
    const db = seed(true)
    db.rows('gbp_reviews').push({ id: 'old', review_name: 'accounts/1/locations/1/reviews/1', reply_state: 'replied' })
    googleReviews = [review('1', 'FIVE', 'thanks'), review('3', 'FOUR'), review('4', 'TWO')]
    const loc = db.rows('local_seo_locations')[0] as Database['public']['Tables']['local_seo_locations']['Row']
    const res = await syncReviews(asAdmin(db), loc)
    expect(res.created).toBe(2)
    expect(dispatched.sort()).toEqual(['gbp.review_negative', 'gbp.review_received', 'gbp.review_received'])
    expect(proposals).toHaveLength(1)
    expect(proposals[0]).toMatchObject({ command: { type: 'review.reply' }, actor: { autoApproved: true } })
  })
})

describe('publishDuePosts', () => {
  it('publishes due posts once and schedules the next recurrence', async () => {
    const db = new FakeDb()
    db.rows('gbp_posts').push(
      { id: 'p1', org_id: 'org', location_id: 'loc', status: 'scheduled', scheduled_for: '2026-10-05T09:00:00.000Z', recurrence: 'weekly', summary: 's', topic_type: 'STANDARD' },
      { id: 'p2', org_id: 'org', location_id: 'loc', status: 'scheduled', scheduled_for: '2026-10-09T09:00:00.000Z', recurrence: 'none', summary: 's2', topic_type: 'STANDARD' },
    )
    const n = await publishDuePosts(asAdmin(db), new Date('2026-10-05T09:05:00Z'))
    expect(n).toBe(1)
    const next = db.rows('gbp_posts').find((p) => p.id !== 'p1' && p.id !== 'p2')
    expect(next).toMatchObject({ status: 'scheduled', scheduled_for: '2026-10-12T09:00:00.000Z', recurrence: 'weekly' })
    expect(await publishDuePosts(asAdmin(db), new Date('2026-10-05T09:06:00Z'))).toBe(0)
  })
})
