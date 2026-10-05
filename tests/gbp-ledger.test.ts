import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

import { FakeDb } from './helpers/fake-supabase'

// A fake Google: state the ledger reads back after writing.
const google = {
  replies: new Map<string, string>(),
  profile: {
    name: 'locations/1',
    title: 'Bigode',
    profile: { description: 'Old description' },
    websiteUri: 'https://old.example',
    phoneNumbers: { primaryPhone: '+55 11 1111-1111' },
    regularHours: { periods: [{ openDay: 'MONDAY', openTime: { hours: 9 }, closeDay: 'MONDAY', closeTime: { hours: 18 } }] },
  } as Record<string, unknown>,
  posts: [] as unknown[],
  failNextReply: false,
}

const fakeClient = {
  getReview: async (name: string) => ({ name, reviewReply: google.replies.has(name) ? { comment: google.replies.get(name) } : undefined }),
  updateReply: async (name: string, comment: string) => {
    if (google.failNextReply) {
      google.failNextReply = false
      const { GbpApiError } = await import('@/lib/gbp/client')
      throw new GbpApiError('transient', 503, 'backend error')
    }
    google.replies.set(name, comment)
    return { comment }
  },
  deleteReply: async (name: string) => {
    google.replies.delete(name)
    return {}
  },
  getLocation: async () => structuredClone(google.profile),
  patchLocation: async (_n: string, mask: string[], body: Record<string, unknown>, validateOnly: boolean) => {
    if (!validateOnly) {
      if (mask.includes('profile.description')) google.profile.profile = body.profile
      if (mask.includes('websiteUri')) google.profile.websiteUri = body.websiteUri
    }
    return google.profile
  },
  createLocalPost: async (_a: string, _l: string, post: unknown) => {
    google.posts.push(post)
    return { name: 'accounts/1/locations/1/localPosts/9', searchUrl: 'https://g.page/x' }
  },
  deleteLocalPost: async () => ({}),
}

vi.mock('@/lib/gbp/client', async (orig) => {
  const actual = await orig<typeof import('@/lib/gbp/client')>()
  return {
    ...actual,
    GbpClient: { forLocation: async () => ({ client: fakeClient, accountName: 'accounts/1', locationName: 'locations/1' }) },
  }
})

import { approveChange, executeChange, proposeChange, rejectChange, rollbackChange } from '@/lib/gbp/commands'

const ORG = 'org-gbp'
const asAdmin = (db: FakeDb) => db as unknown as SupabaseClient<Database>
const approver = { type: 'user' as const, id: 'u-approver', label: 'owner', canApprove: true }
const member = { type: 'user' as const, id: 'u-member', label: 'member', canApprove: false }

function seed() {
  const db = new FakeDb((table, row) => {
    if (table === 'gbp_change_requests') return { attempt_count: 0, rollback_of: null, error_message: null, ...row }
    if (table === 'gbp_posts') return { status: 'draft', topic_type: 'STANDARD', recurrence: 'none', ...row }
    return row
  })
  db.rows('local_seo_locations').push({ id: 'loc', org_id: ORG, gbp_location_name: 'locations/1', gbp_connection_id: 'c1', language: 'pt' })
  db.rows('gbp_reviews').push(
    { id: 'r5', org_id: ORG, location_id: 'loc', review_name: 'accounts/1/locations/1/reviews/5', rating: 5, reply_comment: null, reply_state: 'none' },
    { id: 'r2', org_id: ORG, location_id: 'loc', review_name: 'accounts/1/locations/1/reviews/2', rating: 2, reply_comment: null, reply_state: 'none' },
  )
  return db
}

const events = (db: FakeDb, id: string) => db.rows('gbp_change_events').filter((e) => e.change_request_id === id).map((e) => e.event_type)

beforeEach(() => {
  google.replies.clear()
  google.profile.profile = { description: 'Old description' }
  google.profile.websiteUri = 'https://old.example'
  google.posts.length = 0
})

describe('review replies', () => {
  it('publishes immediately for an approver and verifies by reading back', async () => {
    const db = seed()
    const res = await proposeChange(asAdmin(db), { orgId: ORG, locationId: 'loc', command: { type: 'review.reply', reviewId: 'r2', comment: 'Sorry about that.' }, actor: approver })
    expect(res.ok && res.change.status).toBe('succeeded')
    expect(google.replies.get('accounts/1/locations/1/reviews/2')).toBe('Sorry about that.')
    expect(db.rows('gbp_reviews').find((r) => r.id === 'r2')).toMatchObject({ reply_state: 'replied', reply_comment: 'Sorry about that.' })
    if (res.ok) expect(events(db, res.change.id)).toEqual(['proposed', 'executing', 'succeeded'])
  })

  it('holds a member reply until an approver releases it', async () => {
    const db = seed()
    const res = await proposeChange(asAdmin(db), { orgId: ORG, locationId: 'loc', command: { type: 'review.reply', reviewId: 'r5', comment: 'Thanks!' }, actor: member })
    expect(res.ok && res.change.status).toBe('awaiting_approval')
    expect(google.replies.size).toBe(0)
    expect(db.rows('gbp_reviews').find((r) => r.id === 'r5')?.reply_state).toBe('pending')

    const approved = await approveChange(asAdmin(db), ORG, res.ok ? res.change.id : '', approver)
    expect(approved.ok && approved.change.status).toBe('succeeded')
    expect(google.replies.get('accounts/1/locations/1/reviews/5')).toBe('Thanks!')
  })

  it('auto-replies to positive reviews only', async () => {
    const db = seed()
    const auto = { type: 'ai' as const, label: 'auto', autoApproved: true }
    const pos = await proposeChange(asAdmin(db), { orgId: ORG, locationId: 'loc', command: { type: 'review.reply', reviewId: 'r5', comment: 'Thank you!' }, actor: auto })
    expect(pos.ok && pos.change.status).toBe('succeeded')
    const neg = await proposeChange(asAdmin(db), { orgId: ORG, locationId: 'loc', command: { type: 'review.reply', reviewId: 'r2', comment: 'Sorry' }, actor: auto })
    expect(neg.ok && neg.change.status).toBe('awaiting_approval')
  })

  it('rejecting frees the review for a new reply', async () => {
    const db = seed()
    const res = await proposeChange(asAdmin(db), { orgId: ORG, locationId: 'loc', command: { type: 'review.reply', reviewId: 'r2', comment: 'x' }, actor: member })
    if (!res.ok) throw new Error(res.message)
    await rejectChange(asAdmin(db), ORG, res.change.id, approver)
    expect(db.rows('gbp_change_requests')[0].status).toBe('rejected')
    expect(db.rows('gbp_reviews').find((r) => r.id === 'r2')?.reply_state).toBe('none')
  })

  it('requeues on a transient Google error, then succeeds on retry', async () => {
    const db = seed()
    google.failNextReply = true
    const res = await proposeChange(asAdmin(db), { orgId: ORG, locationId: 'loc', command: { type: 'review.reply', reviewId: 'r5', comment: 'Thanks' }, actor: approver })
    expect(res.ok && res.change.status).toBe('queued')
    const again = await executeChange(asAdmin(db), res.ok ? res.change.id : '')
    expect(again?.status).toBe('succeeded')
  })

  it('refuses an empty or unchanged reply', async () => {
    const db = seed()
    const empty = await proposeChange(asAdmin(db), { orgId: ORG, locationId: 'loc', command: { type: 'review.reply', reviewId: 'r5', comment: '  ' }, actor: approver })
    expect(empty).toMatchObject({ ok: false, code: 'invalid' })
  })
})

describe('profile edits', () => {
  it('publishes, verifies, annotates and can be rolled back', async () => {
    const db = seed()
    const res = await proposeChange(asAdmin(db), {
      orgId: ORG,
      locationId: 'loc',
      command: { type: 'profile.update', patch: { description: 'New description', websiteUri: 'https://new.example' } },
      actor: approver,
    })
    if (!res.ok) throw new Error(res.message)
    expect(res.change.status).toBe('succeeded')
    expect(res.change.diff).toEqual([
      { field: 'description', before: 'Old description', after: 'New description' },
      { field: 'websiteUri', before: 'https://old.example', after: 'https://new.example' },
    ])
    expect(db.rows('local_seo_annotations')).toMatchObject([{ kind: 'profile_change' }])

    const back = await rollbackChange(asAdmin(db), ORG, res.change.id, approver)
    expect(back.ok && back.change.status).toBe('succeeded')
    expect(back.ok && back.change.rollback_of).toBe(res.change.id)
    expect((google.profile.profile as { description: string }).description).toBe('Old description')
  })

  it('stops with drifted when the field changed after the proposal', async () => {
    const db = seed()
    const res = await proposeChange(asAdmin(db), { orgId: ORG, locationId: 'loc', command: { type: 'profile.update', patch: { description: 'Mine' } }, actor: member })
    if (!res.ok) throw new Error(res.message)
    google.profile.profile = { description: 'Changed by Google' }
    const approved = await approveChange(asAdmin(db), ORG, res.change.id, approver)
    expect(approved.ok && approved.change.status).toBe('drifted')
    expect((google.profile.profile as { description: string }).description).toBe('Changed by Google')
  })

  it('reports a no-op instead of recording an empty change', async () => {
    const db = seed()
    const res = await proposeChange(asAdmin(db), { orgId: ORG, locationId: 'loc', command: { type: 'profile.update', patch: { description: 'Old description' } }, actor: approver })
    expect(res).toMatchObject({ ok: false, code: 'no_op' })
  })
})

describe('posts', () => {
  it('publishes a post, marks it live and annotates the trend chart', async () => {
    const db = seed()
    db.rows('gbp_posts').push({ id: 'p1', org_id: ORG, location_id: 'loc', summary: 'Open on Sunday!', status: 'draft', topic_type: 'STANDARD', cta_type: 'CALL', cta_url: null, media_url: null, event: null, offer: null })
    const res = await proposeChange(asAdmin(db), { orgId: ORG, locationId: 'loc', command: { type: 'post.create', postId: 'p1' }, actor: approver })
    expect(res.ok && res.change.status).toBe('succeeded')
    expect(google.posts[0]).toMatchObject({ summary: 'Open on Sunday!', languageCode: 'pt', callToAction: { actionType: 'CALL' } })
    expect(db.rows('gbp_posts')[0]).toMatchObject({ status: 'live', post_name: 'accounts/1/locations/1/localPosts/9' })
    expect(db.rows('local_seo_annotations')).toMatchObject([{ kind: 'post' }])
  })

  it('refuses to act on a location without a GBP link', async () => {
    const db = seed()
    db.rows('local_seo_locations')[0].gbp_location_name = null
    const res = await proposeChange(asAdmin(db), { orgId: ORG, locationId: 'loc', command: { type: 'post.create', postId: 'p1' }, actor: approver })
    expect(res).toMatchObject({ ok: false, code: 'not_connected' })
  })
})
