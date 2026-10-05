import 'server-only'

// Business Profile writes from Local SEO.
//
// There is one ledger for every Business Profile write: the Ads Command Engine
// (src/lib/ads/commands/engine.ts, docs/ads/control-plane.md) — preview,
// policy, Google validateOnly, approval, write, read-back, rollback. This
// module only turns Local SEO's intents (reply to this review, publish this
// post, edit these profile fields) into engine commands, applies Local SEO's
// approval rules, and links its own rows (reply drafts, posts) to the change.
// What happens to those rows when a change settles lives in ledger-effects.ts.
//
// Approval rules:
//   * a user who holds local_seo.approve approves by submitting
//   * the opt-in auto-reply to 4-5★ reviews and a post scheduled by an
//     approver run without a further approval (engine actor type 'system')
//   * everything else — AI drafts, workflows, anyone without approve — waits
//     for approval in Local SEO or Ads → Changes

import type { SupabaseClient } from '@supabase/supabase-js'

import { COMMAND_CATALOG, type AdsCommand } from '@/lib/ads/commands/catalog'
import {
  approveChange as engineApprove,
  cancelChange as engineCancel,
  previewChange as enginePreview,
  rollbackChange as engineRollback,
  type ChangeView,
  type EngineFailure,
} from '@/lib/ads/commands/engine'
import { loadEffectivePolicy } from '@/lib/ads/commands/policies'
import type { AdsActor, ChangeStatus } from '@/lib/ads/commands/types'
import type { Database } from '@/types/database'

import { locationTarget, markEngineTargetsHealthy, upsertEngineTarget } from './engine-targets'
import { DAYS, EDITABLE_FIELDS, type HoursRow, type ProfilePatch } from './profile'

type Admin = SupabaseClient<Database>
type PostRow = Database['public']['Tables']['gbp_posts']['Row']

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
  /** The actor holds local_seo.approve (users), or an approver set it up (system). */
  canApprove?: boolean
  /** Org auto-reply policy allows this write without a human (positive reviews only). */
  autoApproved?: boolean
}

/** The slice of an engine change Local SEO callers read. */
export type LedgerChange = Pick<ChangeView, 'id' | 'status' | 'error_message' | 'command_type'>

export type ProposeResult =
  | { ok: true; change: LedgerChange; executed: boolean }
  | { ok: false; code: 'not_connected' | 'not_found' | 'invalid' | 'no_op' | 'provider_error' | 'forbidden'; message: string }

type Fail = Extract<ProposeResult, { ok: false }>

const fail = (code: Fail['code'], message: string): Fail => ({ ok: false, code, message })

function slim(change: ChangeView): LedgerChange {
  return { id: change.id, status: change.status, error_message: change.error_message, command_type: change.command_type }
}

function engineFailure(res: EngineFailure): Fail {
  switch (res.code) {
    case 'no_op':
      return fail('no_op', res.message)
    case 'resource_not_found':
    case 'not_found':
      return fail('not_found', res.message)
    case 'no_connection':
    case 'connection_error':
      return fail('not_connected', res.message)
    case 'forbidden':
    case 'policy_blocked':
    case 'approval_requires_human':
      return fail('forbidden', res.message)
    case 'provider_unavailable':
    case 'provider_rejected':
      return fail('provider_error', res.message)
    default:
      return fail('invalid', res.message)
  }
}

// ---------------------------------------------------------------------------
// Actors
// ---------------------------------------------------------------------------

/**
 * Local SEO actor → engine actor. `delegated` marks a write that runs on an
 * approver's authority without a person clicking now (auto-reply, schedule).
 */
export function toAdsActor(actor: GbpActor, delegated = false): AdsActor {
  const label = actor.label.includes(':') ? actor.label : `local-seo:${actor.label}`
  if (actor.type === 'user') {
    // Reaching here already required local_seo.manage.
    return { type: 'user', id: actor.id ?? null, label: `user:${actor.label}`, canManage: true, canApprove: actor.canApprove === true }
  }
  if (delegated) return { type: 'system', id: actor.id ?? null, label, canManage: true, canApprove: true }
  return { type: actor.type === 'system' ? 'workflow' : actor.type, id: actor.id ?? null, label, canManage: false, canApprove: false }
}

// ---------------------------------------------------------------------------
// Local SEO intent → engine commands
// ---------------------------------------------------------------------------

/** Next day for an overnight period ("22:00-02:00"). */
function closeDay(row: HoursRow): HoursRow['day'] {
  const overnight = row.close !== '24:00' && row.close <= row.open
  return overnight ? DAYS[(DAYS.indexOf(row.day) + 1) % 7] : row.day
}

/** ProfilePatch → update_info and/or set_regular_hours. Pure. */
export function profileCommands(target: string, patch: ProfilePatch): AdsCommand[] | Fail {
  const base = { platform: 'google_business' as const, ad_account_id: target }
  const fields = Object.keys(patch).filter((k) => (EDITABLE_FIELDS as readonly string[]).includes(k))
  if (!fields.length) return fail('invalid', 'Nothing to change.')
  const out: AdsCommand[] = []
  const info: Record<string, unknown> = {}
  if ('description' in patch) info.description = patch.description?.trim() || null
  if ('websiteUri' in patch) info.website_url = patch.websiteUri?.trim() || null
  if ('primaryPhone' in patch) {
    if (!patch.primaryPhone?.trim()) return fail('invalid', 'Google requires a primary phone; it can be changed but not removed.')
    info.primary_phone = patch.primaryPhone.trim()
  }
  if (Object.keys(info).length) out.push({ ...base, type: 'google_business.location.update_info', ...info } as AdsCommand)
  if ('hours' in patch) {
    const rows = patch.hours ?? []
    if (!rows.length) return fail('invalid', 'Add at least one opening period, or mark the business closed instead.')
    out.push({
      ...base,
      type: 'google_business.location.set_regular_hours',
      periods: rows.map((r) => ({ open_day: r.day, open_time: r.open, close_day: closeDay(r), close_time: r.close })),
    } as AdsCommand)
  }
  return out
}

type GooglePostEvent = { title?: string; schedule?: Record<string, { year?: number; month?: number; day?: number; hours?: number; minutes?: number }> }

function isoFromParts(date?: { year?: number; month?: number; day?: number }, time?: { hours?: number; minutes?: number }): string | null {
  if (!date?.year || !date.month || !date.day) return null
  return new Date(Date.UTC(date.year, date.month - 1, date.day, time?.hours ?? 0, time?.minutes ?? 0)).toISOString()
}

/** A Local SEO post row → local_post.create. Pure. */
export function postCreateCommand(target: string, post: PostRow, language: string): AdsCommand {
  const event = post.event as GooglePostEvent | null
  const start = isoFromParts(event?.schedule?.startDate, event?.schedule?.startTime)
  const end = isoFromParts(event?.schedule?.endDate, event?.schedule?.endTime)
  const offer = post.offer as { couponCode?: string; redeemOnlineUrl?: string; termsConditions?: string } | null
  return {
    platform: 'google_business',
    ad_account_id: target,
    type: 'google_business.local_post.create',
    summary: post.summary,
    language_code: language,
    topic_type: post.topic_type,
    ...(post.media_url ? { photo_url: post.media_url } : {}),
    ...(post.cta_type ? { cta_type: post.cta_type } : {}),
    ...(post.cta_type && post.cta_type !== 'CALL' && post.cta_url ? { cta_url: post.cta_url } : {}),
    ...(event?.title && start && end ? { event: { title: event.title, start, end } } : {}),
    ...(post.topic_type === 'OFFER' && offer
      ? {
          offer: {
            ...(offer.couponCode ? { coupon_code: offer.couponCode } : {}),
            ...(offer.redeemOnlineUrl ? { redeem_online_url: offer.redeemOnlineUrl } : {}),
            ...(offer.termsConditions ? { terms: offer.termsConditions } : {}),
          },
        }
      : {}),
  } as AdsCommand
}

type Resolved = {
  target: string
  commands: AdsCommand[]
  /** Review rating, for the auto-reply rule. */
  rating: number | null
  link?: { table: 'gbp_reply_drafts' | 'gbp_posts'; id: string }
  reviewId?: string
}

async function resolve(admin: Admin, orgId: string, locationId: string, command: GbpCommand): Promise<Resolved | Fail> {
  const { data: location } = await admin
    .from('local_seo_locations')
    .select('id, org_id, business_name, language, gbp_connection_id, gbp_account_name, gbp_location_name')
    .eq('id', locationId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (!location) return fail('not_found', 'Location not found.')
  const target = locationTarget(location)
  if (!target || !location.gbp_connection_id) return fail('not_connected', 'Connect this location to Google Business Profile first.')

  const { data: login } = await admin.from('gbp_connections').select('status, connection_error').eq('id', location.gbp_connection_id).maybeSingle()
  if (!login || login.status !== 'active') {
    return fail('not_connected', `Reconnect the Google account in Local SEO → Settings${login?.connection_error ? `: ${login.connection_error}` : '.'}`)
  }

  // A location linked before the engine target existed gets it now; a target
  // the engine flagged after a 401/403 is retried while the login is healthy.
  const { data: engineTarget } = await admin
    .from('ads_connections')
    .select('id, health')
    .eq('org_id', orgId)
    .eq('platform', 'google_business')
    .eq('ad_account_id', target)
    .maybeSingle()
  if (engineTarget?.health === 'error') await markEngineTargetsHealthy(admin, orgId, location.gbp_connection_id)
  if (!engineTarget) {
    const created = await upsertEngineTarget(admin, {
      orgId,
      connectionId: location.gbp_connection_id,
      accountName: location.gbp_account_name!,
      locationName: location.gbp_location_name!,
      title: location.business_name,
    })
    if (created.error) return fail('invalid', created.error)
  }

  const base = { platform: 'google_business' as const, ad_account_id: target }
  switch (command.type) {
    case 'review.reply':
    case 'review.delete_reply': {
      const { data: review } = await admin
        .from('gbp_reviews')
        .select('id, review_name, rating, reply_comment')
        .eq('id', command.reviewId)
        .eq('org_id', orgId)
        .maybeSingle()
      if (!review) return fail('not_found', 'Review not found.')
      if (command.type === 'review.reply') {
        const comment = command.comment.trim()
        if (!comment || comment.length > 4000) return fail('invalid', 'A reply needs 1 to 4,000 characters.')
        if (comment === review.reply_comment) return fail('no_op', 'That reply is already published.')
        return {
          target,
          rating: review.rating,
          reviewId: review.id,
          link: command.draftId ? { table: 'gbp_reply_drafts', id: command.draftId } : undefined,
          commands: [{ ...base, type: 'google_business.review.reply', review_id: review.review_name, comment } as AdsCommand],
        }
      }
      if (!review.reply_comment) return fail('no_op', 'This review has no reply.')
      return {
        target,
        rating: review.rating,
        commands: [{ ...base, type: 'google_business.review.delete_reply', review_id: review.review_name } as AdsCommand],
      }
    }
    case 'profile.update': {
      const commands = profileCommands(target, command.patch)
      if (!Array.isArray(commands)) return commands
      return { target, rating: null, commands }
    }
    case 'post.create':
    case 'post.delete': {
      const { data: post } = await admin.from('gbp_posts').select('*').eq('id', command.postId).eq('org_id', orgId).maybeSingle()
      if (!post) return fail('not_found', 'Post not found.')
      if (command.type === 'post.create') {
        if (post.status === 'live') return fail('no_op', 'This post is already live.')
        return {
          target,
          rating: null,
          link: { table: 'gbp_posts', id: post.id },
          commands: [postCreateCommand(target, post, location.language || 'en')],
        }
      }
      if (!post.post_name) return fail('no_op', 'This post was never published.')
      return { target, rating: null, commands: [{ ...base, type: 'google_business.local_post.delete', post_id: post.post_name } as AdsCommand] }
    }
  }
}

// ---------------------------------------------------------------------------
// Propose
// ---------------------------------------------------------------------------

const SEVERITY: Partial<Record<ChangeStatus, number>> = { failed: 5, drifted: 4, expired: 4, cancelled: 3, awaiting_approval: 2, queued: 1 }

export async function proposeChange(
  admin: Admin,
  input: { orgId: string; locationId: string; command: GbpCommand; actor: GbpActor; idempotencyKey?: string; rollbackOf?: string | null },
): Promise<ProposeResult> {
  const { orgId, command, actor } = input
  const resolved = await resolve(admin, orgId, input.locationId, command)
  if ('ok' in resolved) return resolved

  let autoPositive = actor.autoApproved === true && command.type === 'review.reply' && (resolved.rating ?? 0) >= 4
  // An AI-written auto-reply honours an AI read-only lock on the profile.
  if (autoPositive && (await loadEffectivePolicy(orgId, 'google_business', resolved.target)).aiMode === 'read_only') autoPositive = false
  const delegated = actor.type === 'system' ? actor.canApprove === true : autoPositive
  const engineActor = toAdsActor(actor, delegated)
  // Approvers (and their automations) publish now; everyone else proposes,
  // and the change keeps that rule wherever it is approved (Local SEO or
  // Ads → Changes): never by its author, always by an approver.
  const publishNow = engineActor.canApprove
  const approvalReason = publishNow
    ? undefined
    : { code: 'local_seo_approval', message: 'Business Profile changes from Local SEO need someone with approval rights.' }

  const results: LedgerChange[] = []
  for (const [i, adsCommand] of resolved.commands.entries()) {
    const preview = await enginePreview({
      orgId,
      actor: engineActor,
      command: adsCommand,
      idempotencyKey: input.idempotencyKey && (resolved.commands.length > 1 ? `${input.idempotencyKey}:${i}` : input.idempotencyKey),
      rollbackOf: input.rollbackOf ?? undefined,
      approvalReason,
    })
    if (!preview.ok) {
      if (command.type === 'post.delete' && preview.code === 'resource_not_found') {
        // Already gone on Google (deleted there by hand): just catch up.
        await admin.from('gbp_posts').update({ status: 'deleted' }).eq('id', command.postId).eq('org_id', orgId)
        return fail('no_op', 'The post was already removed from Google.')
      }
      if (!results.length) return engineFailure(preview)
      // An earlier part of this edit already went through; say so.
      const done = results.map((r) => r.command_type.split('.').pop()).join(', ')
      return {
        ok: true,
        change: { ...results[0], status: 'failed', error_message: `Applied ${done}, but ${COMMAND_CATALOG[adsCommand.type].label.toLowerCase()} failed: ${preview.message}` },
        executed: publishNow,
      }
    }
    let change = slim(preview.change)

    // Link Local SEO rows before anything executes: the settle hook finds
    // them by change id.
    if (resolved.link) {
      await admin
        .from(resolved.link.table)
        .update({ change_request_id: change.id, ...(resolved.link.table === 'gbp_posts' && publishNow ? { status: 'publishing' as const } : {}) })
        .eq('id', resolved.link.id)
        .eq('org_id', orgId)
    }
    if (resolved.reviewId) {
      await admin.from('gbp_reviews').update({ reply_state: 'pending' }).eq('id', resolved.reviewId).eq('reply_state', 'none')
    }

    if (publishNow && change.status === 'awaiting_approval') {
      const done = await engineApprove({ orgId, changeId: change.id, actor: engineActor })
      if (done.ok) change = slim(done.change)
      else if (done.change) change = slim(done.change)
      else change = { ...change, error_message: done.message }
    }
    results.push(change)
  }

  const worst = [...results].sort((a, b) => (SEVERITY[b.status] ?? 0) - (SEVERITY[a.status] ?? 0))[0]
  return { ok: true, change: worst, executed: publishNow }
}

// ---------------------------------------------------------------------------
// Approve / reject / rollback — only ever on Business Profile changes
// ---------------------------------------------------------------------------

async function businessProfileChange(admin: Admin, orgId: string, changeId: string) {
  const { data } = await admin.from('ads_change_requests').select('id, platform, status').eq('id', changeId).eq('org_id', orgId).maybeSingle()
  return data?.platform === 'google_business' ? data : null
}

export async function approveChange(admin: Admin, orgId: string, changeId: string, approver: GbpActor): Promise<{ ok: true; change: LedgerChange } | { ok: false; message: string }> {
  if (!(await businessProfileChange(admin, orgId, changeId))) return { ok: false, message: 'Change not found.' }
  const res = await engineApprove({ orgId, changeId, actor: toAdsActor(approver) })
  if (res.ok) return { ok: true, change: slim(res.change) }
  return { ok: false, message: res.message }
}

export async function rejectChange(admin: Admin, orgId: string, changeId: string, actor: GbpActor): Promise<{ ok: boolean; message?: string }> {
  if (!(await businessProfileChange(admin, orgId, changeId))) return { ok: false, message: 'Change not found.' }
  const res = await engineCancel({ orgId, changeId, actor: toAdsActor(actor), reason: 'Rejected in Local SEO' })
  return res.ok ? { ok: true } : { ok: false, message: res.message }
}

/** Undo an applied change with a new change carrying the old values. */
export async function rollbackChange(admin: Admin, orgId: string, changeId: string, actor: GbpActor): Promise<ProposeResult> {
  if (!(await businessProfileChange(admin, orgId, changeId))) return fail('not_found', 'Change not found.')
  const engineActor = toAdsActor(actor)
  const preview = await engineRollback({ orgId, changeId, actor: engineActor })
  if (!preview.ok) return engineFailure(preview)
  if (!engineActor.canApprove || preview.change.status !== 'awaiting_approval') {
    return { ok: true, change: slim(preview.change), executed: false }
  }
  const done = await engineApprove({ orgId, changeId: preview.change.id, actor: engineActor })
  if (!done.ok) return done.change ? { ok: true, change: slim(done.change), executed: true } : engineFailure(done)
  return { ok: true, change: slim(done.change), executed: true }
}
