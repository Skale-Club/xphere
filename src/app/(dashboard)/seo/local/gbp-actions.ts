'use server'

// Server actions for the Google Business Profile side of Local SEO:
// connection and linking, review replies, profile edits, posts, settings.
// Every write to Google goes through src/lib/gbp/commands.ts (the ledger).

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { localSeoContext, type ActionCtx, type Fail } from '@/lib/local-seo/action-context'
import { GbpApiError, GbpClient } from '@/lib/gbp/client'
import {
  approveChange,
  proposeChange,
  rejectChange,
  rollbackChange,
  type GbpActor,
  type GbpCommand,
} from '@/lib/gbp/commands'
import { gbpTargetName, locationTarget, removeEngineTarget, upsertEngineTarget } from '@/lib/gbp/engine-targets'
import { DAYS, type ProfilePatch } from '@/lib/gbp/profile'
import { generateReplyDraft } from '@/lib/gbp/replies'
import { syncPerformance, syncProfile, syncReviews } from '@/lib/gbp/sync'
import { can } from '@/lib/rbac/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'

const admin = () => createServiceRoleClient()

async function userActor(ctx: ActionCtx): Promise<GbpActor> {
  return { type: 'user', id: ctx.user.id, label: ctx.user.email ?? 'operator', canApprove: await can('local_seo.approve') }
}

function revalidateLocation(locationId: string) {
  revalidatePath(`/seo/local/${locationId}`, 'layout')
}

function changeOutcome(res: Awaited<ReturnType<typeof proposeChange>>): { status: string; message: string } | Fail {
  if (!res.ok) return { error: res.message }
  const s = res.change.status
  const message =
    s === 'succeeded'
      ? 'Published on Google.'
      : s === 'awaiting_approval'
        ? 'Sent for approval.'
        : s === 'queued'
          ? 'Queued; it will be retried shortly.'
          : s === 'drifted'
            ? 'The profile changed in the meantime. Review and try again.'
            : (res.change.error_message ?? `Change ${s}.`)
  return { status: s, message }
}

// ---------------------------------------------------------------------------
// Connection & linking
// ---------------------------------------------------------------------------

export type GbpLocationOption = { accountName: string; accountLabel: string; locationName: string; title: string; address: string | null; placeId: string | null }

export async function listGbpLocations(connectionId: string): Promise<{ options: GbpLocationOption[] } | Fail> {
  const ctx = await localSeoContext('local_seo.admin')
  if ('error' in ctx) return { error: ctx.error }
  const { data: conn } = await ctx.supabase.from('gbp_connections').select('id').eq('id', connectionId).maybeSingle()
  if (!conn) return { error: 'Connection not found.' }
  try {
    const client = new GbpClient(admin(), connectionId)
    const accounts = await client.listAccounts()
    const options: GbpLocationOption[] = []
    for (const a of accounts) {
      for (const l of await client.listLocations(a.name)) {
        const addr = l.storefrontAddress
        options.push({
          accountName: a.name,
          accountLabel: a.accountName ?? a.name,
          locationName: l.name,
          title: l.title ?? l.name,
          address: addr ? [...(addr.addressLines ?? []), addr.locality].filter(Boolean).join(', ') : null,
          placeId: l.metadata?.placeId ?? null,
        })
      }
    }
    return { options }
  } catch (err) {
    if (err instanceof GbpApiError && err.status === 403 && /quota|has not been used|disabled/i.test(err.message)) {
      return { error: 'Google has not enabled the Business Profile APIs for this project yet (quota 0). See docs/local-seo/README.md.' }
    }
    return { error: err instanceof Error ? err.message : 'Could not list Business Profile locations.' }
  }
}

export async function linkGbpLocation(
  locationId: string,
  input: { connectionId: string; accountName: string; locationName: string },
): Promise<{ ok: true; warning?: string } | Fail> {
  const ctx = await localSeoContext('local_seo.admin')
  if ('error' in ctx) return { error: ctx.error }
  const db = admin()
  const { data: location } = await db.from('local_seo_locations').select('*').eq('id', locationId).eq('org_id', ctx.orgId).maybeSingle()
  if (!location) return { error: 'Location not found.' }
  const { data: conn } = await db.from('gbp_connections').select('id').eq('id', input.connectionId).eq('org_id', ctx.orgId).maybeSingle()
  if (!conn) return { error: 'Connection not found.' }

  let warning: string | undefined
  let title = location.business_name ?? location.name
  try {
    const gl = await new GbpClient(db, conn.id).getLocation(input.locationName)
    if (location.place_id && gl.metadata?.placeId && gl.metadata.placeId !== location.place_id) {
      warning = 'This Business Profile has a different Place ID than the tracked location. Check that you picked the right one.'
    }
    if (gl.title) title = gl.title
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not read that location from Google.' }
  }

  const previous = locationTarget(location)

  const { error } = await db
    .from('local_seo_locations')
    .update({
      gbp_connection_id: conn.id,
      gbp_account_name: input.accountName,
      gbp_location_name: input.locationName,
      gbp_reviews_synced_at: null,
      gbp_profile_synced_at: null,
      gbp_perf_synced_at: null,
      gbp_sync_error: null,
    })
    .eq('id', locationId)
  if (error) return { error: error.message }

  // Make the profile an Ads Command Engine target (MCP, Copilot, workflows).
  const target = await upsertEngineTarget(db, {
    orgId: ctx.orgId,
    connectionId: conn.id,
    accountName: input.accountName,
    locationName: input.locationName,
    title,
  })
  if (target.error) return { error: target.error }
  if (previous && previous !== gbpTargetName(input.accountName, input.locationName)) {
    await removeEngineTarget(db, { orgId: ctx.orgId, locationId, target: previous })
  }

  revalidateLocation(locationId)
  return { ok: true, warning }
}

export async function unlinkGbpLocation(locationId: string): Promise<{ ok: true } | Fail> {
  const ctx = await localSeoContext('local_seo.admin')
  if ('error' in ctx) return { error: ctx.error }
  const db = admin()
  const { data: location } = await db
    .from('local_seo_locations')
    .select('gbp_account_name, gbp_location_name')
    .eq('id', locationId)
    .eq('org_id', ctx.orgId)
    .maybeSingle()
  const { error } = await db
    .from('local_seo_locations')
    .update({ gbp_connection_id: null, gbp_account_name: null, gbp_location_name: null })
    .eq('id', locationId)
    .eq('org_id', ctx.orgId)
  if (error) return { error: error.message }
  const target = location ? locationTarget(location) : null
  if (target) await removeEngineTarget(db, { orgId: ctx.orgId, locationId, target })
  revalidateLocation(locationId)
  return { ok: true }
}

export async function disconnectGbp(connectionId: string): Promise<{ ok: true } | Fail> {
  const ctx = await localSeoContext('local_seo.admin')
  if ('error' in ctx) return { error: ctx.error }
  const db = admin()
  await db.from('local_seo_locations').update({ gbp_connection_id: null }).eq('gbp_connection_id', connectionId).eq('org_id', ctx.orgId)
  // Engine targets of this login go with it (also enforced by the FK cascade).
  await db.from('ads_connections').delete().eq('org_id', ctx.orgId).eq('gbp_connection_id', connectionId)
  const { error } = await db.from('gbp_connections').delete().eq('id', connectionId).eq('org_id', ctx.orgId)
  if (error) return { error: error.message }
  revalidatePath('/seo/local', 'layout')
  return { ok: true }
}

export async function syncGbpNow(locationId: string): Promise<{ ok: true; message: string } | Fail> {
  const ctx = await localSeoContext('local_seo.manage')
  if ('error' in ctx) return { error: ctx.error }
  const db = admin()
  const { data: location } = await db.from('local_seo_locations').select('*').eq('id', locationId).eq('org_id', ctx.orgId).maybeSingle()
  if (!location?.gbp_location_name) return { error: 'This location is not connected to Google Business Profile.' }
  try {
    const r = await syncReviews(db, location)
    await syncProfile(db, location)
    await syncPerformance(db, location)
    revalidateLocation(locationId)
    return { ok: true, message: `Synced ${r.fetched} reviews, the profile and performance.` }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Sync failed.' }
  }
}

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

export async function draftReplyWithAi(reviewId: string): Promise<{ draftId: string; text: string } | Fail> {
  const ctx = await localSeoContext('local_seo.manage')
  if ('error' in ctx) return { error: ctx.error }
  const res = await generateReplyDraft(admin(), { orgId: ctx.orgId, reviewId, createdBy: ctx.user.id })
  if (!res.ok) return { error: res.error }
  return { draftId: res.draftId, text: res.text }
}

/** Submit a reply: published right away for approvers, otherwise queued for approval. */
export async function submitReply(input: { reviewId: string; locationId: string; text: string; draftId?: string | null }): Promise<{ status: string; message: string } | Fail> {
  const ctx = await localSeoContext('local_seo.manage')
  if ('error' in ctx) return { error: ctx.error }
  const db = admin()
  let draftId = input.draftId ?? null
  if (draftId) {
    await db.from('gbp_reply_drafts').update({ draft: input.text.trim() }).eq('id', draftId).eq('org_id', ctx.orgId)
  } else {
    const { data } = await db
      .from('gbp_reply_drafts')
      .insert({ org_id: ctx.orgId, review_id: input.reviewId, draft: input.text.trim(), source: 'human', created_by: ctx.user.id })
      .select('id')
      .single()
    draftId = data?.id ?? null
  }
  const res = await proposeChange(db, {
    orgId: ctx.orgId,
    locationId: input.locationId,
    command: { type: 'review.reply', reviewId: input.reviewId, comment: input.text, draftId },
    actor: await userActor(ctx),
  })
  revalidateLocation(input.locationId)
  return changeOutcome(res)
}

export async function deleteReply(reviewId: string, locationId: string): Promise<{ status: string; message: string } | Fail> {
  const ctx = await localSeoContext('local_seo.manage')
  if ('error' in ctx) return { error: ctx.error }
  const res = await proposeChange(admin(), {
    orgId: ctx.orgId,
    locationId,
    command: { type: 'review.delete_reply', reviewId },
    actor: await userActor(ctx),
  })
  revalidateLocation(locationId)
  return changeOutcome(res)
}

const replySettingsSchema = z.object({
  tone: z.string().trim().min(2).max(200),
  signature: z.string().trim().max(200).nullable(),
  instructions: z.string().trim().max(2000).nullable(),
  autoReplyPositive: z.boolean(),
  autoReplyMinRating: z.number().int().min(4).max(5),
})

export async function saveReplySettings(input: z.infer<typeof replySettingsSchema>): Promise<{ ok: true } | Fail> {
  const ctx = await localSeoContext('local_seo.approve')
  if ('error' in ctx) return { error: ctx.error }
  const parsed = replySettingsSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid settings.' }
  const v = parsed.data
  const { error } = await ctx.supabase.from('gbp_reply_settings').upsert({
    org_id: ctx.orgId,
    tone: v.tone,
    signature: v.signature || null,
    instructions: v.instructions || null,
    auto_reply_positive: v.autoReplyPositive,
    auto_reply_min_rating: v.autoReplyMinRating,
    updated_at: new Date().toISOString(),
  })
  if (error) return { error: error.message }
  revalidatePath('/seo/local', 'layout')
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Change approvals (any command type)
// ---------------------------------------------------------------------------

export async function approveGbpChange(changeId: string, locationId: string): Promise<{ status: string; message: string } | Fail> {
  const ctx = await localSeoContext('local_seo.approve')
  if ('error' in ctx) return { error: ctx.error }
  const res = await approveChange(admin(), ctx.orgId, changeId, await userActor(ctx))
  revalidateLocation(locationId)
  if (!res.ok) return { error: res.message }
  return changeOutcome({ ok: true, change: res.change, executed: true })
}

export async function rejectGbpChange(changeId: string, locationId: string): Promise<{ ok: true } | Fail> {
  const ctx = await localSeoContext('local_seo.approve')
  if ('error' in ctx) return { error: ctx.error }
  const res = await rejectChange(admin(), ctx.orgId, changeId, await userActor(ctx))
  revalidateLocation(locationId)
  return res.ok ? { ok: true } : { error: res.message ?? 'Could not reject.' }
}

export async function rollbackGbpChange(changeId: string, locationId: string): Promise<{ status: string; message: string } | Fail> {
  const ctx = await localSeoContext('local_seo.approve')
  if ('error' in ctx) return { error: ctx.error }
  const res = await rollbackChange(admin(), ctx.orgId, changeId, await userActor(ctx))
  revalidateLocation(locationId)
  return changeOutcome(res)
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

const hoursRow = z.object({
  day: z.enum(DAYS),
  open: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  close: z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/),
})
const profilePatchSchema = z
  .object({
    description: z.string().max(750).nullable().optional(),
    websiteUri: z.string().url().max(500).nullable().optional(),
    primaryPhone: z.string().max(40).nullable().optional(),
    hours: z.array(hoursRow).max(30).optional(),
  })
  .strict()

export async function proposeProfileEdit(locationId: string, patch: ProfilePatch): Promise<{ status: string; message: string } | Fail> {
  const ctx = await localSeoContext('local_seo.manage')
  if ('error' in ctx) return { error: ctx.error }
  const parsed = profilePatchSchema.safeParse(patch)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid profile values.' }
  const res = await proposeChange(admin(), {
    orgId: ctx.orgId,
    locationId,
    command: { type: 'profile.update', patch: parsed.data as ProfilePatch },
    actor: await userActor(ctx),
  })
  revalidateLocation(locationId)
  return changeOutcome(res)
}

export async function acknowledgeProfileSnapshot(snapshotId: string, locationId: string): Promise<{ ok: true } | Fail> {
  const ctx = await localSeoContext('local_seo.manage')
  if ('error' in ctx) return { error: ctx.error }
  await admin().from('gbp_profile_snapshots').update({ acknowledged_at: new Date().toISOString() }).eq('id', snapshotId).eq('org_id', ctx.orgId)
  revalidateLocation(locationId)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

const postSchema = z.object({
  topicType: z.enum(['STANDARD', 'EVENT', 'OFFER', 'ALERT']),
  summary: z.string().trim().min(1).max(1500),
  mediaUrl: z.string().url().nullable(),
  ctaType: z.enum(['BOOK', 'ORDER', 'SHOP', 'LEARN_MORE', 'SIGN_UP', 'CALL']).nullable(),
  ctaUrl: z.string().url().nullable(),
  eventTitle: z.string().trim().max(58).nullable(),
  startAt: z.string().nullable(),
  endAt: z.string().nullable(),
  couponCode: z.string().trim().max(58).nullable(),
  recurrence: z.enum(['none', 'weekly', 'monthly']),
  scheduledFor: z.string().nullable(),
})

export type PostInput = z.infer<typeof postSchema>

function toDate(iso: string) {
  const d = new Date(iso)
  return {
    date: { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() },
    time: { hours: d.getUTCHours(), minutes: d.getUTCMinutes() },
  }
}

/**
 * Save a post. mode 'draft' keeps it here; 'schedule' and 'publish' need
 * local_seo.approve (or go to the approval queue as a pending publish).
 */
export async function savePost(
  locationId: string,
  input: PostInput,
  mode: 'draft' | 'schedule' | 'publish',
  postId?: string,
): Promise<{ id: string; message: string } | Fail> {
  const ctx = await localSeoContext('local_seo.manage')
  if ('error' in ctx) return { error: ctx.error }
  const parsed = postSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid post.' }
  const v = parsed.data
  if (v.ctaType && v.ctaType !== 'CALL' && !v.ctaUrl) return { error: 'This button needs a link.' }
  if ((v.topicType === 'EVENT' || v.topicType === 'OFFER') && (!v.eventTitle || !v.startAt || !v.endAt)) {
    return { error: 'Events and offers need a title, a start and an end.' }
  }
  const canApprove = await can('local_seo.approve')
  if (mode === 'schedule') {
    if (!v.scheduledFor || new Date(v.scheduledFor).getTime() < Date.now() + 60_000) return { error: 'Pick a time in the future.' }
    if (!canApprove) return { error: 'Only someone who can approve posts can schedule them. Save it as a draft and ask them.' }
  }

  const schedule = v.startAt && v.endAt ? { startDate: toDate(v.startAt).date, startTime: toDate(v.startAt).time, endDate: toDate(v.endAt).date, endTime: toDate(v.endAt).time } : null
  const row = {
    org_id: ctx.orgId,
    location_id: locationId,
    topic_type: v.topicType,
    summary: v.summary,
    media_url: v.mediaUrl,
    cta_type: v.ctaType,
    cta_url: v.ctaType === 'CALL' ? null : v.ctaUrl,
    event: v.topicType === 'EVENT' || v.topicType === 'OFFER' ? { title: v.eventTitle, schedule } : null,
    offer: v.topicType === 'OFFER' && v.couponCode ? { couponCode: v.couponCode } : null,
    recurrence: v.recurrence,
    status: (mode === 'schedule' ? 'scheduled' : 'draft') as 'scheduled' | 'draft',
    scheduled_for: mode === 'schedule' ? new Date(v.scheduledFor!).toISOString() : null,
    created_by: ctx.user.id,
  }
  const db = admin()
  let id = postId
  if (id) {
    const { error } = await db.from('gbp_posts').update(row).eq('id', id).eq('org_id', ctx.orgId).in('status', ['draft', 'scheduled', 'failed'])
    if (error) return { error: error.message }
  } else {
    const { data, error } = await db.from('gbp_posts').insert(row).select('id').single()
    if (error || !data) return { error: error?.message ?? 'Could not save the post.' }
    id = data.id
  }

  let message = mode === 'schedule' ? 'Post scheduled.' : 'Draft saved.'
  if (mode === 'publish') {
    const res = await proposeChange(db, {
      orgId: ctx.orgId,
      locationId,
      command: { type: 'post.create', postId: id } satisfies GbpCommand,
      actor: await userActor(ctx),
    })
    const out = changeOutcome(res)
    if ('error' in out) return out
    message = out.message
  }
  revalidateLocation(locationId)
  return { id: id!, message }
}

export async function deletePost(postId: string, locationId: string): Promise<{ message: string } | Fail> {
  const ctx = await localSeoContext('local_seo.manage')
  if ('error' in ctx) return { error: ctx.error }
  const db = admin()
  const { data: post } = await db.from('gbp_posts').select('status, post_name').eq('id', postId).eq('org_id', ctx.orgId).maybeSingle()
  if (!post) return { error: 'Post not found.' }
  if (!post.post_name) {
    await db.from('gbp_posts').delete().eq('id', postId)
    revalidateLocation(locationId)
    return { message: 'Post removed.' }
  }
  const res = await proposeChange(db, { orgId: ctx.orgId, locationId, command: { type: 'post.delete', postId }, actor: await userActor(ctx) })
  revalidateLocation(locationId)
  const out = changeOutcome(res)
  return 'error' in out ? out : { message: out.message }
}
