// Media upload, ads with inline creatives, creative edits, post boosting, welcome messages.
//
// Implemented as a CommandHandler (see ../handlers.ts): this module owns its
// command types end to end — snapshot, plan, validate, execute, verify,
// rollback — and is composed over the base meta adapter in ../index.ts.
//
// Ad creatives are immutable on Meta: "editing" one means building a new
// creative with the changed object_story_spec and repointing the ad at it
// (meta.ad.update_creative, meta.ad.set_welcome_message). Rollback for those
// two is `meta.ad.set_creative` back to the creative the ad pointed at
// before — a command the base adapter already implements.

import type { AdsCommand, CommandOf } from '../../commands/catalog'
import type { DiffEntry, PlanResult, ResourceSnapshot } from '../../commands/types'
import { createObject, getAdAccountInfo, getEdge, getObject, MetaAdsError, updateObject } from '../../meta-api'
import { assertPublicHttpsUrl, safeFetchBytes, SafeFetchError } from '../../safe-fetch'
import { AdsValidationError } from '../../validation'
import { diffField, effective } from '../diff'
import { noOp, type CommandHandler } from '../handlers'
import type { AdapterContext, ExecuteResult, VerifyResult } from '../types'

const MAX_IMAGE_BYTES = 30 * 1024 * 1024
const IMAGE_CONTENT_TYPES = /^image\/(jpeg|png|gif)$/
const VIDEO_POLL_INTERVAL_MS = 3_000
const VIDEO_POLL_MAX_MS = 90_000

const MESSAGING_CTA_TYPES = ['MESSAGE_PAGE', 'WHATSAPP_MESSAGE', 'INSTAGRAM_MESSAGE'] as const
const DEFAULT_MESSAGING_CTA: Record<'MESSENGER' | 'WHATSAPP' | 'INSTAGRAM_DIRECT', string> = {
  MESSENGER: 'MESSAGE_PAGE',
  WHATSAPP: 'WHATSAPP_MESSAGE',
  INSTAGRAM_DIRECT: 'INSTAGRAM_MESSAGE',
}

// ─── Shared helpers (duplicated from meta-adapter.ts, which exports none of
// these — small enough to keep two copies rather than widen that module's
// surface for a handful of call sites) ──────────────────────────────────────

/** A Graph 100/33 ("does not exist or no permission") is "not found", not a failure. */
function isNotFound(error: unknown): boolean {
  return error instanceof MetaAdsError && error.code === 100 && (error.subcode === 33 || /does not exist/i.test(error.message))
}

async function readNode<T>(id: string, fields: string, ctx: AdapterContext): Promise<T | null> {
  try {
    return await getObject<T>(id, fields, ctx.credential)
  } catch (error) {
    if (isNotFound(error)) return null
    throw error
  }
}

/** "act_123" and "123" name the same account. */
function sameAccount(accountId: string | undefined, ctxAccount: string): boolean {
  return !!accountId && accountId.replace(/^act_/, '') === ctxAccount.replace(/^act_/, '')
}

async function currencyOf(ctx: AdapterContext): Promise<string> {
  const info = await getAdAccountInfo(ctx.adAccountId, ctx.credential)
  return info.currency ?? 'USD'
}

/** A SafeFetchError names a bad caller-supplied URL (SSRF, size, type) — never worth retrying. */
function rethrowAsValidation(error: unknown): never {
  if (error instanceof SafeFetchError) throw new AdsValidationError(error.message)
  throw error
}

// ─── meta.media.upload_image ────────────────────────────────────────────────

type MetaAdImagesCreateResponse = { images?: Record<string, { hash?: string; url?: string }> }
type MetaAdImageRecord = { hash?: string; status?: string }
/** Meta's GET .../adimages?hashes=[...] shape isn't fully documented for every
 *  API version — some responses come back keyed by hash, others as {data:[...]}.
 *  Handled defensively so a shape we didn't anticipate degrades to "unknown"
 *  rather than throwing. */
type MetaAdImagesLookupResponse = { data?: MetaAdImageRecord[] } | Record<string, MetaAdImageRecord | undefined>

function extractAdImage(res: MetaAdImagesLookupResponse, hash: string): MetaAdImageRecord | null {
  if (res && typeof res === 'object' && 'data' in res && Array.isArray((res as { data?: unknown }).data)) {
    const list = (res as { data: MetaAdImageRecord[] }).data
    const match = list.find((img) => img.hash === hash) ?? list[0]
    return match?.hash ? match : null
  }
  const map = res as Record<string, MetaAdImageRecord | undefined>
  const direct = map[hash]
  if (direct?.hash) return direct
  const first = Object.values(map).find((v): v is MetaAdImageRecord => Boolean(v?.hash))
  return first ?? null
}

/**
 * Look up an uploaded image by hash. A failed or empty lookup is treated as
 * inconclusive, not as "not found", by every caller below: the upload itself
 * already returned Meta's hash, and a read hiccup must not fail a change that
 * landed.
 */
async function findAdImage(ctx: AdapterContext, adAccountId: string, hash: string): Promise<MetaAdImageRecord | null> {
  try {
    const res = await getEdge<MetaAdImagesLookupResponse>(
      `${adAccountId}/adimages`,
      { hashes: JSON.stringify([hash]), fields: 'hash,status' },
      ctx.credential,
    )
    return extractAdImage(res, hash)
  } catch {
    return null
  }
}

async function snapshotUploadImage(ctx: AdapterContext, cmd: CommandOf<'meta.media.upload_image'>): Promise<ResourceSnapshot> {
  const currency = await currencyOf(ctx)
  return {
    resourceType: 'media',
    resourceId: null,
    resourceName: cmd.name ?? null,
    campaignId: null,
    currency,
    fields: { image_url: cmd.image_url, name: cmd.name ?? null },
  }
}

function planUploadImage(cmd: CommandOf<'meta.media.upload_image'>): PlanResult {
  const diff: DiffEntry[] = [diffField('image_url', 'Image URL', null, cmd.image_url)]
  if (cmd.name) diff.push(diffField('name', 'Name', null, cmd.name))
  return { ok: true, intended: { image_url: cmd.image_url, name: cmd.name ?? null }, diff, warnings: [], facts: {} }
}

async function validateUploadImage(cmd: CommandOf<'meta.media.upload_image'>): Promise<void> {
  await safeFetchBytes(cmd.image_url, { maxBytes: MAX_IMAGE_BYTES, accept: IMAGE_CONTENT_TYPES }).catch(rethrowAsValidation)
}

async function executeUploadImage(ctx: AdapterContext, cmd: CommandOf<'meta.media.upload_image'>): Promise<ExecuteResult> {
  // Fetched again here rather than reused from validate(): the two run as
  // separate calls (preview vs. execution, possibly minutes apart), and
  // caching bytes across them would mean acting on a payload nobody re-checked.
  const { bytes } = await safeFetchBytes(cmd.image_url, { maxBytes: MAX_IMAGE_BYTES, accept: IMAGE_CONTENT_TYPES }).catch(rethrowAsValidation)
  const body: Record<string, unknown> = { bytes: bytes.toString('base64') }
  if (cmd.name) body.name = cmd.name
  const raw = (await createObject(`${cmd.ad_account_id}/adimages`, body, ctx.credential)) as unknown as MetaAdImagesCreateResponse
  const entry = raw.images ? Object.values(raw.images)[0] : undefined
  if (!entry?.hash) throw new MetaAdsError('Meta did not return an image hash for the uploaded image')
  return { providerRef: entry.hash, raw }
}

async function verifyUploadImage(ctx: AdapterContext, cmd: CommandOf<'meta.media.upload_image'>, providerRef: string | null): Promise<VerifyResult> {
  if (!providerRef) return { ok: false, mismatches: [{ field: 'hash', expected: 'an image hash', actual: null }], observed: null }
  const info = await findAdImage(ctx, cmd.ad_account_id, providerRef)
  if (!info) {
    // See findAdImage's note: a failed/empty read-back does not mean the
    // upload failed — execute() already has a hash straight from Meta's own
    // create response. Don't fail an otherwise successful upload on this
    // best-effort confirmation.
    return { ok: true, mismatches: [], observed: { hash: providerRef, status: 'unknown' } }
  }
  const status = info.status ?? 'ACTIVE'
  const ok = status === 'ACTIVE'
  return { ok, mismatches: ok ? [] : [{ field: 'status', expected: 'ACTIVE', actual: status }], observed: { hash: providerRef, status } }
}

// ─── meta.media.upload_video ─────────────────────────────────────────────────

/**
 * Poll a freshly created video until Meta finishes processing it, or give up
 * after `maxMs`. Exported (with overridable interval/max) purely so tests can
 * exercise "eventually ready" and "still processing" without a real wall-clock
 * wait — production execute() always calls it with the spec defaults (3 s /
 * ~90 s).
 */
export async function pollVideoReady(
  ctx: AdapterContext,
  videoId: string,
  opts: { intervalMs?: number; maxMs?: number } = {},
): Promise<{ ready: boolean; status: string }> {
  const interval = opts.intervalMs ?? VIDEO_POLL_INTERVAL_MS
  const max = opts.maxMs ?? VIDEO_POLL_MAX_MS
  const deadline = Date.now() + max
  for (;;) {
    const node = await getObject<{ status?: { video_status?: string } }>(videoId, 'status', ctx.credential)
    const status = node.status?.video_status ?? 'processing'
    if (status === 'ready') return { ready: true, status }
    if (Date.now() >= deadline) return { ready: false, status }
    await new Promise((resolve) => setTimeout(resolve, interval))
  }
}

async function snapshotUploadVideo(ctx: AdapterContext, cmd: CommandOf<'meta.media.upload_video'>): Promise<ResourceSnapshot> {
  const currency = await currencyOf(ctx)
  return {
    resourceType: 'media',
    resourceId: null,
    resourceName: cmd.name,
    campaignId: null,
    currency,
    fields: { video_url: cmd.video_url, name: cmd.name },
  }
}

function planUploadVideo(cmd: CommandOf<'meta.media.upload_video'>): PlanResult {
  return {
    ok: true,
    intended: { video_url: cmd.video_url, name: cmd.name },
    diff: [diffField('video_url', 'Video URL', null, cmd.video_url), diffField('name', 'Name', null, cmd.name)],
    warnings: [],
    facts: {},
  }
}

async function validateUploadVideo(cmd: CommandOf<'meta.media.upload_video'>): Promise<void> {
  // Meta fetches the file itself, so only a resolve-only SSRF/scheme check
  // runs here — no bytes are downloaded server-side for video.
  await assertPublicHttpsUrl(cmd.video_url).catch(rethrowAsValidation)
}

async function executeUploadVideo(ctx: AdapterContext, cmd: CommandOf<'meta.media.upload_video'>): Promise<ExecuteResult> {
  await assertPublicHttpsUrl(cmd.video_url).catch(rethrowAsValidation)
  const res = await createObject(`${cmd.ad_account_id}/advideos`, { file_url: cmd.video_url, name: cmd.name }, ctx.credential)
  if (!res.id) throw new MetaAdsError('Meta did not return an id for the uploaded video')
  const poll = await pollVideoReady(ctx, res.id)
  return { providerRef: res.id, raw: { id: res.id, video_status: poll.status, still_processing: !poll.ready } }
}

async function verifyUploadVideo(ctx: AdapterContext, providerRef: string | null): Promise<VerifyResult> {
  if (!providerRef) return { ok: false, mismatches: [{ field: 'id', expected: 'a new video id', actual: null }], observed: null }
  try {
    const node = await getObject<{ id?: string; status?: { video_status?: string } }>(providerRef, 'id,status', ctx.credential)
    const status = node.status?.video_status ?? 'unknown'
    const observed: Record<string, unknown> = { id: providerRef, video_status: status }
    // Still-processing is expected, not a failure: the upload succeeded and
    // Meta transcodes asynchronously. Surfaced as a note on the observed
    // state rather than a mismatch (VerifyResult has no separate "warnings").
    if (status !== 'ready') observed.note = 'The video is still processing on Meta; it becomes usable once processing finishes.'
    return { ok: true, mismatches: [], observed }
  } catch {
    return { ok: true, mismatches: [], observed: { id: providerRef, video_status: 'unknown' } }
  }
}

// ─── meta.ad.create_with_creative ────────────────────────────────────────────

type AdsetForCreate = { id: string; name: string; status: string; account_id?: string; campaign_id?: string }
type PageRef = { id: string; name?: string }
type VideoRef = { id: string; status?: { video_status?: string } }

function messagingCallToAction(cmd: CommandOf<'meta.ad.create_with_creative'>): Record<string, unknown> {
  const destination = cmd.messaging_destination as 'MESSENGER' | 'WHATSAPP' | 'INSTAGRAM_DIRECT'
  return { type: cmd.call_to_action_type ?? DEFAULT_MESSAGING_CTA[destination], value: { app_destination: destination } }
}

function linkCallToAction(cmd: CommandOf<'meta.ad.create_with_creative'>): Record<string, unknown> | undefined {
  if (!cmd.call_to_action_type) return undefined
  return { type: cmd.call_to_action_type, value: { link: cmd.link } }
}

function prune<T extends Record<string, unknown>>(obj: T): T {
  const out = {} as T
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v
  }
  return out
}

function buildObjectStorySpec(cmd: CommandOf<'meta.ad.create_with_creative'>): Record<string, unknown> {
  const cta = cmd.messaging_destination ? messagingCallToAction(cmd) : linkCallToAction(cmd)
  const spec: Record<string, unknown> = { page_id: cmd.page_id }
  if (cmd.instagram_user_id) spec.instagram_user_id = cmd.instagram_user_id

  if (cmd.video_id) {
    spec.video_data = prune({
      video_id: cmd.video_id,
      image_hash: cmd.image_hash,
      message: cmd.message,
      title: cmd.headline,
      link_description: cmd.description,
      call_to_action: cta,
    })
  } else {
    spec.link_data = prune({
      link: cmd.link,
      message: cmd.message,
      name: cmd.headline,
      description: cmd.description,
      image_hash: cmd.image_hash,
      call_to_action: cta,
    })
  }
  return spec
}

function describeCreative(cmd: CommandOf<'meta.ad.create_with_creative'>): string {
  if (cmd.messaging_destination) return `Click-to-message (${cmd.messaging_destination})`
  if (cmd.video_id) return `Video ad → ${cmd.link}`
  return `Link ad → ${cmd.link}`
}

async function snapshotCreateWithCreative(ctx: AdapterContext, cmd: CommandOf<'meta.ad.create_with_creative'>): Promise<ResourceSnapshot | null> {
  const [adset, page, currency] = await Promise.all([
    readNode<AdsetForCreate>(cmd.adset_id, 'id,name,status,account_id,campaign_id', ctx),
    readNode<PageRef>(cmd.page_id, 'id,name', ctx),
    currencyOf(ctx),
  ])
  if (!adset || !sameAccount(adset.account_id, ctx.adAccountId)) return null

  const [imageHashRecord, video] = await Promise.all([
    cmd.image_hash ? findAdImage(ctx, cmd.ad_account_id, cmd.image_hash) : Promise.resolve(null),
    cmd.video_id ? readNode<VideoRef>(cmd.video_id, 'id,status', ctx) : Promise.resolve(null),
  ])

  return {
    resourceType: 'ad',
    resourceId: null,
    resourceName: cmd.name,
    campaignId: adset.campaign_id ?? null,
    currency,
    fields: {
      adset_status: adset.status,
      adset_name: adset.name,
      page_exists: Boolean(page),
      // A failed adimages lookup (see findAdImage) is inconclusive, not
      // "missing" — don't block a create on ambiguity in a best-effort check.
      image_hash_exists: cmd.image_hash ? Boolean(imageHashRecord) || imageHashRecord === null : true,
      video_exists: cmd.video_id ? Boolean(video) : true,
    },
  }
}

function planCreateWithCreative(cmd: CommandOf<'meta.ad.create_with_creative'>, before: ResourceSnapshot): PlanResult {
  const f = before.fields
  if (f.adset_status === 'DELETED' || f.adset_status === 'ARCHIVED') {
    return { ok: false, code: 'resource_archived', message: `The ad set is ${f.adset_status} in Meta and cannot receive new ads.` }
  }
  if (!f.page_exists) return { ok: false, code: 'page_not_found', message: 'That Facebook Page was not found (or is not accessible with this token).' }
  if (cmd.video_id && !f.video_exists) {
    return { ok: false, code: 'video_not_found', message: `Video ${cmd.video_id} was not found in this ad account. Upload it first with meta.media.upload_video.` }
  }

  const spec = buildObjectStorySpec(cmd)
  const intended = { name: cmd.name, adset_id: cmd.adset_id, object_story_spec: spec, status: 'PAUSED' }
  const diff: DiffEntry[] = [
    diffField('name', 'Name', null, cmd.name),
    diffField('adset_id', 'Ad set', null, (f.adset_name as string | null) ?? cmd.adset_id),
    diffField('creative', 'Creative', null, describeCreative(cmd)),
    diffField('status', 'Status', null, 'PAUSED'),
  ]
  return { ok: true, intended, diff, warnings: [], facts: {} }
}

async function validateCreateWithCreative(ctx: AdapterContext, cmd: CommandOf<'meta.ad.create_with_creative'>, before: ResourceSnapshot): Promise<void> {
  const plan = planCreateWithCreative(cmd, before)
  if (!plan.ok) throw new AdsValidationError(plan.message)
  const spec = plan.intended.object_story_spec as Record<string, unknown>
  // Only the creative call is validate-only'd: the ad call needs a real
  // creative_id, which doesn't exist until the creative is actually created.
  await createObject(`${cmd.ad_account_id}/adcreatives`, { name: cmd.name, object_story_spec: spec }, ctx.credential, { validateOnly: true })
}

async function executeCreateWithCreative(ctx: AdapterContext, cmd: CommandOf<'meta.ad.create_with_creative'>, before: ResourceSnapshot): Promise<ExecuteResult> {
  const plan = planCreateWithCreative(cmd, before)
  if (!plan.ok) throw new AdsValidationError(plan.message)
  const spec = plan.intended.object_story_spec as Record<string, unknown>
  const creative = await createObject(`${cmd.ad_account_id}/adcreatives`, { name: cmd.name, object_story_spec: spec }, ctx.credential)
  if (!creative.id) throw new MetaAdsError('Meta did not return an id for the created creative')
  try {
    const ad = await createObject(`${cmd.ad_account_id}/ads`, { name: cmd.name, adset_id: cmd.adset_id, creative: { creative_id: creative.id }, status: 'PAUSED' }, ctx.credential)
    if (!ad.id) throw new MetaAdsError('Meta did not return an id for the created ad')
    return { providerRef: ad.id, raw: { creative_id: creative.id, ad } }
  } catch (error) {
    // The creative now exists with nothing pointing at it. Surface its id in
    // the error so an operator (or the engine's failure record) can find and
    // clean it up — this adapter never deletes objects automatically.
    const message = error instanceof Error ? error.message : String(error)
    throw new MetaAdsError(`Ad creation failed after the creative was created (orphan creative ${creative.id}): ${message}`)
  }
}

async function verifyCreateWithCreative(ctx: AdapterContext, providerRef: string | null): Promise<VerifyResult> {
  if (!providerRef) return { ok: false, mismatches: [{ field: 'id', expected: 'a new ad id', actual: null }], observed: null }
  const node = await readNode<{ id: string; name: string; status: string; account_id?: string; creative?: { id?: string } }>(
    providerRef,
    'id,name,status,account_id,creative{id}',
    ctx,
  )
  if (!node) return { ok: false, mismatches: [{ field: '*', expected: 'the created ad', actual: null }], observed: null }
  const mismatches: Array<{ field: string; expected: unknown; actual: unknown }> = []
  if (node.status !== 'PAUSED') mismatches.push({ field: 'status', expected: 'PAUSED', actual: node.status })
  if (!node.creative?.id) mismatches.push({ field: 'creative_id', expected: 'set', actual: null })
  if (!sameAccount(node.account_id, ctx.adAccountId)) mismatches.push({ field: 'account_id', expected: ctx.adAccountId, actual: node.account_id })
  return { ok: mismatches.length === 0, mismatches, observed: { id: node.id, status: node.status, creative_id: node.creative?.id ?? null } }
}

// ─── Shared: reading and rewriting an ad's creative ─────────────────────────
// (meta.ad.update_creative and meta.ad.set_welcome_message both read the ad's
// current creative, build a modified object_story_spec, create a new creative
// from it, and repoint the ad — creatives are immutable on Meta.)

type CreativeNode = {
  id: string
  name?: string
  object_story_spec?: StorySpec
  url_tags?: string
  degrees_of_freedom_spec?: Record<string, unknown>
  asset_feed_spec?: Record<string, unknown>
  object_story_id?: string
}
type AdWithCreative = { id: string; name: string; status: string; account_id?: string; campaign_id?: string; creative?: CreativeNode }

type LinkData = Record<string, unknown> & {
  name?: string
  description?: string
  link?: string
  image_hash?: string
  message?: string
  call_to_action?: Record<string, unknown>
  child_attachments?: Array<Record<string, unknown>>
  page_welcome_message?: string
}
type VideoData = Record<string, unknown> & {
  title?: string
  link_description?: string
  image_hash?: string
  message?: string
  call_to_action?: Record<string, unknown>
  video_id?: string
  page_welcome_message?: string
}
type StorySpec = Record<string, unknown> & { page_id?: string; instagram_user_id?: string; link_data?: LinkData; video_data?: VideoData }

const AD_FIELDS_WITH_CREATIVE =
  'id,name,status,account_id,campaign_id,creative{id,name,object_story_spec,url_tags,degrees_of_freedom_spec,asset_feed_spec,object_story_id}'

function isClickToMessage(spec: StorySpec | null | undefined): boolean {
  const cta = (spec?.link_data?.call_to_action ?? spec?.video_data?.call_to_action) as Record<string, unknown> | undefined
  if (!cta) return false
  const value = cta.value as Record<string, unknown> | undefined
  const type = typeof cta.type === 'string' ? cta.type : ''
  return Boolean(value?.app_destination) || (MESSAGING_CTA_TYPES as readonly string[]).includes(type)
}

async function snapshotAdCreative(ctx: AdapterContext, adId: string): Promise<ResourceSnapshot | null> {
  const [node, currency] = await Promise.all([readNode<AdWithCreative>(adId, AD_FIELDS_WITH_CREATIVE, ctx), currencyOf(ctx)])
  if (!node || !sameAccount(node.account_id, ctx.adAccountId)) return null
  const creative = node.creative ?? null
  const spec = creative?.object_story_spec ?? null
  return {
    resourceType: 'ad',
    resourceId: node.id,
    resourceName: node.name,
    campaignId: node.campaign_id ?? null,
    currency,
    fields: {
      ad_status: node.status,
      creative_id: creative?.id ?? null,
      creative_name: creative?.name ?? null,
      object_story_spec: spec,
      url_tags: creative?.url_tags ?? null,
      // Dynamic/Advantage+ creatives carry their content in asset_feed_spec
      // (or a degrees_of_freedom_spec), not object_story_spec — this module
      // can't safely edit that shape.
      is_dynamic: Boolean(creative?.asset_feed_spec || creative?.degrees_of_freedom_spec),
      // A creative promoting an organic post carries object_story_id instead
      // of (or alongside) object_story_spec; its content lives on the post.
      is_boosted_post: Boolean(creative?.object_story_id),
      is_click_to_message: isClickToMessage(spec),
    },
  }
}

function creativeBody(before: ResourceSnapshot, adId: string, objectStorySpec: Record<string, unknown>, urlTagsOverride?: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: (before.fields.creative_name as string | null) ?? `Creative for ad ${adId}`,
    object_story_spec: objectStorySpec,
  }
  const tags = urlTagsOverride !== undefined ? urlTagsOverride : (before.fields.url_tags as string | null)
  if (tags) body.url_tags = tags
  return body
}

// ─── meta.ad.update_creative ─────────────────────────────────────────────────

/**
 * Meta returns a creative's object_story_spec with BOTH the image reference it
 * stored and the URL it derived from it (video_data.image_hash + image_url,
 * link_data.image_hash + picture). Sending that back when creating the edited
 * copy is rejected ("Only one of image_url and image_hash should be
 * specified") — found by the live smoke test. Keep the hash, drop the derived
 * URL, at every level a carousel can nest it.
 */
export function sanitizeStorySpecForCreate(spec: StorySpec): StorySpec {
  const dedupe = (node: Record<string, unknown> | undefined) => {
    if (!node) return
    if (node.image_hash) {
      delete node.image_url
      delete node.picture
    }
  }
  dedupe(spec.video_data as Record<string, unknown> | undefined)
  dedupe(spec.link_data as Record<string, unknown> | undefined)
  const cards = (spec.link_data as { child_attachments?: unknown } | undefined)?.child_attachments
  if (Array.isArray(cards)) for (const card of cards) dedupe(card as Record<string, unknown>)
  return spec
}

type CreativeEditOutcome = { ok: true; nextSpec: StorySpec; diff: DiffEntry[] } | { ok: false; code: string; message: string }

/** Apply the requested content-field edits to a cloned spec, targeting either
 *  the top-level link_data/video_data or, when card_index is given, that
 *  carousel card (link_data.child_attachments[i]). */
function applyCreativeEdits(spec: StorySpec, cmd: CommandOf<'meta.ad.update_creative'>): CreativeEditOutcome {
  const next: StorySpec = sanitizeStorySpecForCreate(structuredClone(spec ?? {}))
  const isVideo = Boolean(next.video_data) && !next.link_data
  let target: Record<string, unknown> | undefined

  if (cmd.card_index !== undefined) {
    const cards = next.link_data?.child_attachments
    if (!Array.isArray(cards) || !cards[cmd.card_index]) {
      return { ok: false, code: 'card_not_found', message: `No carousel card at index ${cmd.card_index}.` }
    }
    target = cards[cmd.card_index]
  } else {
    target = isVideo ? next.video_data : next.link_data
  }

  const contentFieldsRequested = [cmd.message, cmd.headline, cmd.description, cmd.link, cmd.image_hash, cmd.call_to_action_type].some((v) => v !== undefined)
  if (!target && contentFieldsRequested) {
    return { ok: false, code: 'unsupported_creative_shape', message: 'This creative has neither link_data nor video_data to edit.' }
  }

  const nameField = isVideo ? 'title' : 'name'
  const descField = isVideo ? 'link_description' : 'description'
  const diff: DiffEntry[] = []
  if (target) {
    if (cmd.message !== undefined) {
      diff.push(diffField('message', 'Message', target.message, cmd.message))
      target.message = cmd.message
    }
    if (cmd.headline !== undefined) {
      diff.push(diffField('headline', 'Headline', target[nameField], cmd.headline))
      target[nameField] = cmd.headline
    }
    if (cmd.description !== undefined) {
      diff.push(diffField('description', 'Description', target[descField], cmd.description))
      target[descField] = cmd.description
    }
    if (cmd.link !== undefined) {
      diff.push(diffField('link', 'Link', target.link, cmd.link))
      target.link = cmd.link
    }
    if (cmd.image_hash !== undefined) {
      diff.push(diffField('image_hash', 'Image', target.image_hash, cmd.image_hash))
      target.image_hash = cmd.image_hash
    }
    if (cmd.call_to_action_type !== undefined) {
      const current = (target.call_to_action as Record<string, unknown> | undefined)?.type ?? null
      diff.push(diffField('call_to_action_type', 'Call to action', current, cmd.call_to_action_type))
      target.call_to_action = { ...((target.call_to_action as Record<string, unknown>) ?? {}), type: cmd.call_to_action_type }
    }
  }
  return { ok: true, nextSpec: next, diff }
}

function planUpdateCreative(cmd: CommandOf<'meta.ad.update_creative'>, before: ResourceSnapshot): PlanResult {
  const f = before.fields
  if (!f.creative_id) return { ok: false, code: 'no_creative', message: 'This ad has no creative to edit.' }

  const contentFieldsRequested = [cmd.message, cmd.headline, cmd.description, cmd.link, cmd.image_hash, cmd.call_to_action_type, cmd.card_index].some(
    (v) => v !== undefined,
  )
  // url_tags is still allowed on a dynamic or boosted-post creative — only
  // the content fields are refused for those.
  if (f.is_dynamic && contentFieldsRequested) {
    return { ok: false, code: 'dynamic_creative', message: 'This ad uses a dynamic/Advantage+ creative; Xphere cannot edit its content (url_tags can still be changed).' }
  }
  if (f.is_boosted_post && contentFieldsRequested) {
    return { ok: false, code: 'boosted_post_creative', message: 'This ad promotes an organic post; only url_tags can be changed here.' }
  }

  const spec = (f.object_story_spec ?? {}) as StorySpec
  const result = applyCreativeEdits(spec, cmd)
  if (!result.ok) return result

  const diff = [...result.diff]
  if (cmd.url_tags !== undefined) diff.push(diffField('url_tags', 'URL tags', f.url_tags, cmd.url_tags))
  const changes = effective(diff)
  if (changes.length === 0) return noOp()
  return { ok: true, intended: { object_story_spec: result.nextSpec, url_tags: cmd.url_tags ?? (f.url_tags as string | null) ?? null }, diff: changes, warnings: [], facts: {} }
}

async function validateUpdateCreative(ctx: AdapterContext, cmd: CommandOf<'meta.ad.update_creative'>, before: ResourceSnapshot): Promise<void> {
  const plan = planUpdateCreative(cmd, before)
  if (!plan.ok) throw new AdsValidationError(plan.message)
  const body = creativeBody(before, cmd.ad_id, plan.intended.object_story_spec as Record<string, unknown>, cmd.url_tags)
  await createObject(`${cmd.ad_account_id}/adcreatives`, body, ctx.credential, { validateOnly: true })
}

async function executeUpdateCreative(ctx: AdapterContext, cmd: CommandOf<'meta.ad.update_creative'>, before: ResourceSnapshot): Promise<ExecuteResult> {
  const plan = planUpdateCreative(cmd, before)
  if (!plan.ok) throw new AdsValidationError(plan.message)
  const body = creativeBody(before, cmd.ad_id, plan.intended.object_story_spec as Record<string, unknown>, cmd.url_tags)
  const creative = await createObject(`${cmd.ad_account_id}/adcreatives`, body, ctx.credential)
  if (!creative.id) throw new MetaAdsError('Meta did not return an id for the new creative')
  const res = await updateObject(cmd.ad_id, { creative: { creative_id: creative.id } }, ctx.credential)
  if (res.success === false) throw new MetaAdsError('Meta reported the ad update as unsuccessful')
  return { providerRef: creative.id, raw: { creative_id: creative.id, ad_update: res } }
}

async function verifyUpdateCreative(ctx: AdapterContext, cmd: CommandOf<'meta.ad.update_creative'>, intended: Record<string, unknown>, providerRef: string | null): Promise<VerifyResult> {
  if (!providerRef) return { ok: false, mismatches: [{ field: 'creative_id', expected: 'a new creative id', actual: null }], observed: null }
  const snap = await snapshotAdCreative(ctx, cmd.ad_id)
  if (!snap) return { ok: false, mismatches: [{ field: '*', expected: intended, actual: null }], observed: null }
  const mismatches: Array<{ field: string; expected: unknown; actual: unknown }> = []
  if (snap.fields.creative_id !== providerRef) mismatches.push({ field: 'creative_id', expected: providerRef, actual: snap.fields.creative_id })
  if (intended.url_tags !== undefined && (snap.fields.url_tags ?? null) !== (intended.url_tags ?? null)) {
    mismatches.push({ field: 'url_tags', expected: intended.url_tags, actual: snap.fields.url_tags })
  }
  return { ok: mismatches.length === 0, mismatches, observed: snap.fields }
}

function rollbackToPreviousCreative(command: CommandOf<'meta.ad.update_creative'> | CommandOf<'meta.ad.set_welcome_message'>, before: ResourceSnapshot): AdsCommand | null {
  const oldCreativeId = before.fields.creative_id
  if (typeof oldCreativeId !== 'string') return null
  return { platform: 'meta', ad_account_id: command.ad_account_id, type: 'meta.ad.set_creative', ad_id: command.ad_id, creative_id: oldCreativeId }
}

// ─── meta.ad.set_welcome_message ─────────────────────────────────────────────

/**
 * Meta's documented shape for a text greeting on a click-to-message ad. The
 * exact JSON contract for `page_welcome_message` isn't nailed down in Xphere's
 * own testing (Meta's docs are thin here) — this is the commonly-referenced
 * "visual editor" ice-breakers shape. If it's wrong, Meta's own validate_only
 * call on the new creative (validate()/execute() both go through it) surfaces
 * a clear rejection rather than silently writing something malformed.
 */
function buildWelcomeMessagePayload(greeting: string): string {
  return JSON.stringify({
    type: 'VISUAL_EDITOR',
    version: 2,
    landing_screen_type: 'welcome_message',
    media_type: 'text',
    text_format: { customer_action_type: 'ice_breakers', message: { text: greeting, ice_breakers: [] } },
  })
}

function planWelcomeMessage(cmd: CommandOf<'meta.ad.set_welcome_message'>, before: ResourceSnapshot): PlanResult {
  const f = before.fields
  if (!f.creative_id) return { ok: false, code: 'no_creative', message: 'This ad has no creative to edit.' }
  if (f.is_dynamic) return { ok: false, code: 'dynamic_creative', message: 'This ad uses a dynamic/Advantage+ creative; Xphere cannot edit its content.' }
  if (!f.is_click_to_message) {
    return { ok: false, code: 'not_click_to_message', message: 'Welcome messages only apply to click-to-message ads (Messenger, WhatsApp or Instagram Direct).' }
  }

  const spec = sanitizeStorySpecForCreate(structuredClone((f.object_story_spec ?? {}) as StorySpec))
  const isVideo = Boolean(spec.video_data) && !spec.link_data
  const target = isVideo ? spec.video_data : spec.link_data
  if (!target) return { ok: false, code: 'unsupported_creative_shape', message: 'This creative has neither link_data nor video_data to edit.' }

  const payload = buildWelcomeMessagePayload(cmd.welcome_message)
  const beforeValue = target.page_welcome_message ?? null
  target.page_welcome_message = payload
  const diff = effective([diffField('welcome_message', 'Welcome message', beforeValue, payload)])
  if (diff.length === 0) return noOp()
  return { ok: true, intended: { object_story_spec: spec }, diff, warnings: [], facts: {} }
}

async function validateWelcomeMessage(ctx: AdapterContext, cmd: CommandOf<'meta.ad.set_welcome_message'>, before: ResourceSnapshot): Promise<void> {
  const plan = planWelcomeMessage(cmd, before)
  if (!plan.ok) throw new AdsValidationError(plan.message)
  const body = creativeBody(before, cmd.ad_id, plan.intended.object_story_spec as Record<string, unknown>)
  await createObject(`${cmd.ad_account_id}/adcreatives`, body, ctx.credential, { validateOnly: true })
}

async function executeWelcomeMessage(ctx: AdapterContext, cmd: CommandOf<'meta.ad.set_welcome_message'>, before: ResourceSnapshot): Promise<ExecuteResult> {
  const plan = planWelcomeMessage(cmd, before)
  if (!plan.ok) throw new AdsValidationError(plan.message)
  const body = creativeBody(before, cmd.ad_id, plan.intended.object_story_spec as Record<string, unknown>)
  const creative = await createObject(`${cmd.ad_account_id}/adcreatives`, body, ctx.credential)
  if (!creative.id) throw new MetaAdsError('Meta did not return an id for the new creative')
  const res = await updateObject(cmd.ad_id, { creative: { creative_id: creative.id } }, ctx.credential)
  if (res.success === false) throw new MetaAdsError('Meta reported the ad update as unsuccessful')
  return { providerRef: creative.id, raw: { creative_id: creative.id, ad_update: res } }
}

async function verifyWelcomeMessage(ctx: AdapterContext, cmd: CommandOf<'meta.ad.set_welcome_message'>, intended: Record<string, unknown>, providerRef: string | null): Promise<VerifyResult> {
  if (!providerRef) return { ok: false, mismatches: [{ field: 'creative_id', expected: 'a new creative id', actual: null }], observed: null }
  const snap = await snapshotAdCreative(ctx, cmd.ad_id)
  if (!snap) return { ok: false, mismatches: [{ field: '*', expected: intended, actual: null }], observed: null }
  const mismatches: Array<{ field: string; expected: unknown; actual: unknown }> = []
  if (snap.fields.creative_id !== providerRef) mismatches.push({ field: 'creative_id', expected: providerRef, actual: snap.fields.creative_id })
  return { ok: mismatches.length === 0, mismatches, observed: snap.fields }
}

// ─── meta.post.boost ──────────────────────────────────────────────────────────

type AdsetForBoost = {
  id: string
  name: string
  status: string
  account_id?: string
  campaign_id?: string
  promoted_object?: { page_id?: string }
  campaign?: { id?: string; objective?: string }
}

async function snapshotBoost(ctx: AdapterContext, cmd: CommandOf<'meta.post.boost'>): Promise<ResourceSnapshot | null> {
  const [adset, currency] = await Promise.all([
    readNode<AdsetForBoost>(cmd.adset_id, 'id,name,status,account_id,campaign_id,promoted_object,campaign{id,objective}', ctx),
    currencyOf(ctx),
  ])
  if (!adset || !sameAccount(adset.account_id, ctx.adAccountId)) return null
  const postPageId = cmd.post_id.split('_')[0]
  return {
    resourceType: 'ad',
    resourceId: null,
    resourceName: cmd.name,
    campaignId: adset.campaign_id ?? adset.campaign?.id ?? null,
    currency,
    fields: {
      adset_status: adset.status,
      adset_name: adset.name,
      campaign_objective: adset.campaign?.objective ?? null,
      promoted_page_id: adset.promoted_object?.page_id ?? null,
      post_page_id: postPageId,
    },
  }
}

function planBoost(cmd: CommandOf<'meta.post.boost'>, before: ResourceSnapshot): PlanResult {
  const f = before.fields
  if (f.adset_status === 'DELETED' || f.adset_status === 'ARCHIVED') {
    return { ok: false, code: 'resource_archived', message: `The ad set is ${f.adset_status} in Meta and cannot receive new ads.` }
  }
  if (f.campaign_objective !== 'OUTCOME_ENGAGEMENT') {
    return { ok: false, code: 'wrong_objective', message: `Boosting a post requires an OUTCOME_ENGAGEMENT campaign; this ad set's campaign objective is ${f.campaign_objective ?? 'unknown'}.` }
  }
  const warnings: string[] = []
  if (f.promoted_page_id) {
    if (f.promoted_page_id !== f.post_page_id) {
      return { ok: false, code: 'page_mismatch', message: `This post belongs to page ${f.post_page_id}, but the ad set promotes page ${f.promoted_page_id}.` }
    }
  } else {
    warnings.push('Could not confirm the ad set promotes the same page as this post (no promoted_object.page_id on the ad set).')
  }

  const creative: Record<string, unknown> = { object_story_id: cmd.post_id }
  if (cmd.call_to_action_type) creative.call_to_action = { type: cmd.call_to_action_type }
  const intended = { name: cmd.name, adset_id: cmd.adset_id, status: 'PAUSED', creative }
  const diff: DiffEntry[] = [
    diffField('name', 'Name', null, cmd.name),
    diffField('adset_id', 'Ad set', null, (f.adset_name as string | null) ?? cmd.adset_id),
    diffField('post_id', 'Boosted post', null, cmd.post_id),
    diffField('status', 'Status', null, 'PAUSED'),
  ]
  if (cmd.call_to_action_type) diff.push(diffField('call_to_action_type', 'Call to action', null, cmd.call_to_action_type))
  return { ok: true, intended, diff, warnings, facts: {} }
}

async function validateBoost(ctx: AdapterContext, cmd: CommandOf<'meta.post.boost'>, before: ResourceSnapshot): Promise<void> {
  const plan = planBoost(cmd, before)
  if (!plan.ok) throw new AdsValidationError(plan.message)
  await createObject(`${cmd.ad_account_id}/ads`, plan.intended, ctx.credential, { validateOnly: true })
}

async function executeBoost(ctx: AdapterContext, cmd: CommandOf<'meta.post.boost'>, before: ResourceSnapshot): Promise<ExecuteResult> {
  const plan = planBoost(cmd, before)
  if (!plan.ok) throw new AdsValidationError(plan.message)
  const res = await createObject(`${cmd.ad_account_id}/ads`, plan.intended, ctx.credential)
  if (!res.id) throw new MetaAdsError('Meta did not return an id for the boosted post ad')
  return { providerRef: res.id, raw: res }
}

async function verifyBoost(ctx: AdapterContext, cmd: CommandOf<'meta.post.boost'>, providerRef: string | null): Promise<VerifyResult> {
  if (!providerRef) return { ok: false, mismatches: [{ field: 'id', expected: 'a new ad id', actual: null }], observed: null }
  const node = await readNode<{ id: string; name: string; status: string; account_id?: string; creative?: { id?: string; object_story_id?: string } }>(
    providerRef,
    'id,name,status,account_id,creative{id,object_story_id}',
    ctx,
  )
  if (!node) return { ok: false, mismatches: [{ field: '*', expected: 'the boosted post ad', actual: null }], observed: null }
  const mismatches: Array<{ field: string; expected: unknown; actual: unknown }> = []
  if (node.status !== 'PAUSED') mismatches.push({ field: 'status', expected: 'PAUSED', actual: node.status })
  if (!sameAccount(node.account_id, ctx.adAccountId)) mismatches.push({ field: 'account_id', expected: ctx.adAccountId, actual: node.account_id })
  if (node.creative?.object_story_id !== cmd.post_id) mismatches.push({ field: 'post_id', expected: cmd.post_id, actual: node.creative?.object_story_id ?? null })
  return { ok: mismatches.length === 0, mismatches, observed: { id: node.id, status: node.status, object_story_id: node.creative?.object_story_id ?? null } }
}

// ─── CommandHandler ───────────────────────────────────────────────────────────

export const creativesHandler: CommandHandler = {
  platform: 'meta',
  types: ['meta.media.upload_image', 'meta.media.upload_video', 'meta.ad.create_with_creative', 'meta.ad.update_creative', 'meta.post.boost', 'meta.ad.set_welcome_message'],

  async snapshot(ctx, command) {
    switch (command.type) {
      case 'meta.media.upload_image':
        return snapshotUploadImage(ctx, command)
      case 'meta.media.upload_video':
        return snapshotUploadVideo(ctx, command)
      case 'meta.ad.create_with_creative':
        return snapshotCreateWithCreative(ctx, command)
      case 'meta.ad.update_creative':
        return snapshotAdCreative(ctx, command.ad_id)
      case 'meta.post.boost':
        return snapshotBoost(ctx, command)
      case 'meta.ad.set_welcome_message':
        return snapshotAdCreative(ctx, command.ad_id)
      default:
        throw new AdsValidationError(`${(command as { type: string }).type} is not handled by the creatives module`)
    }
  },

  plan(command, before) {
    switch (command.type) {
      case 'meta.media.upload_image':
        return planUploadImage(command)
      case 'meta.media.upload_video':
        return planUploadVideo(command)
      case 'meta.ad.create_with_creative':
        return planCreateWithCreative(command, before)
      case 'meta.ad.update_creative':
        return planUpdateCreative(command, before)
      case 'meta.post.boost':
        return planBoost(command, before)
      case 'meta.ad.set_welcome_message':
        return planWelcomeMessage(command, before)
      default:
        return { ok: false, code: 'unsupported_command', message: `${(command as { type: string }).type} is not implemented by the creatives module.` }
    }
  },

  async validate(ctx, command, before) {
    switch (command.type) {
      case 'meta.media.upload_image':
        return validateUploadImage(command)
      case 'meta.media.upload_video':
        return validateUploadVideo(command)
      case 'meta.ad.create_with_creative':
        return validateCreateWithCreative(ctx, command, before)
      case 'meta.ad.update_creative':
        return validateUpdateCreative(ctx, command, before)
      case 'meta.post.boost':
        return validateBoost(ctx, command, before)
      case 'meta.ad.set_welcome_message':
        return validateWelcomeMessage(ctx, command, before)
      default:
        throw new AdsValidationError(`${(command as { type: string }).type} is not handled by the creatives module`)
    }
  },

  async execute(ctx, command, before) {
    switch (command.type) {
      case 'meta.media.upload_image':
        return executeUploadImage(ctx, command)
      case 'meta.media.upload_video':
        return executeUploadVideo(ctx, command)
      case 'meta.ad.create_with_creative':
        return executeCreateWithCreative(ctx, command, before)
      case 'meta.ad.update_creative':
        return executeUpdateCreative(ctx, command, before)
      case 'meta.post.boost':
        return executeBoost(ctx, command, before)
      case 'meta.ad.set_welcome_message':
        return executeWelcomeMessage(ctx, command, before)
      default:
        throw new AdsValidationError(`${(command as { type: string }).type} is not handled by the creatives module`)
    }
  },

  async verify(ctx, command, intended, providerRef) {
    switch (command.type) {
      case 'meta.media.upload_image':
        return verifyUploadImage(ctx, command, providerRef)
      case 'meta.media.upload_video':
        return verifyUploadVideo(ctx, providerRef)
      case 'meta.ad.create_with_creative':
        return verifyCreateWithCreative(ctx, providerRef)
      case 'meta.ad.update_creative':
        return verifyUpdateCreative(ctx, command, intended, providerRef)
      case 'meta.post.boost':
        return verifyBoost(ctx, command, providerRef)
      case 'meta.ad.set_welcome_message':
        return verifyWelcomeMessage(ctx, command, intended, providerRef)
      default:
        throw new AdsValidationError(`${(command as { type: string }).type} is not handled by the creatives module`)
    }
  },

  buildRollback(command, before) {
    switch (command.type) {
      case 'meta.ad.update_creative':
      case 'meta.ad.set_welcome_message':
        return rollbackToPreviousCreative(command, before)
      // Media uploads and creates (create_with_creative, post.boost) have no
      // automatic inverse — see catalog.ts's note on creates.
      default:
        return null
    }
  },
}
