import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

import { FakeDb } from './helpers/fake-supabase'

// Local SEO Business Profile writes, end to end through the real Ads Command
// Engine and Google Business adapter: one in-memory database for both Local
// SEO and the engine ledger, and a fake Google behind the API module.

let db: FakeDb

vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: () => db }))
vi.mock('@/lib/crypto', () => ({
  encrypt: async (s: string) => `enc:${s}`,
  decrypt: async (s: string) => s.replace(/^enc:/, ''),
}))
vi.mock('@/lib/ads/safe-fetch', () => ({ assertPublicHttpsUrl: vi.fn() }))

// What Google returns. Like the real API, it drops zero values from times.
const google = {
  replies: new Map<string, string>(),
  profile: {} as Record<string, unknown>,
  posts: new Map<string, Record<string, unknown>>(),
  writes: 0,
  failNextReply: false,
}

function dropZeros(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dropZeros)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== 0 && v !== false)
        .map(([k, v]) => [k, dropZeros(v)]),
    )
  }
  return value
}

vi.mock('@/lib/google-business/api', async (orig) => {
  const actual = await orig<typeof import('@/lib/google-business/api')>()
  const notFound = () => new actual.GoogleBusinessError('Requested entity was not found.', 404, 'NOT_FOUND')
  return {
    ...actual,
    getGoogleBusinessLocation: async () => structuredClone(google.profile),
    patchGoogleBusinessLocation: async (_t: string, _c: string, body: Record<string, unknown>, mask: string[], validateOnly = false) => {
      if (validateOnly) return {}
      google.writes++
      for (const field of mask) {
        if (field === 'profile.description') {
          const d = (body.profile as { description: string }).description
          google.profile.profile = d ? { description: d } : {}
        }
        if (field === 'websiteUri') {
          if (body.websiteUri) google.profile.websiteUri = body.websiteUri
          else delete google.profile.websiteUri
        }
        if (field === 'phoneNumbers.primaryPhone') google.profile.phoneNumbers = body.phoneNumbers
        if (field === 'regularHours') google.profile.regularHours = dropZeros(body.regularHours)
      }
      return structuredClone(google.profile)
    },
    getGoogleBusinessReview: async (_t: string, _c: string, id: string) => ({
      name: id,
      reviewer: { displayName: 'Ana' },
      ...(google.replies.has(id) ? { reviewReply: { comment: google.replies.get(id) } } : {}),
    }),
    replyToGoogleBusinessReview: async (_t: string, _c: string, id: string, comment: string) => {
      if (google.failNextReply) {
        google.failNextReply = false
        throw new actual.GoogleBusinessError('Backend error', 503, 'UNAVAILABLE')
      }
      google.writes++
      google.replies.set(id, comment)
      return { comment }
    },
    deleteGoogleBusinessReviewReply: async (_t: string, _c: string, id: string) => {
      google.writes++
      google.replies.delete(id)
      return {}
    },
    createGoogleBusinessLocalPost: async (target: string, _c: string, body: Record<string, unknown>) => {
      google.writes++
      const name = `${target}/localPosts/${google.posts.size + 1}`
      google.posts.set(name, { name, ...body })
      return { name, ...body }
    },
    getGoogleBusinessLocalPost: async (_t: string, _c: string, id: string) => {
      const post = google.posts.get(id)
      if (!post) throw notFound()
      return structuredClone(post)
    },
    deleteGoogleBusinessLocalPost: async (_t: string, _c: string, id: string) => {
      google.writes++
      google.posts.delete(id)
      return {}
    },
  }
})

import { approveChange, postCreateCommand, profileCommands, proposeChange, rejectChange, rollbackChange } from '@/lib/gbp/commands'

const ORG = 'org-gbp'
const TARGET = 'accounts/1/locations/1'
const asAdmin = (d: FakeDb) => d as unknown as SupabaseClient<Database>
const approver = { type: 'user' as const, id: 'u-approver', label: 'owner@example.com', canApprove: true }
const member = { type: 'user' as const, id: 'u-member', label: 'member@example.com', canApprove: false }

function seed() {
  db = new FakeDb((table, row) => {
    const now = new Date().toISOString()
    if (table === 'ads_change_requests') {
      return { attempt_count: 0, updated_at: now, error_code: null, error_message: null, provider_ref: null, completed_at: null, ...row }
    }
    if (table === 'ads_connections') return { usable: true, health: 'ok', ...row }
    if (table === 'gbp_posts') return { status: 'draft', topic_type: 'STANDARD', recurrence: 'none', change_request_id: null, ...row }
    return row
  })
  db.rows('local_seo_locations').push({
    id: 'loc',
    org_id: ORG,
    business_name: 'Bigode',
    language: 'pt',
    gbp_connection_id: 'c1',
    gbp_account_name: 'accounts/1',
    gbp_location_name: 'locations/1',
  })
  db.rows('gbp_reviews').push(
    { id: 'r5', org_id: ORG, location_id: 'loc', review_name: `${TARGET}/reviews/5`, rating: 5, reply_comment: null, reply_state: 'none' },
    { id: 'r2', org_id: ORG, location_id: 'loc', review_name: `${TARGET}/reviews/2`, rating: 2, reply_comment: null, reply_state: 'none' },
  )
  return db
}

const changes = () => db.rows('ads_change_requests')
const review = (id: string) => db.rows('gbp_reviews').find((r) => r.id === id)!

beforeEach(() => {
  google.replies.clear()
  google.posts.clear()
  google.writes = 0
  google.failNextReply = false
  google.profile = {
    name: 'locations/1',
    title: 'Bigode',
    profile: { description: 'Old description' },
    websiteUri: 'https://old.example',
    phoneNumbers: { primaryPhone: '+55 11 1111-1111' },
    regularHours: { periods: [{ openDay: 'MONDAY', openTime: { hours: 9 }, closeDay: 'MONDAY', closeTime: { hours: 18 } }] },
  }
})

describe('one ledger', () => {
  it('records Local SEO writes in the engine ledger and creates the engine target on first use', async () => {
    seed()
    const res = await proposeChange(asAdmin(db), { orgId: ORG, locationId: 'loc', command: { type: 'review.reply', reviewId: 'r2', comment: 'Sorry about that.' }, actor: approver })
    expect(res.ok && res.change.status).toBe('succeeded')
    expect(db.rows('ads_connections')).toMatchObject([
      { platform: 'google_business', ad_account_id: TARGET, gbp_connection_id: 'c1', encrypted_access_token: 'enc:gbp_connection:c1' },
    ])
    expect(changes()).toMatchObject([
      { platform: 'google_business', ad_account_id: TARGET, command_type: 'google_business.review.reply', actor_type: 'user', status: 'succeeded' },
    ])
    expect(db.tables.has('gbp_change_requests')).toBe(false)
  })

  it('refuses to act on a location without a Business Profile link', async () => {
    seed()
    db.rows('local_seo_locations')[0].gbp_location_name = null
    const res = await proposeChange(asAdmin(db), { orgId: ORG, locationId: 'loc', command: { type: 'review.reply', reviewId: 'r2', comment: 'x' }, actor: approver })
    expect(res).toMatchObject({ ok: false, code: 'not_connected' })
  })

  it('never approves a non-Business-Profile change from Local SEO', async () => {
    seed()
    db.rows('ads_change_requests').push({ id: 'ads-1', org_id: ORG, platform: 'google', status: 'awaiting_approval' })
    expect(await approveChange(asAdmin(db), ORG, 'ads-1', approver)).toEqual({ ok: false, message: 'Change not found.' })
    expect(await rejectChange(asAdmin(db), ORG, 'ads-1', approver)).toEqual({ ok: false, message: 'Change not found.' })
  })
})

describe('review replies', () => {
  it('publishes immediately for an approver, verifies, and marks the review and draft', async () => {
    seed()
    db.rows('gbp_reply_drafts').push({ id: 'd1', org_id: ORG, review_id: 'r2', draft: 'Sorry about that.', status: 'draft' })
    const res = await proposeChange(asAdmin(db), {
      orgId: ORG,
      locationId: 'loc',
      command: { type: 'review.reply', reviewId: 'r2', comment: 'Sorry about that.', draftId: 'd1' },
      actor: approver,
    })
    expect(res.ok && res.change.status).toBe('succeeded')
    expect(google.replies.get(`${TARGET}/reviews/2`)).toBe('Sorry about that.')
    expect(review('r2')).toMatchObject({ reply_state: 'replied', reply_comment: 'Sorry about that.' })
    expect(db.rows('gbp_reply_drafts')[0]).toMatchObject({ status: 'sent', change_request_id: res.ok ? res.change.id : '' })
  })

  it('holds a member reply until an approver releases it', async () => {
    seed()
    const res = await proposeChange(asAdmin(db), { orgId: ORG, locationId: 'loc', command: { type: 'review.reply', reviewId: 'r5', comment: 'Thanks!' }, actor: member })
    expect(res.ok && res.change.status).toBe('awaiting_approval')
    expect(google.writes).toBe(0)
    expect(review('r5').reply_state).toBe('pending')

    const approved = await approveChange(asAdmin(db), ORG, res.ok ? res.change.id : '', approver)
    expect(approved.ok && approved.change.status).toBe('succeeded')
    expect(google.replies.get(`${TARGET}/reviews/5`)).toBe('Thanks!')
    expect(review('r5').reply_state).toBe('replied')
  })

  it('auto-replies to positive reviews only, as a delegated system actor', async () => {
    seed()
    const auto = { type: 'ai' as const, label: 'Auto-reply (4-5★)', autoApproved: true }
    const pos = await proposeChange(asAdmin(db), { orgId: ORG, locationId: 'loc', command: { type: 'review.reply', reviewId: 'r5', comment: 'Thank you!' }, actor: auto })
    expect(pos.ok && pos.change.status).toBe('succeeded')
    expect(changes()[0]).toMatchObject({ actor_type: 'system', actor_label: 'local-seo:Auto-reply (4-5★)' })

    const neg = await proposeChange(asAdmin(db), { orgId: ORG, locationId: 'loc', command: { type: 'review.reply', reviewId: 'r2', comment: 'Sorry' }, actor: auto })
    expect(neg.ok && neg.change.status).toBe('awaiting_approval')
    expect(changes()[1]).toMatchObject({ actor_type: 'ai' })
    expect(google.replies.has(`${TARGET}/reviews/2`)).toBe(false)
  })

  it('keeps an AI or workflow proposal waiting for a person', async () => {
    seed()
    const res = await proposeChange(asAdmin(db), {
      orgId: ORG,
      locationId: 'loc',
      command: { type: 'review.reply', reviewId: 'r5', comment: 'Obrigado!' },
      actor: { type: 'workflow', label: 'workflow:reviews' },
    })
    expect(res.ok && res.change.status).toBe('awaiting_approval')
    expect(google.writes).toBe(0)
  })

  it('rejecting cancels the change and frees the review for a new reply', async () => {
    seed()
    db.rows('gbp_reply_drafts').push({ id: 'd2', org_id: ORG, review_id: 'r2', draft: 'x', status: 'draft' })
    const res = await proposeChange(asAdmin(db), { orgId: ORG, locationId: 'loc', command: { type: 'review.reply', reviewId: 'r2', comment: 'x', draftId: 'd2' }, actor: member })
    if (!res.ok) throw new Error(res.message)
    expect(await rejectChange(asAdmin(db), ORG, res.change.id, approver)).toEqual({ ok: true })
    expect(changes()[0].status).toBe('cancelled')
    expect(review('r2').reply_state).toBe('none')
    expect(db.rows('gbp_reply_drafts')[0].status).toBe('rejected')
  })

  it('a transient Google error leaves the change queued for the engine retry', async () => {
    seed()
    google.failNextReply = true
    const res = await proposeChange(asAdmin(db), { orgId: ORG, locationId: 'loc', command: { type: 'review.reply', reviewId: 'r5', comment: 'Thanks' }, actor: approver })
    expect(res.ok && res.change.status).toBe('queued')
    expect(review('r5').reply_state).toBe('pending')
  })

  it('refuses an empty or unchanged reply', async () => {
    seed()
    const empty = await proposeChange(asAdmin(db), { orgId: ORG, locationId: 'loc', command: { type: 'review.reply', reviewId: 'r5', comment: '  ' }, actor: approver })
    expect(empty).toMatchObject({ ok: false, code: 'invalid' })
  })

  it('deletes a reply and can roll that back', async () => {
    seed()
    google.replies.set(`${TARGET}/reviews/5`, 'Old reply')
    review('r5').reply_comment = 'Old reply'
    const res = await proposeChange(asAdmin(db), { orgId: ORG, locationId: 'loc', command: { type: 'review.delete_reply', reviewId: 'r5' }, actor: approver })
    expect(res.ok && res.change.status).toBe('succeeded')
    expect(google.replies.has(`${TARGET}/reviews/5`)).toBe(false)
    expect(review('r5')).toMatchObject({ reply_comment: null, reply_state: 'none' })

    const back = await rollbackChange(asAdmin(db), ORG, res.ok ? res.change.id : '', approver)
    expect(back.ok && back.change.status).toBe('succeeded')
    expect(google.replies.get(`${TARGET}/reviews/5`)).toBe('Old reply')
  })
})

describe('profile edits', () => {
  it('publishes, verifies, annotates and rolls back', async () => {
    seed()
    const res = await proposeChange(asAdmin(db), {
      orgId: ORG,
      locationId: 'loc',
      command: { type: 'profile.update', patch: { description: 'New description', websiteUri: 'https://new.example' } },
      actor: approver,
    })
    if (!res.ok) throw new Error(res.message)
    expect(res.change.status).toBe('succeeded')
    expect((google.profile.profile as { description: string }).description).toBe('New description')
    expect(changes()[0].diff).toMatchObject([
      { field: 'description', before: 'Old description', after: 'New description' },
      { field: 'website_url', before: 'https://old.example', after: 'https://new.example' },
    ])
    expect(db.rows('local_seo_annotations')).toMatchObject([{ kind: 'profile_change', location_id: 'loc' }])

    const back = await rollbackChange(asAdmin(db), ORG, res.change.id, approver)
    expect(back.ok && back.change.status).toBe('succeeded')
    expect((google.profile.profile as { description: string }).description).toBe('Old description')
    expect(google.profile.websiteUri).toBe('https://old.example')
  })

  it('verifies opening hours even though Google drops zero minutes', async () => {
    seed()
    const res = await proposeChange(asAdmin(db), {
      orgId: ORG,
      locationId: 'loc',
      command: {
        type: 'profile.update',
        patch: { hours: [{ day: 'MONDAY', open: '08:00', close: '17:30' }, { day: 'FRIDAY', open: '22:00', close: '02:00' }] },
      },
      actor: approver,
    })
    expect(res.ok && res.change.status).toBe('succeeded')
    const periods = (google.profile.regularHours as { periods: Record<string, unknown>[] }).periods
    expect(periods[1]).toMatchObject({ openDay: 'FRIDAY', closeDay: 'SATURDAY' })
    expect(changes()[0].diff).toMatchObject([{ beforeDisplay: 'Mon 09:00–18:00', afterDisplay: 'Mon 08:00–17:30, Fri 22:00–02:00' }])
  })

  it('splits a description + hours edit into two changes and reports both', async () => {
    seed()
    const res = await proposeChange(asAdmin(db), {
      orgId: ORG,
      locationId: 'loc',
      command: { type: 'profile.update', patch: { description: 'New', hours: [{ day: 'TUESDAY', open: '10:00', close: '24:00' }] } },
      actor: approver,
    })
    expect(res.ok && res.change.status).toBe('succeeded')
    expect(changes().map((c) => c.command_type)).toEqual(['google_business.location.update_info', 'google_business.location.set_regular_hours'])
  })

  it('a member edit waits; it fails as a conflict if the profile changed before approval', async () => {
    seed()
    const res = await proposeChange(asAdmin(db), { orgId: ORG, locationId: 'loc', command: { type: 'profile.update', patch: { description: 'Mine' } }, actor: member })
    if (!res.ok) throw new Error(res.message)
    expect(res.change.status).toBe('awaiting_approval')
    google.profile.profile = { description: 'Changed by Google' }
    const approved = await approveChange(asAdmin(db), ORG, res.change.id, approver)
    expect(approved.ok).toBe(false)
    expect(changes()[0]).toMatchObject({ status: 'failed', error_code: 'state_conflict' })
    expect((google.profile.profile as { description: string }).description).toBe('Changed by Google')
  })

  it('reports a no-op instead of recording an empty change', async () => {
    seed()
    const res = await proposeChange(asAdmin(db), { orgId: ORG, locationId: 'loc', command: { type: 'profile.update', patch: { description: 'Old description' } }, actor: approver })
    expect(res).toMatchObject({ ok: false, code: 'no_op' })
    expect(changes()).toHaveLength(0)
  })
})

describe('posts', () => {
  it('publishes a post, marks it live and annotates the trend chart, then deletes it', async () => {
    seed()
    db.rows('gbp_posts').push({ id: 'p1', org_id: ORG, location_id: 'loc', summary: 'Open on Sunday!', status: 'draft', topic_type: 'STANDARD', cta_type: 'CALL', cta_url: null, media_url: null, event: null, offer: null })
    const res = await proposeChange(asAdmin(db), { orgId: ORG, locationId: 'loc', command: { type: 'post.create', postId: 'p1' }, actor: approver })
    expect(res.ok && res.change.status).toBe('succeeded')
    const [published] = [...google.posts.values()]
    expect(published).toMatchObject({ summary: 'Open on Sunday!', languageCode: 'pt', topicType: 'STANDARD', callToAction: { actionType: 'CALL' } })
    expect(db.rows('gbp_posts')[0]).toMatchObject({ status: 'live', post_name: `${TARGET}/localPosts/1` })
    expect(db.rows('local_seo_annotations')).toMatchObject([{ kind: 'post' }])

    const del = await proposeChange(asAdmin(db), { orgId: ORG, locationId: 'loc', command: { type: 'post.delete', postId: 'p1' }, actor: approver })
    expect(del.ok && del.change.status).toBe('succeeded')
    expect(google.posts.size).toBe(0)
    expect(db.rows('gbp_posts')[0].status).toBe('deleted')
  })

  it('a rejected post goes back to draft', async () => {
    seed()
    db.rows('gbp_posts').push({ id: 'p2', org_id: ORG, location_id: 'loc', summary: 'Promo', status: 'draft', topic_type: 'STANDARD', cta_type: null, cta_url: null, media_url: null, event: null, offer: null })
    const res = await proposeChange(asAdmin(db), { orgId: ORG, locationId: 'loc', command: { type: 'post.create', postId: 'p2' }, actor: member })
    if (!res.ok) throw new Error(res.message)
    expect(db.rows('gbp_posts')[0]).toMatchObject({ status: 'draft', change_request_id: res.change.id })
    await rejectChange(asAdmin(db), ORG, res.change.id, approver)
    expect(db.rows('gbp_posts')[0]).toMatchObject({ status: 'draft' })
    expect(google.posts.size).toBe(0)
  })
})

describe('intent → command mapping', () => {
  it('maps profile fields and refuses to remove the phone', () => {
    expect(profileCommands(TARGET, { description: '', websiteUri: 'https://x.example' })).toEqual([
      { platform: 'google_business', ad_account_id: TARGET, type: 'google_business.location.update_info', description: null, website_url: 'https://x.example' },
    ])
    expect(profileCommands(TARGET, { primaryPhone: null })).toMatchObject({ ok: false, code: 'invalid' })
    expect(profileCommands(TARGET, {})).toMatchObject({ ok: false, code: 'invalid' })
  })

  it('maps an event post with its schedule', () => {
    const cmd = postCreateCommand(
      TARGET,
      {
        summary: 'Live music',
        topic_type: 'EVENT',
        media_url: null,
        cta_type: 'LEARN_MORE',
        cta_url: 'https://x.example',
        event: { title: 'Samba night', schedule: { startDate: { year: 2026, month: 10, day: 9 }, startTime: { hours: 20 }, endDate: { year: 2026, month: 10, day: 9 }, endTime: { hours: 23, minutes: 30 } } },
        offer: null,
      } as never,
      'pt',
    )
    expect(cmd).toMatchObject({
      type: 'google_business.local_post.create',
      topic_type: 'EVENT',
      event: { title: 'Samba night', start: '2026-10-09T20:00:00.000Z', end: '2026-10-09T23:30:00.000Z' },
      cta_url: 'https://x.example',
    })
  })
})
