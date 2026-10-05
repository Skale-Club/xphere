import 'server-only'

// Business Profile change ledger — the ONLY path that writes to Google.
// Same shape as the Ads Command Engine (docs/ads/control-plane.md):
//
//   propose  snapshot the current state, compute the diff, decide whether a
//            human must approve, record the request
//   approve  a person with local_seo.approve releases it
//   execute  write to Google; profile edits first check for drift (the field
//            changed since the snapshot) and validate with validateOnly
//   verify   read back from Google and compare with what was intended
//   rollback a profile edit is undone by a NEW request carrying the old values
//
// Approval rules:
//   * a user who holds local_seo.approve approves by submitting
//   * the auto-reply for 4-5 star reviews (org setting) runs without approval
//   * everything else — AI drafts, workflows, anyone without approve, every
//     reply to a <= 3 star review that did not come from such a user — waits

import { createHash, randomUUID } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Json } from '@/types/database'
import { createLogger } from '@/lib/obs/logger'

import { GbpApiError, GbpClient, type GbpLocalPost } from './client'
import { buildLocationPatch, diffProfiles, EDITABLE_FIELDS, flattenProfile, type FieldDiff, type ProfilePatch } from './profile'

type Admin = SupabaseClient<Database>
type ChangeRow = Database['public']['Tables']['gbp_change_requests']['Row']
type ChangeStatus = ChangeRow['status']

export type GbpCommand =
  | { type: 'review.reply'; reviewId: string; comment: string; draftId?: string | null }
  | { type: 'review.delete_reply'; reviewId: string }
  | { type: 'profile.update'; patch: ProfilePatch }
  | { type: 'post.create'; postId: string }
  | { type: 'post.delete'; postId: string }

export type GbpActor = {
  type: 'user' | 'ai' | 'workflow' | 'system'
  id?: string | null
  label: string
  /** The actor holds local_seo.approve (users only). */
  canApprove?: boolean
  /** Org auto-reply policy allows this write without a human (positive reviews only). */
  autoApproved?: boolean
}

export type ProposeResult =
  | { ok: true; change: ChangeRow; executed: boolean }
  | { ok: false; code: 'not_connected' | 'not_found' | 'invalid' | 'no_op' | 'provider_error'; message: string }

const MAX_ATTEMPTS = 3
const log = createLogger({ module: 'gbp/commands' })

async function recordEvent(
  admin: Admin,
  change: Pick<ChangeRow, 'id' | 'org_id'>,
  eventType: string,
  from: ChangeStatus | null,
  to: ChangeStatus | null,
  actor: Pick<GbpActor, 'type' | 'id' | 'label'>,
  detail: Record<string, unknown> = {},
) {
  await admin.from('gbp_change_events').insert({
    org_id: change.org_id,
    change_request_id: change.id,
    event_type: eventType,
    from_status: from,
    to_status: to,
    actor_type: actor.type,
    actor_id: actor.id ?? null,
    actor_label: actor.label,
    detail: detail as Json,
  })
}

/** Conditional status move; returns the row only if this caller won the race. */
async function transition(
  admin: Admin,
  change: ChangeRow,
  from: ChangeStatus[],
  to: ChangeStatus,
  extra: Partial<ChangeRow> = {},
): Promise<ChangeRow | null> {
  const { data } = await admin
    .from('gbp_change_requests')
    .update({ status: to, ...extra } as never)
    .eq('id', change.id)
    .in('status', from)
    .select('*')
  return (data?.[0] as ChangeRow | undefined) ?? null
}

function hashKey(parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 40)
}

// ---------------------------------------------------------------------------
// Propose
// ---------------------------------------------------------------------------

export async function proposeChange(
  admin: Admin,
  input: { orgId: string; locationId: string; command: GbpCommand; actor: GbpActor; idempotencyKey?: string; rollbackOf?: string | null },
): Promise<ProposeResult> {
  const { orgId, locationId, command, actor } = input
  const { data: location } = await admin
    .from('local_seo_locations')
    .select('id, org_id, gbp_location_name, gbp_connection_id')
    .eq('id', locationId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (!location) return { ok: false, code: 'not_found', message: 'Location not found.' }
  if (!location.gbp_location_name || !location.gbp_connection_id) {
    return { ok: false, code: 'not_connected', message: 'Connect this location to Google Business Profile first.' }
  }

  let before: unknown = null
  let intended: unknown = null
  let diff: FieldDiff[] = []
  let risk = 2
  let targetRef: string | null = null
  let reviewRating: number | null = null

  if (command.type === 'review.reply' || command.type === 'review.delete_reply') {
    const { data: review } = await admin.from('gbp_reviews').select('*').eq('id', command.reviewId).eq('org_id', orgId).maybeSingle()
    if (!review) return { ok: false, code: 'not_found', message: 'Review not found.' }
    targetRef = review.review_name
    reviewRating = review.rating
    before = { reply: review.reply_comment }
    if (command.type === 'review.reply') {
      const comment = command.comment.trim()
      if (!comment || comment.length > 4000) return { ok: false, code: 'invalid', message: 'A reply needs 1 to 4,000 characters.' }
      if (comment === review.reply_comment) return { ok: false, code: 'no_op', message: 'That reply is already published.' }
      intended = { reply: comment }
      diff = [{ field: 'reply', before: review.reply_comment, after: comment }]
      risk = (review.rating ?? 5) <= 3 ? 3 : 2
    } else {
      if (!review.reply_comment) return { ok: false, code: 'no_op', message: 'This review has no reply.' }
      intended = { reply: null }
      diff = [{ field: 'reply', before: review.reply_comment, after: null }]
      risk = 3
    }
  } else if (command.type === 'profile.update') {
    const fields = Object.keys(command.patch).filter((k) => (EDITABLE_FIELDS as readonly string[]).includes(k))
    if (!fields.length) return { ok: false, code: 'invalid', message: 'Nothing to change.' }
    const conn = await GbpClient.forLocation(admin, locationId)
    if (!conn) return { ok: false, code: 'not_connected', message: 'Connect this location to Google Business Profile first.' }
    try {
      const current = flattenProfile(await conn.client.getLocation(conn.locationName))
      before = Object.fromEntries(fields.map((f) => [f, current[f as keyof typeof current]]))
    } catch (err) {
      return { ok: false, code: 'provider_error', message: err instanceof Error ? err.message : 'Could not read the profile.' }
    }
    intended = Object.fromEntries(fields.map((f) => [f, command.patch[f as keyof ProfilePatch] ?? null]))
    diff = diffProfiles(before as Record<string, unknown>, intended as Record<string, unknown>, fields)
    if (!diff.length) return { ok: false, code: 'no_op', message: 'The profile already has these values.' }
    risk = fields.some((f) => f === 'primaryPhone' || f === 'hours') ? 3 : 2
    targetRef = fields.join(',')
  } else {
    const { data: post } = await admin.from('gbp_posts').select('*').eq('id', command.postId).eq('org_id', orgId).maybeSingle()
    if (!post) return { ok: false, code: 'not_found', message: 'Post not found.' }
    targetRef = post.id
    if (command.type === 'post.create') {
      if (post.status === 'live') return { ok: false, code: 'no_op', message: 'This post is already live.' }
      intended = { summary: post.summary, topic_type: post.topic_type, cta_type: post.cta_type, cta_url: post.cta_url, media_url: post.media_url }
      diff = [{ field: 'post', before: null, after: post.summary }]
      risk = 2
    } else {
      if (!post.post_name) return { ok: false, code: 'no_op', message: 'This post was never published.' }
      before = { post_name: post.post_name, summary: post.summary }
      diff = [{ field: 'post', before: post.summary, after: null }]
      risk = 3
    }
  }

  // A person with approve rights (or a schedule one of them set) approves by submitting.
  const approverSubmits = (actor.type === 'user' || actor.type === 'system') && actor.canApprove === true
  const autoPositive = actor.autoApproved === true && command.type === 'review.reply' && (reviewRating ?? 0) >= 4
  const approvalRequired = !(approverSubmits || autoPositive)

  const idempotencyKey = input.idempotencyKey ?? hashKey([command, intended, approverSubmits ? actor.id : randomUUID()])
  const { data: existing } = await admin
    .from('gbp_change_requests')
    .select('*')
    .eq('org_id', orgId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()
  if (existing) return { ok: true, change: existing, executed: false }

  const { data: change, error } = await admin
    .from('gbp_change_requests')
    .insert({
      org_id: orgId,
      location_id: locationId,
      command_type: command.type,
      target_ref: targetRef,
      payload: command as unknown as Json,
      before_state: before as Json,
      intended_state: intended as Json,
      diff: diff as unknown as Json,
      risk_level: risk,
      status: approvalRequired ? 'awaiting_approval' : 'queued',
      actor_type: actor.type,
      actor_id: actor.id ?? null,
      actor_label: actor.label,
      idempotency_key: idempotencyKey,
      approval_required: approvalRequired,
      approved_by: approvalRequired ? null : (actor.id ?? null),
      approved_at: approvalRequired ? null : new Date().toISOString(),
      rollback_of: input.rollbackOf ?? null,
    })
    .select('*')
    .single()
  if (error || !change) return { ok: false, code: 'invalid', message: error?.message ?? 'Could not record the change.' }
  await recordEvent(admin, change, 'proposed', null, change.status, actor, { diff })

  if (command.type === 'review.reply') {
    if (command.draftId) {
      await admin
        .from('gbp_reply_drafts')
        .update({ change_request_id: change.id, status: approvalRequired ? 'draft' : 'approved' })
        .eq('id', command.draftId)
    }
    await admin.from('gbp_reviews').update({ reply_state: 'pending' }).eq('id', command.reviewId).eq('reply_state', 'none')
  }

  if (approvalRequired) return { ok: true, change, executed: false }
  const executed = await executeChange(admin, change.id)
  return { ok: true, change: executed ?? change, executed: true }
}

// ---------------------------------------------------------------------------
// Approve / reject / cancel
// ---------------------------------------------------------------------------

export async function approveChange(admin: Admin, orgId: string, changeId: string, approver: GbpActor): Promise<{ ok: true; change: ChangeRow } | { ok: false; message: string }> {
  const { data: change } = await admin.from('gbp_change_requests').select('*').eq('id', changeId).eq('org_id', orgId).maybeSingle()
  if (!change) return { ok: false, message: 'Change not found.' }
  const moved = await transition(admin, change, ['awaiting_approval'], 'queued', {
    approved_by: approver.id ?? null,
    approved_at: new Date().toISOString(),
  })
  if (!moved) return { ok: false, message: `This change is ${change.status.replace('_', ' ')}.` }
  await recordEvent(admin, moved, 'approved', 'awaiting_approval', 'queued', approver)
  const done = await executeChange(admin, moved.id)
  return { ok: true, change: done ?? moved }
}

export async function rejectChange(admin: Admin, orgId: string, changeId: string, actor: GbpActor): Promise<{ ok: boolean; message?: string }> {
  const { data: change } = await admin.from('gbp_change_requests').select('*').eq('id', changeId).eq('org_id', orgId).maybeSingle()
  if (!change) return { ok: false, message: 'Change not found.' }
  const moved = await transition(admin, change, ['awaiting_approval', 'queued'], 'rejected', { completed_at: new Date().toISOString() })
  if (!moved) return { ok: false, message: `This change is ${change.status.replace('_', ' ')}.` }
  await recordEvent(admin, moved, 'rejected', change.status, 'rejected', actor)
  if (change.command_type === 'review.reply') {
    const payload = change.payload as { reviewId?: string; draftId?: string }
    if (payload.draftId) await admin.from('gbp_reply_drafts').update({ status: 'rejected' }).eq('id', payload.draftId)
    if (payload.reviewId) await admin.from('gbp_reviews').update({ reply_state: 'none' }).eq('id', payload.reviewId).eq('reply_state', 'pending')
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Execute + verify
// ---------------------------------------------------------------------------

const SYSTEM: GbpActor = { type: 'system', label: 'ledger' }

export async function executeChange(admin: Admin, changeId: string): Promise<ChangeRow | null> {
  const { data: change } = await admin.from('gbp_change_requests').select('*').eq('id', changeId).maybeSingle()
  if (!change) return null
  const running = await transition(admin, change, ['queued'], 'executing', {
    attempt_count: change.attempt_count + 1,
    executed_at: new Date().toISOString(),
  })
  if (!running) return change
  await recordEvent(admin, running, 'executing', 'queued', 'executing', SYSTEM, { attempt: running.attempt_count })

  const conn = await GbpClient.forLocation(admin, running.location_id)
  if (!conn) return finish(admin, running, 'failed', { error_message: 'The location is no longer connected to Google.' })

  const command = running.payload as unknown as GbpCommand
  try {
    switch (command.type) {
      case 'review.reply':
        return await execReply(admin, running, conn, command)
      case 'review.delete_reply':
        return await execDeleteReply(admin, running, conn, command)
      case 'profile.update':
        return await execProfile(admin, running, conn, command)
      case 'post.create':
        return await execPostCreate(admin, running, conn, command)
      case 'post.delete':
        return await execPostDelete(admin, running, conn, command)
    }
  } catch (err) {
    const e = err instanceof GbpApiError ? err : new GbpApiError('transient', 0, err instanceof Error ? err.message : String(err))
    log.warn('gbp_change_failed', { changeId, kind: e.kind, message: e.message })
    if ((e.kind === 'transient' || e.kind === 'quota') && running.attempt_count < MAX_ATTEMPTS) {
      const back = await transition(admin, running, ['executing'], 'queued', { error_message: e.message.slice(0, 1000) })
      if (back) await recordEvent(admin, back, 'retry_scheduled', 'executing', 'queued', SYSTEM, { error: e.message })
      return back
    }
    return finish(admin, running, 'failed', { error_message: e.message.slice(0, 1000) })
  }
}

async function finish(admin: Admin, change: ChangeRow, status: 'succeeded' | 'failed' | 'drifted', extra: Partial<ChangeRow> = {}): Promise<ChangeRow | null> {
  const done = await transition(admin, change, ['executing'], status, { completed_at: new Date().toISOString(), ...extra })
  if (done) await recordEvent(admin, done, status, 'executing', status, SYSTEM, { error: extra.error_message ?? null, verification: extra.verification ?? null })
  if (status !== 'succeeded' && change.command_type === 'review.reply') {
    const payload = change.payload as { reviewId?: string; draftId?: string }
    if (payload.draftId) await admin.from('gbp_reply_drafts').update({ status: 'failed', error: extra.error_message ?? null }).eq('id', payload.draftId)
    if (payload.reviewId) await admin.from('gbp_reviews').update({ reply_state: 'none' }).eq('id', payload.reviewId).eq('reply_state', 'pending')
  }
  return done
}

type Conn = NonNullable<Awaited<ReturnType<typeof GbpClient.forLocation>>>

async function execReply(admin: Admin, change: ChangeRow, conn: Conn, cmd: Extract<GbpCommand, { type: 'review.reply' }>) {
  const reviewName = change.target_ref!
  const result = await conn.client.updateReply(reviewName, cmd.comment.trim())
  const check = await conn.client.getReview(reviewName)
  const ok = (check.reviewReply?.comment ?? '').trim() === cmd.comment.trim()
  const now = new Date().toISOString()
  if (ok) {
    await admin
      .from('gbp_reviews')
      .update({ reply_comment: check.reviewReply?.comment ?? cmd.comment, reply_update_time: check.reviewReply?.updateTime ?? now, reply_state: 'replied', updated_at: now })
      .eq('id', cmd.reviewId)
    if (cmd.draftId) await admin.from('gbp_reply_drafts').update({ status: 'sent', sent_at: now }).eq('id', cmd.draftId)
  }
  return finish(admin, change, ok ? 'succeeded' : 'failed', {
    provider_result: result as Json,
    verification: { matched: ok, read_back: check.reviewReply?.comment ?? null } as Json,
    error_message: ok ? null : 'Google did not return the reply after writing it.',
  })
}

async function execDeleteReply(admin: Admin, change: ChangeRow, conn: Conn, cmd: Extract<GbpCommand, { type: 'review.delete_reply' }>) {
  const reviewName = change.target_ref!
  await conn.client.deleteReply(reviewName)
  const check = await conn.client.getReview(reviewName)
  const ok = !check.reviewReply?.comment
  if (ok) await admin.from('gbp_reviews').update({ reply_comment: null, reply_update_time: null, reply_state: 'none' }).eq('id', cmd.reviewId)
  return finish(admin, change, ok ? 'succeeded' : 'failed', { verification: { matched: ok } as Json })
}

async function execProfile(admin: Admin, change: ChangeRow, conn: Conn, cmd: Extract<GbpCommand, { type: 'profile.update' }>) {
  const fields = Object.keys(cmd.patch)
  const current = flattenProfile(await conn.client.getLocation(conn.locationName))
  const before = (change.before_state ?? {}) as Record<string, unknown>
  // Drift: someone (or Google) changed a field after the preview was shown.
  const drift = diffProfiles(before, Object.fromEntries(fields.map((f) => [f, current[f as keyof typeof current]])), fields)
  if (drift.length) {
    return finish(admin, change, 'drifted', {
      verification: { drift } as unknown as Json,
      error_message: 'The profile changed since this edit was proposed. Review the current values and propose again.',
    })
  }
  const { updateMask, body } = buildLocationPatch(cmd.patch)
  await conn.client.patchLocation(conn.locationName, updateMask, body, true) // validateOnly
  const result = await conn.client.patchLocation(conn.locationName, updateMask, body)
  const after = flattenProfile(await conn.client.getLocation(conn.locationName))
  const mismatch = diffProfiles(change.intended_state as Record<string, unknown>, Object.fromEntries(fields.map((f) => [f, after[f as keyof typeof after]])), fields)
  const done = await finish(admin, change, mismatch.length ? 'failed' : 'succeeded', {
    provider_result: { name: result.name } as Json,
    verification: { mismatch, pendingEdits: false } as unknown as Json,
    error_message: mismatch.length ? 'Google accepted the edit but returned different values (it may be under review).' : null,
  })
  if (!mismatch.length) {
    await admin.from('local_seo_annotations').insert({
      org_id: change.org_id,
      location_id: change.location_id,
      occurred_at: new Date().toISOString(),
      kind: 'profile_change',
      title: `Profile: ${fields.join(', ')} updated`,
      ref_id: change.id,
    })
  }
  return done
}

function toLocalPost(post: Database['public']['Tables']['gbp_posts']['Row'], language: string): GbpLocalPost {
  return {
    languageCode: language,
    summary: post.summary,
    topicType: post.topic_type,
    ...(post.cta_type ? { callToAction: { actionType: post.cta_type, ...(post.cta_type !== 'CALL' && post.cta_url ? { url: post.cta_url } : {}) } } : {}),
    ...(post.media_url ? { media: [{ mediaFormat: 'PHOTO' as const, sourceUrl: post.media_url }] } : {}),
    ...(post.event ? { event: post.event } : {}),
    ...(post.offer ? { offer: post.offer } : {}),
  }
}

async function execPostCreate(admin: Admin, change: ChangeRow, conn: Conn, cmd: Extract<GbpCommand, { type: 'post.create' }>) {
  const { data: post } = await admin.from('gbp_posts').select('*').eq('id', cmd.postId).maybeSingle()
  if (!post) return finish(admin, change, 'failed', { error_message: 'The post was deleted before publishing.' })
  const { data: loc } = await admin.from('local_seo_locations').select('language').eq('id', change.location_id).maybeSingle()
  await admin.from('gbp_posts').update({ status: 'publishing', error: null }).eq('id', post.id)
  const created = await conn.client.createLocalPost(conn.accountName, conn.locationName, toLocalPost(post, loc?.language ?? 'en'))
  const now = new Date().toISOString()
  await admin
    .from('gbp_posts')
    .update({ status: 'live', post_name: created.name ?? null, search_url: created.searchUrl ?? null, published_at: now })
    .eq('id', post.id)
  await admin.from('local_seo_annotations').insert({
    org_id: change.org_id,
    location_id: change.location_id,
    occurred_at: now,
    kind: 'post',
    title: `Post: ${post.summary.slice(0, 80)}`,
    ref_id: post.id,
  })
  const ok = !!created.name
  return finish(admin, change, ok ? 'succeeded' : 'failed', {
    provider_result: { name: created.name ?? null, state: created.state ?? null } as Json,
    verification: { created: ok } as Json,
  })
}

async function execPostDelete(admin: Admin, change: ChangeRow, conn: Conn, cmd: Extract<GbpCommand, { type: 'post.delete' }>) {
  const { data: post } = await admin.from('gbp_posts').select('post_name').eq('id', cmd.postId).maybeSingle()
  if (post?.post_name) {
    try {
      await conn.client.deleteLocalPost(post.post_name)
    } catch (err) {
      if (!(err instanceof GbpApiError && err.kind === 'not_found')) throw err
    }
  }
  await admin.from('gbp_posts').update({ status: 'deleted' }).eq('id', cmd.postId)
  return finish(admin, change, 'succeeded', { verification: { deleted: true } as Json })
}

// ---------------------------------------------------------------------------
// Rollback + retry queue
// ---------------------------------------------------------------------------

/** Undo a succeeded profile edit with a new request carrying the old values. */
export async function rollbackChange(admin: Admin, orgId: string, changeId: string, actor: GbpActor): Promise<ProposeResult> {
  const { data: change } = await admin.from('gbp_change_requests').select('*').eq('id', changeId).eq('org_id', orgId).maybeSingle()
  if (!change) return { ok: false, code: 'not_found', message: 'Change not found.' }
  if (change.command_type !== 'profile.update' || change.status !== 'succeeded') {
    return { ok: false, code: 'invalid', message: 'Only a published profile edit can be rolled back.' }
  }
  return proposeChange(admin, {
    orgId,
    locationId: change.location_id,
    command: { type: 'profile.update', patch: (change.before_state ?? {}) as ProfilePatch },
    actor,
    rollbackOf: change.id,
    idempotencyKey: `rollback:${change.id}`,
  })
}

/** Retries changes left queued by a transient error. Called by the GBP tick. */
export async function runQueuedChanges(admin: Admin, limit = 20): Promise<number> {
  const { data } = await admin
    .from('gbp_change_requests')
    .select('id, updated_at')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(limit)
  let ran = 0
  for (const c of data ?? []) {
    // Give a just-queued change (being executed inline) a minute first.
    if (Date.now() - new Date(c.updated_at).getTime() < 60_000) continue
    await executeChange(admin, c.id)
    ran++
  }
  return ran
}

