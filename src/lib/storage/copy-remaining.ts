// src/lib/storage/copy-remaining.ts
//
// Pure and injectable parts of the phase 5 copy (docs/storage/r2-migration-plan.md,
// section 7): which URLs are in scope, where each object goes, how references are
// rewritten with compare-and-set, and what the two manifests contain. The I/O
// lives in scripts/r2-copy-remaining.ts. Nothing here talks to a database or a
// bucket directly; the script injects `CopyIo` and `ColumnStore`.
//
// Hard rules, enforced by the shape of the interfaces:
//   - `CopyIo` has no way to delete from the SOURCE (Supabase). The copy cannot
//     remove anything there because the capability does not exist.
//   - A reference is rewritten only after its object is verified in R2.
//   - Every write is compare-and-set: it applies only while the column still
//     holds the value that was read, so a concurrent edit is never overwritten.

import { createHash } from 'node:crypto'
import { DEFAULT_CHAT_MEDIA_RETENTION_DAYS } from '@/lib/storage/retention'
import { assertSafePath, mediaPath, parseMediaPath, PUBLIC_BUCKETS } from '@/lib/storage'
import { stripTrailingSlashes } from './strip-slashes'

// ── Scope ───────────────────────────────────────────────────────────────────

/** Buckets this script copies. website-screenshots is retention's job and is skipped entirely. */
export const COPY_BUCKETS = ['branding', 'avatars', 'email-assets', 'chat-media'] as const
export type CopyBucket = (typeof COPY_BUCKETS)[number]

export const SCREENSHOT_BUCKET = 'website-screenshots'

/** The only buckets whose objects a plain (non-message) column may point at. */
const STATIC_BUCKETS: readonly CopyBucket[] = ['branding', 'avatars', 'email-assets']

export type ColumnKind = 'url' | 'url-array' | 'message-media'

export interface RefColumn {
  table: string
  column: string
  kind: ColumnKind
}

/** Every column that may hold one of our storage URLs (plan section 5 and the task list). */
export const REFERENCE_COLUMNS: readonly RefColumn[] = [
  { table: 'accounts', column: 'avatar_url', kind: 'url' },
  { table: 'contacts', column: 'avatar_url', kind: 'url' },
  { table: 'conversation_messages', column: 'metadata', kind: 'message-media' },
  { table: 'folders', column: 'icon', kind: 'url' },
  { table: 'landing_config', column: 'cta_image_url', kind: 'url' },
  { table: 'landing_config', column: 'scroll_images', kind: 'url-array' },
  { table: 'organizations', column: 'widget_avatar_url', kind: 'url' },
  { table: 'organizations', column: 'logo_url', kind: 'url' },
  { table: 'seo_config', column: 'og_image_url', kind: 'url' },
  { table: 'seo_config', column: 'favicon_url', kind: 'url' },
  // Filled by the website analyzer from the prospect's own site, so it normally
  // holds third-party URLs. Whatever bucket a value names is reported, never assumed.
  { table: 'website_analyses', column: 'logo_url', kind: 'url' },
]

export interface UrlContext {
  /** NEXT_PUBLIC_SUPABASE_URL: only THIS project's public URLs are ours. */
  supabaseUrl: string
  /** R2_PUBLIC_BASE_URL, to recognise rows that were already migrated. */
  r2PublicBase: string | null
}

export type SkipReason =
  | 'screenshots' // website-screenshots: retention handles it
  | 'out-of-scope-bucket' // one of our buckets, but not one this column may point at
  | 'external' // another host, or another Supabase project
  | 'not-url' // empty or not an http(s) / app URL (an emoji icon, a name)
  | 'unsafe-path' // traversal or control characters

export type Classified =
  | { kind: 'copy'; bucket: CopyBucket; path: string; suffix: string }
  | { kind: 'already-r2' }
  | { kind: 'skip'; reason: SkipReason; bucket?: string }

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/')

/** The project's public object URL split into bucket, path and the ?query/#hash tail. */
export function parseSupabasePublicUrl(
  url: string,
  supabaseUrl: string,
): { bucket: string; path: string; suffix: string } | null {
  const prefix = `${stripTrailingSlashes(supabaseUrl)}/storage/v1/object/public/`
  if (!url.startsWith(prefix)) return null
  const rest = url.slice(prefix.length)
  const cut = rest.search(/[?#]/)
  const clean = cut < 0 ? rest : rest.slice(0, cut)
  const suffix = cut < 0 ? '' : rest.slice(cut)
  const slash = clean.indexOf('/')
  if (slash <= 0) return null
  const bucket = clean.slice(0, slash)
  try {
    const path = clean.slice(slash + 1).split('/').map(decodeURIComponent).join('/')
    return { bucket, path, suffix }
  } catch {
    return null
  }
}

/**
 * What to do with one stored URL. `allowed` is the buckets the column may point
 * at, so a plain column never pulls chat media in and a message never pulls
 * branding in.
 */
export function classifyUrl(url: unknown, ctx: UrlContext, allowed: readonly CopyBucket[]): Classified {
  if (typeof url !== 'string' || url.trim() === '') return { kind: 'skip', reason: 'not-url' }
  if (ctx.r2PublicBase && url.startsWith(`${stripTrailingSlashes(ctx.r2PublicBase)}/`)) return { kind: 'already-r2' }
  if (url.startsWith('/api/media/')) {
    return parseMediaPath(url.split(/[?#]/)[0]) ? { kind: 'already-r2' } : { kind: 'skip', reason: 'not-url' }
  }
  if (!/^https?:\/\//i.test(url)) return { kind: 'skip', reason: 'not-url' }

  const parsed = parseSupabasePublicUrl(url, ctx.supabaseUrl)
  if (!parsed) return { kind: 'skip', reason: 'external' }
  if (parsed.bucket === SCREENSHOT_BUCKET) return { kind: 'skip', reason: 'screenshots', bucket: parsed.bucket }
  if (!(allowed as readonly string[]).includes(parsed.bucket)) {
    return { kind: 'skip', reason: 'out-of-scope-bucket', bucket: parsed.bucket }
  }
  try {
    assertSafePath(parsed.path)
  } catch {
    return { kind: 'skip', reason: 'unsafe-path', bucket: parsed.bucket }
  }
  return { kind: 'copy', bucket: parsed.bucket as CopyBucket, path: parsed.path, suffix: parsed.suffix }
}

/** Allowed buckets for a column kind. */
export function allowedBucketsFor(kind: ColumnKind): readonly CopyBucket[] {
  return kind === 'message-media' ? ['chat-media'] : STATIC_BUCKETS
}

/**
 * The address a reference gets after the move: R2 public URL for public buckets
 * (the same shape `storage.publicUrl` produces), the session-gated /api/media
 * path for chat-media. The ?query tail is preserved.
 */
export function newUrlFor(bucket: CopyBucket, path: string, suffix: string, ctx: UrlContext): string {
  if (bucket === 'chat-media') return `${mediaPath(bucket, path)}${suffix}`
  if (!ctx.r2PublicBase) throw new Error('R2_PUBLIC_BASE_URL is required to map a public URL')
  return `${stripTrailingSlashes(ctx.r2PublicBase)}/${bucket}/${encodePath(path)}${suffix}`
}

export function isPublicCopyBucket(bucket: CopyBucket): boolean {
  return (PUBLIC_BUCKETS as readonly string[]).includes(bucket)
}

// ── Messages in scope ───────────────────────────────────────────────────────

export interface MessageLike {
  id: string
  org_id: string
  created_at: string
  metadata: Record<string, unknown> | null
}

/** Within retention and not flagged `media_expired_at`. Older ones are retention's to delete, not ours to copy. */
export function messageInScope(
  msg: Pick<MessageLike, 'created_at' | 'metadata'>,
  now: Date,
  retentionDays: number = DEFAULT_CHAT_MEDIA_RETENTION_DAYS,
): boolean {
  const flagged = msg.metadata?.media_expired_at
  if (typeof flagged === 'string' && flagged.length > 0) return false
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000
  const created = Date.parse(msg.created_at)
  return Number.isFinite(created) && created >= cutoff
}

// ── Reading and swapping URLs inside a column value ─────────────────────────

const MESSAGE_URL_KEYS = ['url', 'thumbnail_url'] as const

/** Every URL string held by a column value, in order, with duplicates. */
export function collectUrls(kind: ColumnKind, value: unknown): string[] {
  if (kind === 'url') return typeof value === 'string' ? [value] : []
  if (kind === 'url-array') return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  const media = (value as { media?: unknown } | null)?.media
  if (!Array.isArray(media)) return []
  const out: string[] = []
  for (const item of media) {
    if (!item || typeof item !== 'object') continue
    for (const key of MESSAGE_URL_KEYS) {
      const v = (item as Record<string, unknown>)[key]
      if (typeof v === 'string') out.push(v)
    }
  }
  return out
}

export interface UrlSwap {
  from: string
  to: string
}

/**
 * The column value with every URL equal to `swap.from` replaced by `swap.to`.
 * Returns the same reference when nothing matched. Never touches any other key,
 * so a concurrent change to unrelated metadata survives the read-modify-write.
 */
export function swapUrlsInValue<T>(kind: ColumnKind, value: T, swaps: UrlSwap[]): { value: T; changed: number } {
  const map = new Map(swaps.map((s) => [s.from, s.to]))
  let changed = 0
  const swap = (v: unknown): unknown => {
    if (typeof v === 'string' && map.has(v)) {
      changed += 1
      return map.get(v)
    }
    return v
  }
  if (kind === 'url') {
    const next = swap(value)
    return { value: (changed ? next : value) as T, changed }
  }
  if (kind === 'url-array') {
    if (!Array.isArray(value)) return { value, changed: 0 }
    const next = value.map(swap)
    return { value: (changed ? next : value) as T, changed }
  }
  const meta = value as unknown as { media?: unknown } | null
  if (!meta || !Array.isArray(meta.media)) return { value, changed: 0 }
  const media = meta.media.map((item) => {
    if (!item || typeof item !== 'object') return item
    const rec = item as Record<string, unknown>
    let touched = false
    const copy: Record<string, unknown> = { ...rec }
    for (const key of MESSAGE_URL_KEYS) {
      const next = swap(rec[key])
      if (next !== rec[key]) {
        copy[key] = next
        touched = true
      }
    }
    return touched ? copy : item
  })
  return { value: (changed ? { ...meta, media } : value) as T, changed }
}

// ── Compare-and-set filter values ───────────────────────────────────────────

/** Postgres array literal, every element quoted: {"a","b"}. */
export function toPgArrayLiteral(values: string[]): string {
  return `{${values.map((v) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`
}

/** The text the PostgREST `eq` filter needs to compare a column to `value`. */
export function casFilterValue(kind: ColumnKind, value: unknown): string {
  if (kind === 'url') return String(value)
  if (kind === 'url-array') return toPgArrayLiteral(value as string[])
  return JSON.stringify(value)
}

export interface ColumnStore {
  /** Current value of one column of one row; `found: false` when the row is gone. */
  read(ref: RefColumn, id: string): Promise<{ found: boolean; value: unknown }>
  /** UPDATE ... WHERE id = $id AND column = $expected. `updated: false` means the guard did not match. */
  compareAndSet(ref: RefColumn, id: string, expected: unknown, next: unknown): Promise<{ updated: boolean; error?: string }>
}

export type SwapStatus = 'updated' | 'already' | 'missing' | 'conflict' | 'error'

const MAX_CAS_ATTEMPTS = 3

/**
 * Replace `swap.from` by `swap.to` in one column of one row, only if the column
 * still holds what was read. On a lost race it re-reads and tries again (a
 * delivery-status write to the same metadata is the usual cause); after
 * MAX_CAS_ATTEMPTS it reports `conflict` and leaves the row alone.
 */
export async function applyUrlSwap(
  store: ColumnStore,
  ref: RefColumn,
  id: string,
  swap: UrlSwap,
): Promise<{ status: SwapStatus; error?: string }> {
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const current = await store.read(ref, id)
    if (!current.found) return { status: 'missing' }
    const { value: next, changed } = swapUrlsInValue(ref.kind, current.value, [swap])
    if (changed === 0) {
      const alreadyThere = collectUrls(ref.kind, current.value).includes(swap.to)
      return { status: alreadyThere ? 'already' : 'missing' }
    }
    const res = await store.compareAndSet(ref, id, current.value, next)
    if (res.error) return { status: 'error', error: res.error }
    if (res.updated) return { status: 'updated' }
  }
  return { status: 'conflict' }
}

// ── Manifests ───────────────────────────────────────────────────────────────

export interface RollbackEntry {
  table: string
  id: string
  column: string
  kind: ColumnKind
  /** The URL the column held before. For array and message columns this is the one element/URL that changed. */
  old: string
  new: string
}

export interface RollbackManifest {
  version: 1
  createdAt: string
  entries: RollbackEntry[]
}

export interface ObjectManifestEntry {
  bucket: CopyBucket
  path: string
  /** Key inside the R2 bucket: "<logical bucket>/<path>". */
  key: string
  r2Bucket: string
  size: number
  sha256: string
}

export interface ObjectManifest {
  version: 1
  createdAt: string
  objects: ObjectManifestEntry[]
}

export function buildRollbackManifest(entries: RollbackEntry[], now: Date): RollbackManifest {
  return { version: 1, createdAt: now.toISOString(), entries }
}

export function buildObjectManifest(objects: ObjectManifestEntry[], now: Date): ObjectManifest {
  return { version: 1, createdAt: now.toISOString(), objects }
}

/** `migration-backups/<YYYY-MM-DD>/<name>-<HHMMSS>.json` in the private bucket. */
export function manifestKey(kind: 'rollback' | 'objects', now: Date): string {
  const iso = now.toISOString()
  const date = iso.slice(0, 10)
  const time = iso.slice(11, 19).replace(/:/g, '')
  return `migration-backups/${date}/${kind}-${time}.json`
}

/** Validates a manifest read back from disk or from R2; throws on anything unexpected. */
export function parseRollbackManifest(text: string): RollbackManifest {
  const data = JSON.parse(text) as Partial<RollbackManifest>
  if (data?.version !== 1 || !Array.isArray(data.entries)) throw new Error('Not a rollback manifest (version 1)')
  const known = new Set(REFERENCE_COLUMNS.map((c) => `${c.table}.${c.column}`))
  for (const e of data.entries) {
    const ok =
      e &&
      typeof e.table === 'string' &&
      typeof e.id === 'string' &&
      typeof e.column === 'string' &&
      typeof e.old === 'string' &&
      typeof e.new === 'string' &&
      known.has(`${e.table}.${e.column}`)
    if (!ok) throw new Error('Rollback manifest has an entry outside the known reference columns')
  }
  return data as RollbackManifest
}

export function columnFor(table: string, column: string): RefColumn {
  const ref = REFERENCE_COLUMNS.find((c) => c.table === table && c.column === column)
  if (!ref) throw new Error(`Unknown reference column ${table}.${column}`)
  return ref
}

export interface RollbackSummary {
  total: number
  restored: number
  alreadyRestored: number
  conflicts: number
  missing: number
  errors: number
}

/** Restores `old` wherever the column still holds `new`; anything else is left alone and counted. */
export async function runRollback(
  manifest: RollbackManifest,
  store: ColumnStore,
  apply: boolean,
): Promise<RollbackSummary> {
  const s: RollbackSummary = { total: manifest.entries.length, restored: 0, alreadyRestored: 0, conflicts: 0, missing: 0, errors: 0 }
  for (const e of manifest.entries) {
    const ref = columnFor(e.table, e.column)
    if (!apply) {
      // Dry run: classify from the current value only.
      const current = await store.read(ref, e.id)
      if (!current.found) s.missing += 1
      else if (collectUrls(ref.kind, current.value).includes(e.new)) s.restored += 1
      else if (collectUrls(ref.kind, current.value).includes(e.old)) s.alreadyRestored += 1
      else s.conflicts += 1
      continue
    }
    const res = await applyUrlSwap(store, ref, e.id, { from: e.new, to: e.old })
    if (res.status === 'updated') s.restored += 1
    else if (res.status === 'already') s.alreadyRestored += 1
    else if (res.status === 'missing') {
      // `missing` covers both a deleted row and a value that is neither old nor new.
      const current = await store.read(ref, e.id)
      if (!current.found) s.missing += 1
      else s.conflicts += 1
    } else if (res.status === 'conflict') s.conflicts += 1
    else s.errors += 1
  }
  return s
}

// ── Objects: copy with verification ─────────────────────────────────────────

export interface CopyObjectRef {
  bucket: CopyBucket
  path: string
}

/**
 * Source and target access for one object. There is deliberately no method that
 * deletes from the source. `deleteTarget` only removes an R2 object this very
 * run wrote and could not verify.
 */
export interface CopyIo {
  downloadSource(obj: CopyObjectRef): Promise<{ bytes: Uint8Array; contentType: string | null }>
  headTarget(obj: CopyObjectRef): Promise<{ size: number; sha256: string | null } | null>
  putTarget(obj: CopyObjectRef, bytes: Uint8Array, meta: { contentType: string | null; sha256: string }): Promise<void>
  readTarget(obj: CopyObjectRef): Promise<Uint8Array>
  deleteTarget(obj: CopyObjectRef): Promise<void>
}

export type CopyStatus = 'copied' | 'already' | 'conflict' | 'failed'

export interface CopyResult {
  status: CopyStatus
  size: number
  sha256: string
  error?: string
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Copy one object and prove it arrived intact by reading it back from R2 and
 * hashing what was actually stored.
 *   - Already there with the same size and the sha256 recorded by an earlier
 *     verified run: skipped (idempotent rerun).
 *   - There with different content or no recorded hash: `conflict`, never overwritten.
 *   - Read-back differs: the bad R2 object is removed and the copy is `failed`.
 */
export async function copyObjectVerified(io: CopyIo, obj: CopyObjectRef): Promise<CopyResult> {
  let sha256 = ''
  let size = 0
  try {
    const { bytes, contentType } = await io.downloadSource(obj)
    sha256 = sha256Hex(bytes)
    size = bytes.byteLength

    const existing = await io.headTarget(obj)
    if (existing) {
      if (existing.size === size && existing.sha256 === sha256) return { status: 'already', size, sha256 }
      return { status: 'conflict', size, sha256, error: 'target exists with different content or no recorded hash' }
    }

    await io.putTarget(obj, bytes, { contentType, sha256 })
    const back = await io.readTarget(obj)
    const backSha = sha256Hex(back)
    if (back.byteLength !== size || backSha !== sha256) {
      await io.deleteTarget(obj).catch(() => undefined)
      return { status: 'failed', size, sha256, error: 'read-back does not match the source' }
    }
    return { status: 'copied', size, sha256 }
  } catch (err) {
    return { status: 'failed', size, sha256, error: (err instanceof Error ? err.message : String(err)).slice(0, 200) }
  }
}

// ── Plan ────────────────────────────────────────────────────────────────────

export interface PlannedRef {
  table: string
  id: string
  column: string
  kind: ColumnKind
  old: string
  new: string
  object: CopyObjectRef
}

export interface PlanCounts {
  /** `table.column` -> counters. Numbers only; no customer content. */
  byColumn: Record<string, ColumnCounts>
}

export interface ColumnCounts {
  scanned: number
  toCopy: number
  alreadyR2: number
  skipped: Partial<Record<SkipReason, number>>
  /** Buckets named by skipped out-of-scope / screenshot URLs, e.g. { 'global-knowledge': 2 }. */
  skippedBuckets: Record<string, number>
  crossOrg: number
  /** Messages past retention or flagged media_expired_at: retention deletes them, so they are not copied. */
  outOfRetention: number
}

export function emptyColumnCounts(): ColumnCounts {
  return { scanned: 0, toCopy: 0, alreadyR2: 0, skipped: {}, skippedBuckets: {}, crossOrg: 0, outOfRetention: 0 }
}

/**
 * Turns one row's column value into the references to rewrite, counting
 * everything it skips. `msg` is given for message-media columns: its scope and
 * org are enforced here.
 */
export function planRowReferences(
  ref: RefColumn,
  row: { id: string; value: unknown },
  ctx: UrlContext,
  counts: ColumnCounts,
  msg?: { org_id: string; created_at: string; metadata: Record<string, unknown> | null },
  now: Date = new Date(),
): PlannedRef[] {
  counts.scanned += 1
  if (ref.kind === 'message-media') {
    if (!msg || !messageInScope(msg, now)) {
      counts.outOfRetention += 1
      return []
    }
  }
  const allowed = allowedBucketsFor(ref.kind)
  const out: PlannedRef[] = []
  const seen = new Set<string>()
  for (const url of collectUrls(ref.kind, row.value)) {
    const c = classifyUrl(url, ctx, allowed)
    if (c.kind === 'already-r2') {
      counts.alreadyR2 += 1
      continue
    }
    if (c.kind === 'skip') {
      counts.skipped[c.reason] = (counts.skipped[c.reason] ?? 0) + 1
      if (c.bucket) counts.skippedBuckets[c.bucket] = (counts.skippedBuckets[c.bucket] ?? 0) + 1
      continue
    }
    if (c.bucket === 'chat-media' && msg && c.path.split('/')[0] !== msg.org_id) {
      counts.crossOrg += 1
      continue
    }
    if (seen.has(url)) continue
    seen.add(url)
    counts.toCopy += 1
    out.push({
      table: ref.table,
      id: row.id,
      column: ref.column,
      kind: ref.kind,
      old: url,
      new: newUrlFor(c.bucket, c.path, c.suffix, ctx),
      object: { bucket: c.bucket, path: c.path },
    })
  }
  return out
}

/** Distinct objects behind a set of references, in first-seen order. */
export function distinctObjects(refs: PlannedRef[]): CopyObjectRef[] {
  const seen = new Map<string, CopyObjectRef>()
  for (const r of refs) seen.set(`${r.object.bucket}/${r.object.path}`, r.object)
  return [...seen.values()]
}

/**
 * References that may be rewritten now: only those whose object is verified in
 * R2 (copied this run or already there).
 */
export function rewritableRefs(refs: PlannedRef[], results: Map<string, CopyResult>): PlannedRef[] {
  return refs.filter((r) => {
    const res = results.get(`${r.object.bucket}/${r.object.path}`)
    return res?.status === 'copied' || res?.status === 'already'
  })
}

export function rollbackEntriesFor(refs: PlannedRef[]): RollbackEntry[] {
  return refs.map((r) => ({ table: r.table, id: r.id, column: r.column, kind: r.kind, old: r.old, new: r.new }))
}
