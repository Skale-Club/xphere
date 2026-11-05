// src/lib/storage/retention.ts
//
// Storage retention job (docs/storage/r2-migration-plan.md, sections 3, 4 and 7).
//
// Two independent sweeps, each SIMULATION BY DEFAULT:
//
//   1. Screenshots: `website_analyses` rows whose screenshot URLs are set and
//      older than 1 day lose the two objects in `website-screenshots` and then
//      have the two URL columns cleared. The ROWS are never deleted: Xmail
//      outreach reads services / raw_evidence / outreach_insights from them
//      (src/lib/xmail/website-insights.ts), and the analyzer cron uses their
//      history for retry decisions. `logo_url` is not touched.
//   2. Chat media: objects in `chat-media` referenced by messages older than the
//      org's retention are removed, then `media_expired_at` is merged into the
//      message metadata so the inbox shows a placeholder instead of a broken
//      player. The message text is kept.
//
// The database is MIXED during and after the R2 cut-over, so both sweeps know
// both backends. Chat media: a message may reference a Supabase public URL or an
// `/api/media/chat-media/<org>/...` path (R2); each object is removed through the
// backend its URL points at. Screenshots: the backend is decided per row from the
// stored URL (R2 public base vs anything else = Supabase), while the object path
// still comes from the row id alone. A failure on one backend never clears the
// rows that depend on it.
//
// A sweep only mutates when its env var is exactly 'true':
//   STORAGE_RETENTION_SCREENSHOTS_ENABLED  /  STORAGE_RETENTION_CHAT_ENABLED
// They are independent because they go live at different times. In simulation
// the same targets are selected and counted, only the writes are skipped.
//
// The endpoint is meant to run HOURLY until the backlog drains, and is cheap
// after that (one empty page per sweep). Each run is capped by row/message
// counts AND by a wall-clock budget (RUN_BUDGET_MS) so it answers well inside
// Cloudflare's 100s limit even with ~200ms per database call; a run that hits a
// cap reports `truncated: true` and the next run continues.
//
// All I/O goes through `RetentionStore` so the logic is testable with a fake;
// `createSupabaseRetentionStore` is the production adapter.

import type { SupabaseClient } from '@supabase/supabase-js'
import { MEDIA_ROUTE_PREFIX, parseMediaPath } from '@/lib/storage'

// ── Constants ───────────────────────────────────────────────────────────────

export const SCREENSHOT_BUCKET = 'website-screenshots'
export const CHAT_MEDIA_BUCKET = 'chat-media'

/** Screenshots are kept one day, long enough for the prospect sheet to be opened. */
export const SCREENSHOT_RETENTION_DAYS = 1

/** Chat media retention until a per-org value exists (plan section 4). */
export const DEFAULT_CHAT_MEDIA_RETENTION_DAYS = 30

// Per-run batch limits. A backlog drains over several hourly runs instead of one
// unbounded pass; every run is idempotent so a truncated run is safe to repeat.
export const SCREENSHOT_PAGE_SIZE = 100
export const MAX_SCREENSHOT_ROWS_PER_RUN = 300
export const CHAT_PAGE_SIZE = 200
export const MAX_CHAT_MESSAGES_PER_RUN = 1000
export const MAX_CHAT_OBJECTS_PER_RUN = 500

/**
 * Wall-clock budget for one whole run (both sweeps). The endpoint sits behind
 * Cloudflare, which kills a response at 100s, and each DB call is ~200ms away.
 * Checked between pages and between chat messages; on expiry the sweep stops
 * cleanly and reports `truncated: true`.
 */
export const RUN_BUDGET_MS = 60_000

export interface Budget {
  clock: () => number
  deadline: number
}
const NO_BUDGET: Budget = { clock: () => 0, deadline: Infinity }

const MAX_REPORTED_FAILURES = 20
const MAX_ERROR_LENGTH = 200

const DAY_MS = 24 * 60 * 60 * 1000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Chat paths are written by us from uuids, timestamps and sanitized file names.
// Anything outside this alphabet is not something our writers produce.
const SAFE_PATH_RE = /^[A-Za-z0-9._\-/]+$/

/**
 * Retention for an org's chat media. A constant today; written as an async
 * per-org lookup so `organizations.chat_media_retention_days` can replace it
 * later without touching the callers.
 */
export async function getChatMediaRetentionDays(orgId: string): Promise<number> {
  void orgId
  return DEFAULT_CHAT_MEDIA_RETENTION_DAYS
}

// ── Store interface ─────────────────────────────────────────────────────────

/** Where an object lives: Supabase Storage (legacy) or Cloudflare R2. */
export type StorageBackend = 'supabase' | 'r2'

export interface ScreenshotRow {
  id: string
  /** Stored URL of each variant, or null when the column is empty. */
  desktopUrl: string | null
  mobileUrl: string | null
}

/**
 * Optional R2 operations for the production store. Injected (instead of imported)
 * so this module stays testable with fakes; the cron route wires them to
 * `@/lib/storage`. Without them, any R2 removal fails loudly (nothing is cleared).
 */
export interface R2Ops {
  isEnabled(bucket: string): boolean
  remove(bucket: string, paths: string[]): Promise<{ error: { message: string } | null }>
  list(
    bucket: string,
    dir: string,
    limit: number,
  ): Promise<{ data: Array<{ name: string; size: number }> | null; error: { message: string } | null }>
}

export interface ChatMessageRow {
  id: string
  org_id: string
  created_at: string
  metadata: Record<string, unknown> | null
}

export interface RemoveResult {
  error: string | null
}

export interface RetentionStore {
  /** Screenshot rows older than `cutoffIso`, ordered by id, after the cursor. */
  listScreenshotRows(args: { cutoffIso: string; afterId: string | null; limit: number }): Promise<ScreenshotRow[]>
  /** Clears both screenshot URL columns of all these rows in ONE call. */
  clearScreenshotUrls(analysisIds: string[]): Promise<{ error: string | null }>
  /** Exact count of screenshot rows eligible right now (no cap); null when unknown. */
  countEligibleScreenshots(args: { cutoffIso: string }): Promise<number | null>

  /**
   * Messages older than `cutoffIso` that carry chat-media URLs and no
   * `media_expired_at`, ordered by (created_at, id), after the cursor.
   */
  listChatMessages(args: {
    cutoffIso: string
    after: { createdAt: string; id: string } | null
    limit: number
  }): Promise<ChatMessageRow[]>
  /** Exact count of chat messages eligible by age/media/not-flagged (no cap); null when unknown. */
  countEligibleChatMessages(args: { cutoffIso: string }): Promise<number | null>
  /** True when a message of `orgId` created at/after `sinceIso` references `path`. */
  isReferencedSince(args: { orgId: string; path: string; sinceIso: string }): Promise<boolean>
  /** Merges `media_expired_at` into the message metadata, keeping every other key. */
  markMediaExpired(args: { messageId: string; expiredAtIso: string }): Promise<{ error: string | null }>

  /**
   * Removes exactly these object paths from the given backend (default Supabase).
   * A path that does not exist is not an error. An R2 removal with R2 not
   * enabled is an error, never a silent success.
   */
  removeObjects(bucket: string, paths: string[], backend?: StorageBackend): Promise<RemoveResult>
  /** Best-effort sizes in bytes; a missing entry means unknown. Never throws. */
  statObjects(bucket: string, paths: string[], backend?: StorageBackend): Promise<Map<string, number>>
}

// ── Pure helpers ────────────────────────────────────────────────────────────

/** Spreads `media_expired_at` over the existing metadata without dropping keys. */
export function mergeExpiredMetadata(
  metadata: Record<string, unknown> | null | undefined,
  expiredAtIso: string,
): Record<string, unknown> {
  return { ...(metadata ?? {}), media_expired_at: expiredAtIso }
}

/** True once a message has been flagged; such a message is never reprocessed. */
export function isMediaExpired(metadata: Record<string, unknown> | null | undefined): boolean {
  const v = metadata?.media_expired_at
  return typeof v === 'string' && v.length > 0
}

/** Path of the object a screenshot variant lives at, derived from the row id only. */
export function screenshotObjectPath(analysisId: string, variant: 'desktop' | 'mobile'): string {
  return `${analysisId}/${variant}.jpg`
}

/** Public URL prefix of this project's chat-media bucket, or null when unconfigured. */
export function chatMediaPublicPrefix(supabaseUrl: string | undefined): string | null {
  if (!supabaseUrl) return null
  return `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/${CHAT_MEDIA_BUCKET}/`
}

/**
 * Object path for a URL that points into THIS project's chat-media bucket.
 * Returns null for any other URL (Zernio proxy, original_url, other hosts),
 * for traversal attempts, and for characters our writers never produce.
 */
export function chatMediaPathFromUrl(url: unknown, publicPrefix: string): string | null {
  if (typeof url !== 'string' || !url.startsWith(publicPrefix)) return null
  let rest = url.slice(publicPrefix.length).split(/[?#]/)[0]
  try {
    rest = decodeURIComponent(rest)
  } catch {
    return null
  }
  if (!rest || !SAFE_PATH_RE.test(rest)) return null
  const segments = rest.split('/')
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return null
  return rest
}

export interface ObjectRef {
  path: string
  backend: StorageBackend
}

/**
 * Object path for an app-relative `/api/media/chat-media/<path>` address (the form
 * stored once chat-media is on R2). Only the relative form counts: a stored
 * absolute URL on some other host is not ours. Same alphabet and traversal rules
 * as the Supabase form.
 */
export function chatMediaPathFromMediaUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url.startsWith(MEDIA_ROUTE_PREFIX)) return null
  const parsed = parseMediaPath(url.split(/[?#]/)[0])
  if (!parsed || parsed.bucket !== CHAT_MEDIA_BUCKET) return null
  if (!SAFE_PATH_RE.test(parsed.path)) return null
  return parsed.path
}

/** Which backend an `url` points at, with its object path, or null when it is not ours. */
export function chatMediaRefFromUrl(url: unknown, publicPrefix: string): ObjectRef | null {
  const supa = chatMediaPathFromUrl(url, publicPrefix)
  if (supa) return { path: supa, backend: 'supabase' }
  const r2 = chatMediaPathFromMediaUrl(url)
  if (r2) return { path: r2, backend: 'r2' }
  return null
}

/**
 * Every chat-media object a message points at, with the backend each URL names.
 * The writers store `metadata.media: [{ url, thumbnail_url?, ... }]`; only `url`
 * and `thumbnail_url` are read, and only when they are ours.
 */
export function extractChatMediaRefs(
  metadata: Record<string, unknown> | null | undefined,
  publicPrefix: string,
): ObjectRef[] {
  const media = metadata?.media
  if (!Array.isArray(media)) return []
  const out = new Map<string, ObjectRef>()
  for (const item of media) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    for (const key of ['url', 'thumbnail_url']) {
      const ref = chatMediaRefFromUrl(rec[key], publicPrefix)
      if (ref) out.set(`${ref.backend}:${ref.path}`, ref)
    }
  }
  return [...out.values()]
}

/** Distinct object paths of a message, whichever backend holds them. */
export function extractChatMediaPaths(
  metadata: Record<string, unknown> | null | undefined,
  publicPrefix: string,
): string[] {
  return [...new Set(extractChatMediaRefs(metadata, publicPrefix).map((r) => r.path))]
}

/**
 * Backend a stored screenshot URL belongs to: R2 when it sits under the R2 public
 * base, Supabase otherwise (the only store that existed before the cut-over).
 */
export function screenshotBackendFromUrl(url: string, r2PublicBase: string | null | undefined): StorageBackend {
  const base = r2PublicBase?.replace(/\/+$/, '')
  return base && url.startsWith(`${base}/`) ? 'r2' : 'supabase'
}

function errText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.slice(0, MAX_ERROR_LENGTH)
}

function sumBytes(sizes: Map<string, number>, paths: string[]): { bytes: number; unknown: number } {
  let bytes = 0
  let unknown = 0
  for (const p of paths) {
    const s = sizes.get(p)
    if (typeof s === 'number') bytes += s
    else unknown += 1
  }
  return { bytes, unknown }
}

// ── Report types ────────────────────────────────────────────────────────────

export interface Failure {
  /** Analysis id or message id. Never customer content. */
  id: string
  error: string
}

export interface ScreenshotReport {
  mode: 'simulation' | 'live'
  rows: number
  /** All rows eligible right now, beyond the per-run cap; null when the count failed. */
  totalEligibleRows: number | null
  objects: number
  /** Simulation only: sizes come from the first page alone, so `bytes` is a sample. */
  bytes: number
  bytesSampled: boolean
  bytesUnknownObjects: number
  removedObjects: number
  clearedRows: number
  failedRows: number
  failures: Failure[]
  truncated: boolean
}

export interface ChatOrgReport {
  messages: number
  objects: number
  bytes: number
  removedObjects: number
  flaggedMessages: number
  skippedCrossOrg: number
  skippedReferenced: number
  failedMessages: number
}

export interface ChatReport {
  mode: 'simulation' | 'live'
  scannedMessages: number
  /** All messages eligible by age/media/not-flagged right now; null when the count failed. */
  totalEligibleMessages: number | null
  messages: number
  objects: number
  bytes: number
  bytesUnknownObjects: number
  removedObjects: number
  flaggedMessages: number
  /** Messages skipped because a path's first segment is not the message's org. */
  skippedCrossOrg: number
  /** Messages skipped because an object is still referenced by a newer message. */
  skippedReferenced: number
  /** Objects behind the skipped-referenced messages. */
  skippedReferencedObjects: number
  failedMessages: number
  failures: Failure[]
  truncated: boolean
  orgs: Record<string, ChatOrgReport>
}

export interface RetentionReport {
  ranAt: string
  screenshots: ScreenshotReport
  chat: ChatReport
}

export interface RunOptions {
  store: RetentionStore
  now?: Date
  /** Environment to read the enable flags from. Defaults to process.env. */
  env?: Record<string, string | undefined>
  /** `NEXT_PUBLIC_SUPABASE_URL`, used to recognise this project's chat-media URLs. */
  supabaseUrl?: string
  /** Monotonic-ish millisecond clock for the run budget. Injectable for tests. */
  clock?: () => number
}

// ── Screenshots ─────────────────────────────────────────────────────────────

export async function runScreenshotRetention(
  store: RetentionStore,
  now: Date,
  live: boolean,
  budget: Budget = NO_BUDGET,
  r2PublicBase: string | null = null,
): Promise<ScreenshotReport> {
  const report: ScreenshotReport = {
    mode: live ? 'live' : 'simulation',
    rows: 0,
    totalEligibleRows: null,
    objects: 0,
    bytes: 0,
    bytesSampled: false,
    bytesUnknownObjects: 0,
    removedObjects: 0,
    clearedRows: 0,
    failedRows: 0,
    failures: [],
    truncated: false,
  }
  const cutoffIso = new Date(now.getTime() - SCREENSHOT_RETENTION_DAYS * DAY_MS).toISOString()
  // The per-run cap hides the real size of the backlog, so count it separately.
  report.totalEligibleRows = await store.countEligibleScreenshots({ cutoffIso }).catch(() => null)

  let afterId: string | null = null
  let sampled = false

  while (report.rows < MAX_SCREENSHOT_ROWS_PER_RUN) {
    if (budget.clock() >= budget.deadline) {
      report.truncated = true
      break
    }
    const limit = Math.min(SCREENSHOT_PAGE_SIZE, MAX_SCREENSHOT_ROWS_PER_RUN - report.rows)
    const page = await store.listScreenshotRows({ cutoffIso, afterId, limit })
    if (page.length === 0) break

    // Per row: which backends hold its objects (decided by each stored URL).
    const rows: Array<{ id: string; refs: ObjectRef[] }> = []
    for (const row of page) {
      afterId = row.id
      // The path comes from the row id alone; a malformed id is skipped, never guessed at.
      if (!UUID_RE.test(row.id)) continue
      const refs: ObjectRef[] = []
      if (row.desktopUrl) {
        refs.push({ path: screenshotObjectPath(row.id, 'desktop'), backend: screenshotBackendFromUrl(row.desktopUrl, r2PublicBase) })
      }
      if (row.mobileUrl) {
        refs.push({ path: screenshotObjectPath(row.id, 'mobile'), backend: screenshotBackendFromUrl(row.mobileUrl, r2PublicBase) })
      }
      if (refs.length === 0) continue
      rows.push({ id: row.id, refs })
    }
    const ids = rows.map((r) => r.id)
    const paths = rows.flatMap((r) => r.refs.map((x) => x.path))
    // Group by backend, keeping row order so batches (and tests) stay deterministic.
    const byBackend = new Map<StorageBackend, string[]>()
    for (const r of rows) {
      for (const x of r.refs) byBackend.set(x.backend, [...(byBackend.get(x.backend) ?? []), x.path])
    }

    report.rows += ids.length
    report.objects += paths.length

    if (ids.length > 0) {
      if (!live) {
        // Simulation stats at most the first page: sizes are informational and
        // every stat is a round trip, so `bytes` is a sample (bytesSampled).
        if (!sampled) {
          sampled = true
          report.bytesSampled = true
          for (const [backend, backendPaths] of byBackend) {
            try {
              const sizes = await store.statObjects(SCREENSHOT_BUCKET, backendPaths, backend)
              const { bytes, unknown } = sumBytes(sizes, backendPaths)
              report.bytes += bytes
              report.bytesUnknownObjects += unknown
            } catch {
              report.bytesUnknownObjects += backendPaths.length
            }
          }
        }
      } else {
        // Live: ONE removal per backend for the whole page, then ONE clear for
        // the rows whose every object was removed. A row is cleared only after
        // ALL its backends succeeded; a failed backend leaves its rows (and their
        // URLs) untouched, stops the sweep, and the next run retries them.
        const failedBackends = new Set<StorageBackend>()
        let failure: string | null = null
        for (const [backend, backendPaths] of byBackend) {
          try {
            const removed = await store.removeObjects(SCREENSHOT_BUCKET, backendPaths, backend)
            if (removed.error) {
              failedBackends.add(backend)
              failure ??= `remove batch of ${backendPaths.length} (${backend}): ${removed.error}`
            } else {
              report.removedObjects += backendPaths.length
            }
          } catch (err) {
            failedBackends.add(backend)
            failure ??= `remove batch of ${backendPaths.length} (${backend}): ${errText(err)}`
          }
        }
        const okRows = rows.filter((r) => r.refs.every((x) => !failedBackends.has(x.backend)))
        const failedRows = rows.filter((r) => !okRows.includes(r))
        let failureId = failedRows[0]?.id ?? ids[0]

        if (okRows.length > 0) {
          try {
            const cleared = await store.clearScreenshotUrls(okRows.map((r) => r.id))
            if (cleared.error) {
              failure ??= `clear batch of ${okRows.length}: ${cleared.error}`
              failureId = okRows[0].id
              report.failedRows += okRows.length
            } else {
              report.clearedRows += okRows.length
            }
          } catch (err) {
            failure ??= `clear batch of ${okRows.length}: ${errText(err)}`
            failureId = okRows[0].id
            report.failedRows += okRows.length
          }
        }
        report.failedRows += failedRows.length
        if (failure) {
          if (report.failures.length < MAX_REPORTED_FAILURES) {
            report.failures.push({ id: failureId, error: failure.slice(0, MAX_ERROR_LENGTH) })
          }
          report.truncated = true
          break
        }
      }
    }

    if (page.length < limit) break
  }

  if (report.rows >= MAX_SCREENSHOT_ROWS_PER_RUN) report.truncated = true
  return report
}

// ── Chat media ──────────────────────────────────────────────────────────────

function emptyOrg(): ChatOrgReport {
  return {
    messages: 0,
    objects: 0,
    bytes: 0,
    removedObjects: 0,
    flaggedMessages: 0,
    skippedCrossOrg: 0,
    skippedReferenced: 0,
    failedMessages: 0,
  }
}

export async function runChatRetention(
  store: RetentionStore,
  now: Date,
  live: boolean,
  supabaseUrl: string | undefined,
  budget: Budget = NO_BUDGET,
): Promise<ChatReport> {
  const report: ChatReport = {
    mode: live ? 'live' : 'simulation',
    scannedMessages: 0,
    totalEligibleMessages: null,
    messages: 0,
    objects: 0,
    bytes: 0,
    bytesUnknownObjects: 0,
    removedObjects: 0,
    flaggedMessages: 0,
    skippedCrossOrg: 0,
    skippedReferenced: 0,
    skippedReferencedObjects: 0,
    failedMessages: 0,
    failures: [],
    truncated: false,
    orgs: {},
  }
  const prefix = chatMediaPublicPrefix(supabaseUrl)
  if (!prefix) {
    report.failures.push({ id: 'config', error: 'NEXT_PUBLIC_SUPABASE_URL not set' })
    return report
  }

  // The scan window is the shortest retention any org can have; each message is
  // then checked against its own org's cutoff. Today there is one value.
  const scanCutoffIso = new Date(now.getTime() - DEFAULT_CHAT_MEDIA_RETENTION_DAYS * DAY_MS).toISOString()
  report.totalEligibleMessages = await store.countEligibleChatMessages({ cutoffIso: scanCutoffIso }).catch(() => null)
  const orgCutoff = new Map<string, string>()
  const cutoffFor = async (orgId: string): Promise<string> => {
    let c = orgCutoff.get(orgId)
    if (!c) {
      const days = await getChatMediaRetentionDays(orgId)
      c = new Date(now.getTime() - days * DAY_MS).toISOString()
      orgCutoff.set(orgId, c)
    }
    return c
  }

  let after: { createdAt: string; id: string } | null = null
  let done = false

  while (!done && report.scannedMessages < MAX_CHAT_MESSAGES_PER_RUN) {
    if (budget.clock() >= budget.deadline) {
      report.truncated = true
      break
    }
    const limit = Math.min(CHAT_PAGE_SIZE, MAX_CHAT_MESSAGES_PER_RUN - report.scannedMessages)
    const page = await store.listChatMessages({ cutoffIso: scanCutoffIso, after, limit })
    if (page.length === 0) break

    for (const msg of page) {
      if (budget.clock() >= budget.deadline) {
        report.truncated = true
        done = true
        break
      }
      after = { createdAt: msg.created_at, id: msg.id }
      report.scannedMessages += 1
      if (report.objects >= MAX_CHAT_OBJECTS_PER_RUN) {
        report.truncated = true
        done = true
        break
      }
      const org = (report.orgs[msg.org_id] ??= emptyOrg())

      try {
        // An already-flagged message is never reprocessed (the listing excludes
        // it too; this guards a stale page).
        if (isMediaExpired(msg.metadata)) continue

        const orgCut = await cutoffFor(msg.org_id)
        if (msg.created_at >= orgCut) continue

        const refs = extractChatMediaRefs(msg.metadata, prefix)
        if (refs.length === 0) continue
        // Distinct paths (the same object can be named in both URL forms).
        const paths = [...new Set(refs.map((r) => r.path))]

        // SAFETY: the first segment must be exactly this message's org. Anything
        // else is left alone and counted.
        if (paths.some((p) => p.split('/')[0] !== msg.org_id)) {
          report.skippedCrossOrg += 1
          org.skippedCrossOrg += 1
          continue
        }

        // An object still referenced by a message newer than the cutoff stays;
        // the whole message waits so its state stays consistent.
        let referenced = false
        for (const p of paths) {
          if (await store.isReferencedSince({ orgId: msg.org_id, path: p, sinceIso: orgCut })) {
            referenced = true
            break
          }
        }
        if (referenced) {
          report.skippedReferenced += 1
          report.skippedReferencedObjects += paths.length
          org.skippedReferenced += 1
          continue
        }

        report.messages += 1
        report.objects += refs.length
        org.messages += 1
        org.objects += refs.length

        // Each object is handled by the backend its URL points at.
        const byBackend = new Map<StorageBackend, string[]>()
        for (const r of refs) byBackend.set(r.backend, [...(byBackend.get(r.backend) ?? []), r.path])

        for (const [backend, backendPaths] of byBackend) {
          const sizes = await store.statObjects(CHAT_MEDIA_BUCKET, backendPaths, backend)
          const { bytes, unknown } = sumBytes(sizes, backendPaths)
          report.bytes += bytes
          report.bytesUnknownObjects += unknown
          org.bytes += bytes
        }

        if (!live) continue

        // Any failing backend aborts this message before it is flagged; the
        // backend that did succeed has nothing left to remove on the retry.
        for (const [backend, backendPaths] of byBackend) {
          const removed = await store.removeObjects(CHAT_MEDIA_BUCKET, backendPaths, backend)
          if (removed.error) throw new Error(`${backend}: ${removed.error}`)
          report.removedObjects += backendPaths.length
          org.removedObjects += backendPaths.length
        }

        // Flag only after the removal succeeded. If this write fails the next run
        // removes nothing new (idempotent) and flags the message then.
        const flagged = await store.markMediaExpired({ messageId: msg.id, expiredAtIso: now.toISOString() })
        if (flagged.error) throw new Error(flagged.error)
        report.flaggedMessages += 1
        org.flaggedMessages += 1
      } catch (err) {
        // One message or org failing never stops the others.
        report.failedMessages += 1
        org.failedMessages += 1
        if (report.failures.length < MAX_REPORTED_FAILURES) {
          report.failures.push({ id: msg.id, error: errText(err) })
        }
      }
    }

    if (page.length < limit) break
  }

  if (report.scannedMessages >= MAX_CHAT_MESSAGES_PER_RUN) report.truncated = true
  return report
}

// ── Entry point ─────────────────────────────────────────────────────────────

export async function runStorageRetention(opts: RunOptions): Promise<RetentionReport> {
  const now = opts.now ?? new Date()
  const env = opts.env ?? process.env
  const supabaseUrl = opts.supabaseUrl ?? env.NEXT_PUBLIC_SUPABASE_URL

  const clock = opts.clock ?? Date.now
  const budget: Budget = { clock, deadline: clock() + RUN_BUDGET_MS }

  const screenshotsLive = env.STORAGE_RETENTION_SCREENSHOTS_ENABLED === 'true'
  const chatLive = env.STORAGE_RETENTION_CHAT_ENABLED === 'true'

  // Independent sweeps: one throwing must not stop the other.
  const screenshots = await runScreenshotRetention(opts.store, now, screenshotsLive, budget, env.R2_PUBLIC_BASE_URL ?? null).catch(
    (err): ScreenshotReport => ({
      mode: screenshotsLive ? 'live' : 'simulation',
      rows: 0, totalEligibleRows: null, objects: 0, bytes: 0, bytesSampled: false, bytesUnknownObjects: 0, removedObjects: 0,
      clearedRows: 0, failedRows: 1, failures: [{ id: 'sweep', error: errText(err) }], truncated: false,
    }),
  )
  const chat = await runChatRetention(opts.store, now, chatLive, supabaseUrl, budget).catch(
    (err): ChatReport => ({
      mode: chatLive ? 'live' : 'simulation',
      scannedMessages: 0, totalEligibleMessages: null, messages: 0, objects: 0, bytes: 0, bytesUnknownObjects: 0, removedObjects: 0,
      flaggedMessages: 0, skippedCrossOrg: 0, skippedReferenced: 0, skippedReferencedObjects: 0,
      failedMessages: 1, failures: [{ id: 'sweep', error: errText(err) }], truncated: false, orgs: {},
    }),
  )

  const report: RetentionReport = { ranAt: now.toISOString(), screenshots, chat }
  // One summary line; ids and counts only, no customer content.
  console.log(
    `[storage-retention] screenshots=${report.screenshots.mode} rows=${report.screenshots.rows}/${report.screenshots.totalEligibleRows ?? '?'} ` +
      `objects=${report.screenshots.objects} bytes=${report.screenshots.bytes} removed=${report.screenshots.removedObjects} ` +
      `failed=${report.screenshots.failedRows} | chat=${report.chat.mode} messages=${report.chat.messages}/${report.chat.totalEligibleMessages ?? '?'} ` +
      `objects=${report.chat.objects} bytes=${report.chat.bytes} removed=${report.chat.removedObjects} ` +
      `flagged=${report.chat.flaggedMessages} skippedCrossOrg=${report.chat.skippedCrossOrg} ` +
      `skippedReferenced=${report.chat.skippedReferenced} failed=${report.chat.failedMessages}`,
  )
  return report
}

// ── Supabase adapter ────────────────────────────────────────────────────────

// A message carries chat media when its media JSON names either address form.
// PostgREST logic-tree values use `*` as the LIKE wildcard.
const CHAT_MEDIA_URL_FILTER =
  `metadata->>media.ilike.*/storage/v1/object/public/${CHAT_MEDIA_BUCKET}/*,` +
  `metadata->>media.ilike.*${MEDIA_ROUTE_PREFIX}${CHAT_MEDIA_BUCKET}/*`

/** Escapes LIKE wildcards; paths are already restricted to a safe alphabet. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`)
}

function dirAndName(path: string): { dir: string; name: string } {
  const i = path.lastIndexOf('/')
  return i < 0 ? { dir: '', name: path } : { dir: path.slice(0, i), name: path.slice(i + 1) }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createSupabaseRetentionStore(
  client: SupabaseClient<any, any, any>,
  deps: { r2?: R2Ops } = {},
): RetentionStore {
  const r2 = deps.r2
  return {
    async listScreenshotRows({ cutoffIso, afterId, limit }) {
      // Two chained or() calls: PostgREST ANDs repeated `or` params (postgrest-js
      // has no and() on the filter builder). Timestamps are double-quoted because
      // they contain reserved characters (":" "+" ".").
      let q = client
        .from('website_analyses')
        .select('id, screenshot_desktop_url, screenshot_mobile_url')
        // A URL is set ...
        .or('screenshot_desktop_url.not.is.null,screenshot_mobile_url.not.is.null')
        // ... AND the row is old (analyzed_at, falling back to created_at).
        .or(`analyzed_at.lt."${cutoffIso}",and(analyzed_at.is.null,created_at.lt."${cutoffIso}")`)
        .order('id', { ascending: true })
        .limit(limit)
      if (afterId) q = q.gt('id', afterId)
      const { data, error } = await q
      if (error) throw new Error(`list screenshots: ${error.message}`)
      return (data ?? []).map((r: { id: string; screenshot_desktop_url: string | null; screenshot_mobile_url: string | null }) => ({
        id: r.id,
        desktopUrl: r.screenshot_desktop_url || null,
        mobileUrl: r.screenshot_mobile_url || null,
      }))
    },

    async clearScreenshotUrls(analysisIds) {
      if (analysisIds.length === 0) return { error: null }
      const { error } = await client
        .from('website_analyses')
        .update({ screenshot_desktop_url: null, screenshot_mobile_url: null })
        .in('id', analysisIds)
      return { error: error ? error.message : null }
    },

    async countEligibleScreenshots({ cutoffIso }) {
      const { count, error } = await client
        .from('website_analyses')
        .select('id', { count: 'exact', head: true })
        .or('screenshot_desktop_url.not.is.null,screenshot_mobile_url.not.is.null')
        .or(`analyzed_at.lt."${cutoffIso}",and(analyzed_at.is.null,created_at.lt."${cutoffIso}")`)
      if (error) return null
      return count ?? null
    },

    async countEligibleChatMessages({ cutoffIso }) {
      const { count, error } = await client
        .from('conversation_messages')
        .select('id', { count: 'exact', head: true })
        .lt('created_at', cutoffIso)
        .or(CHAT_MEDIA_URL_FILTER)
        .is('metadata->>media_expired_at', null)
      if (error) return null
      return count ?? null
    },

    async listChatMessages({ cutoffIso, after, limit }) {
      let q = client
        .from('conversation_messages')
        .select('id, org_id, created_at, metadata')
        .lt('created_at', cutoffIso)
        .or(CHAT_MEDIA_URL_FILTER)
        .is('metadata->>media_expired_at', null)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(limit)
      if (after) {
        q = q.or(`created_at.gt."${after.createdAt}",and(created_at.eq."${after.createdAt}",id.gt.${after.id})`)
      }
      const { data, error } = await q
      if (error) throw new Error(`list messages: ${error.message}`)
      return (data ?? []) as ChatMessageRow[]
    },

    async isReferencedSince({ orgId, path, sinceIso }) {
      const { count, error } = await client
        .from('conversation_messages')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .gte('created_at', sinceIso)
        // "/chat-media/<path>" is a substring of BOTH address forms (the Supabase
        // public URL and /api/media/chat-media/<path>), because the safe path
        // alphabet is never percent-encoded. A reference in either form counts.
        .ilike('metadata->>media', `%/${CHAT_MEDIA_BUCKET}/${escapeLike(path)}%`)
      // On doubt, treat as referenced: keeping a file is always the safe side.
      if (error) return true
      return (count ?? 0) > 0
    },

    async markMediaExpired({ messageId, expiredAtIso }) {
      // Re-read right before writing so keys added since the scan are preserved.
      const { data, error: readErr } = await client
        .from('conversation_messages')
        .select('metadata')
        .eq('id', messageId)
        .maybeSingle()
      if (readErr) return { error: readErr.message }
      if (!data) return { error: null }
      const { error } = await client
        .from('conversation_messages')
        .update({ metadata: mergeExpiredMetadata(data.metadata as Record<string, unknown> | null, expiredAtIso) })
        .eq('id', messageId)
      return { error: error ? error.message : null }
    },

    async removeObjects(bucket, paths, backend = 'supabase') {
      if (backend === 'r2') {
        // Never fall back to Supabase for an R2 URL: removing from the wrong store
        // would "succeed" and the row would be cleared with the object still there.
        if (!r2) return { error: 'R2 operations are not wired into this store' }
        if (!r2.isEnabled(bucket)) return { error: `R2 is not enabled for bucket ${bucket}` }
        const { error } = await r2.remove(bucket, paths)
        return { error: error ? error.message : null }
      }
      const { error } = await client.storage.from(bucket).remove(paths)
      return { error: error ? error.message : null }
    },

    async statObjects(bucket, paths, backend = 'supabase') {
      const sizes = new Map<string, number>()
      if (backend === 'r2' && (!r2 || !r2.isEnabled(bucket))) return sizes
      const byDir = new Map<string, string[]>()
      for (const p of paths) {
        const { dir } = dirAndName(p)
        byDir.set(dir, [...(byDir.get(dir) ?? []), p])
      }
      for (const [dir, dirPaths] of byDir) {
        try {
          const items: Array<{ name: string; size: unknown }> =
            backend === 'r2'
              ? ((await r2!.list(bucket, dir, 1000)).data ?? []).map((o) => ({ name: o.name, size: o.size }))
              : ((await client.storage.from(bucket).list(dir, { limit: 1000 })).data ?? []).map((o) => ({
                  name: o.name,
                  size: (o.metadata as { size?: unknown } | null)?.size,
                }))
          for (const item of items) {
            const full = dir ? `${dir}/${item.name}` : item.name
            if (dirPaths.includes(full) && typeof item.size === 'number') sizes.set(full, item.size)
          }
        } catch {
          // Size is informational; unknown stays unknown.
        }
      }
      return sizes
    },
  }
}
