// src/lib/storage/index.ts
// One door to object storage. Every upload, delete, public URL, signed URL and
// download in the app goes through here, so a bucket can move from Supabase
// Storage to Cloudflare R2 without touching its call sites.
//
// Nothing changes until env says so. A LOGICAL bucket ('avatars', 'chat-media',
// ...) is served by R2 only when it is listed in STORAGE_R2_BUCKETS. Not
// listed means Supabase Storage, exactly as before, whatever else is set. A
// bucket that IS listed while the R2 config is incomplete throws: cutting over
// with a typo must be loud, never a silent fall back to the old store.
//
// Env:
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
//   R2_ENDPOINT          optional override of https://<account>.r2.cloudflarestorage.com
//   R2_PUBLIC_BUCKET     holds the public logical buckets
//   R2_PUBLIC_BASE_URL   public origin of that bucket (e.g. https://media.xphere.app)
//   R2_PRIVATE_BUCKET    holds the private logical buckets (signed URLs only)
//   STORAGE_R2_BUCKETS   comma list of logical buckets switched to R2
//
// Object keys are "<logical-bucket>/<path used today>", so the same R2 bucket
// can hold several logical ones and a path means the same thing in both stores.

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'
import { createServiceRoleClient } from '@/lib/supabase/admin'

/** Readable by anyone holding the URL: avatars, branding, email images, screenshots. */
export const PUBLIC_BUCKETS = ['branding', 'avatars', 'email-assets', 'website-screenshots'] as const
/** Only ever handed out as a short-lived signed URL (or the /api/media gate). */
export const PRIVATE_BUCKETS = [
  'chat-media',
  'contact-imports',
  'global-knowledge',
  'knowledge-docs',
  'recordings',
] as const

export type PublicBucket = (typeof PUBLIC_BUCKETS)[number]
export type PrivateBucket = (typeof PRIVATE_BUCKETS)[number]
export type StorageBucket = PublicBucket | PrivateBucket

export const MEDIA_ROUTE_PREFIX = '/api/media/'
export const DEFAULT_SIGNED_URL_TTL_SECONDS = 300
/** Long enough for Twilio/Zernio/Meta to fetch an attachment they were handed. */
export const PROVIDER_URL_TTL_SECONDS = 3600

export class StorageConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StorageConfigError'
  }
}

export interface StorageError {
  message: string
}

type SupabaseAdmin = ReturnType<typeof createServiceRoleClient>
/** Optional Supabase client used ONLY on the Supabase path (keeps RLS-scoped callers as they were). */
export interface ClientOption {
  client?: { storage: SupabaseAdmin['storage'] }
}

type Env = Record<string, string | undefined>

export function isPublicBucket(bucket: string): bucket is PublicBucket {
  return (PUBLIC_BUCKETS as readonly string[]).includes(bucket)
}

function isKnownBucket(bucket: string): bucket is StorageBucket {
  return isPublicBucket(bucket) || (PRIVATE_BUCKETS as readonly string[]).includes(bucket)
}

// ─── Config ──────────────────────────────────────────────────────────────────

interface R2Target {
  endpoint: string
  accessKeyId: string
  secretAccessKey: string
  /** The physical R2 bucket holding this logical bucket. */
  r2Bucket: string
  /** Public base URL (public logical buckets only). */
  publicBaseUrl: string | null
}

function listedBuckets(env: Env): Set<string> {
  const raw = env.STORAGE_R2_BUCKETS ?? ''
  const names = raw.split(',').map((s) => s.trim()).filter(Boolean)
  for (const name of names) {
    if (!isKnownBucket(name)) {
      throw new StorageConfigError(
        `STORAGE_R2_BUCKETS lists unknown bucket "${name}". Known: ${[...PUBLIC_BUCKETS, ...PRIVATE_BUCKETS].join(', ')}.`,
      )
    }
  }
  return new Set(names)
}

/**
 * The R2 target for a logical bucket, or null when it is served by Supabase.
 * Throws StorageConfigError when the bucket is listed but R2 is not fully configured.
 */
export function resolveR2Target(bucket: StorageBucket, env: Env = process.env): R2Target | null {
  if (!listedBuckets(env).has(bucket)) return null

  const missing: string[] = []
  if (!env.R2_ACCESS_KEY_ID) missing.push('R2_ACCESS_KEY_ID')
  if (!env.R2_SECRET_ACCESS_KEY) missing.push('R2_SECRET_ACCESS_KEY')
  if (!env.R2_ENDPOINT && !env.R2_ACCOUNT_ID) missing.push('R2_ACCOUNT_ID (or R2_ENDPOINT)')

  const isPublic = isPublicBucket(bucket)
  const r2Bucket = isPublic ? env.R2_PUBLIC_BUCKET : env.R2_PRIVATE_BUCKET
  if (!r2Bucket) missing.push(isPublic ? 'R2_PUBLIC_BUCKET' : 'R2_PRIVATE_BUCKET')

  let publicBaseUrl: string | null = null
  if (isPublic) {
    if (!env.R2_PUBLIC_BASE_URL) missing.push('R2_PUBLIC_BASE_URL')
    else publicBaseUrl = env.R2_PUBLIC_BASE_URL.replace(/\/+$/, '')
  }

  if (missing.length > 0) {
    throw new StorageConfigError(
      `Bucket "${bucket}" is listed in STORAGE_R2_BUCKETS but R2 is not fully configured. Missing: ${missing.join(', ')}.`,
    )
  }

  return {
    endpoint: (env.R2_ENDPOINT || `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`).replace(/\/+$/, ''),
    accessKeyId: env.R2_ACCESS_KEY_ID!,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    r2Bucket: r2Bucket!,
    publicBaseUrl,
  }
}

/** True when this logical bucket is served by R2. Throws if listed but misconfigured. */
export function isR2Enabled(bucket: StorageBucket, env: Env = process.env): boolean {
  return resolveR2Target(bucket, env) !== null
}

// ─── Keys ────────────────────────────────────────────────────────────────────

/** A path must be relative and free of traversal, empty segments and control characters. */
export function assertSafePath(path: string): void {
  const bad =
    !path ||
    path.startsWith('/') ||
    path.includes('\\') ||
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f]/.test(path) ||
    path.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')
  if (bad) throw new Error(`Invalid storage path: ${JSON.stringify(path)}`)
}

/** "<bucket>/<path>": the R2 object key. */
export function objectKey(bucket: StorageBucket, path: string): string {
  assertSafePath(path)
  return `${bucket}/${path}`
}

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/')

// ─── R2 client ───────────────────────────────────────────────────────────────

const clients = new Map<string, S3Client>()

function r2Client(target: R2Target): S3Client {
  const cacheKey = `${target.endpoint}|${target.accessKeyId}`
  const cached = clients.get(cacheKey)
  if (cached) return cached
  const client = new S3Client({
    endpoint: target.endpoint,
    region: 'auto',
    credentials: { accessKeyId: target.accessKeyId, secretAccessKey: target.secretAccessKey },
    forcePathStyle: true,
    // A stuck request must fail, never hang. The SDK ships with no request
    // timeout and a 50-socket pool, so one socket that is never released stays
    // checked out for the life of the process; enough of them and every later
    // call queues behind them with nothing to break the wait.
    requestHandler: {
      connectionTimeout: 5_000,
      requestTimeout: 30_000,
      httpsAgent: { maxSockets: 200 },
    },
  })
  clients.set(cacheKey, client)
  return client
}

/** Test hook: forget cached clients so a changed env/mock is picked up. */
export function resetStorageClientsForTests(): void {
  clients.clear()
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } } | null
  return e?.name === 'NoSuchKey' || e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404
}

function supabaseStorage(opts?: ClientOption) {
  return (opts?.client ?? createServiceRoleClient()).storage
}

// ─── Operations ──────────────────────────────────────────────────────────────

export type PutBody = Buffer | Uint8Array | ArrayBuffer | Blob | string

async function toBytes(body: PutBody): Promise<Uint8Array> {
  if (typeof body === 'string') return new TextEncoder().encode(body)
  if (body instanceof Uint8Array) return body // Buffer is a Uint8Array
  if (body instanceof ArrayBuffer) return new Uint8Array(body)
  return new Uint8Array(await body.arrayBuffer())
}

export interface PutOptions extends ClientOption {
  contentType?: string
  /** Seconds, as the Supabase option; becomes Cache-Control: public, max-age=N on R2. */
  cacheControl?: string
  upsert?: boolean
}

/** Upload one object. Returns `{ error }` like supabase-js. Throws only on bad config or a bad path. */
export async function put(
  bucket: StorageBucket,
  path: string,
  body: PutBody,
  opts: PutOptions = {},
): Promise<{ error: StorageError | null }> {
  const target = resolveR2Target(bucket)
  if (!target) {
    const options: Record<string, unknown> = {}
    if (opts.contentType !== undefined) options.contentType = opts.contentType
    if (opts.upsert !== undefined) options.upsert = opts.upsert
    if (opts.cacheControl !== undefined) options.cacheControl = opts.cacheControl
    const { error } = await supabaseStorage(opts)
      .from(bucket)
      .upload(path, body as never, options)
    return { error: error ? { message: error.message } : null }
  }

  const key = objectKey(bucket, path)
  try {
    await r2Client(target).send(
      new PutObjectCommand({
        Bucket: target.r2Bucket,
        Key: key,
        Body: await toBytes(body),
        ContentType: opts.contentType,
        CacheControl: opts.cacheControl
          ? /^\d+$/.test(opts.cacheControl)
            ? `public, max-age=${opts.cacheControl}`
            : opts.cacheControl
          : undefined,
      }),
    )
    return { error: null }
  } catch (err) {
    return { error: { message: errMessage(err) } }
  }
}

/**
 * Delete objects. Missing objects are not an error. With R2 on, the same paths
 * are also removed from Supabase, because rows written before the cut-over still
 * point at objects that live there (a failure on that side is ignored).
 */
export async function remove(
  bucket: StorageBucket,
  paths: string[],
  opts: ClientOption = {},
): Promise<{ error: StorageError | null }> {
  if (paths.length === 0) return { error: null }
  const target = resolveR2Target(bucket)
  if (!target) {
    const { error } = await supabaseStorage(opts).from(bucket).remove(paths)
    return { error: error ? { message: error.message } : null }
  }

  const keys = paths.map((p) => objectKey(bucket, p))
  try {
    const client = r2Client(target)
    for (let i = 0; i < keys.length; i += 1000) {
      const res = await client.send(
        new DeleteObjectsCommand({
          Bucket: target.r2Bucket,
          Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true },
        }),
      )
      const failed = (res as { Errors?: Array<{ Key?: string; Message?: string }> }).Errors
      if (failed && failed.length > 0) {
        return { error: { message: `R2 delete failed for ${failed[0].Key}: ${failed[0].Message}` } }
      }
    }
  } catch (err) {
    return { error: { message: errMessage(err) } }
  }
  try {
    await supabaseStorage(opts).from(bucket).remove(paths)
  } catch {
    // Legacy copy is best effort.
  }
  return { error: null }
}

/**
 * Public URL of an object in a PUBLIC logical bucket. On R2 this is
 * R2_PUBLIC_BASE_URL/<bucket>/<path>; otherwise the Supabase public URL.
 */
export function publicUrl(bucket: PublicBucket, path: string, opts: ClientOption = {}): string {
  const target = resolveR2Target(bucket)
  if (!target) {
    return supabaseStorage(opts).from(bucket).getPublicUrl(path).data.publicUrl
  }
  return `${target.publicBaseUrl}/${bucket}/${encodePath(path)}`
}

/**
 * The path inside `bucket` that a stored public URL points at, whichever store
 * wrote it (Supabase or R2), with any ?v= cache-buster dropped; null when the
 * URL is not one of ours. Independent of STORAGE_R2_BUCKETS, so URLs written
 * before and after a cut-over both resolve.
 */
export function pathFromPublicUrl(bucket: PublicBucket, url: string, env: Env = process.env): string | null {
  const clean = url.split(/[?#]/)[0]
  const base = env.R2_PUBLIC_BASE_URL?.replace(/\/+$/, '')
  const r2Prefix = base ? `${base}/${bucket}/` : null
  let encoded: string | null = null
  if (r2Prefix && clean.startsWith(r2Prefix)) {
    encoded = clean.slice(r2Prefix.length)
  } else {
    const match = clean.match(new RegExp(`/object/public/${bucket}/(.+)$`))
    encoded = match ? match[1] : null
  }
  if (!encoded) return null
  try {
    return decodeURIComponent(encoded)
  } catch {
    return null
  }
}

/**
 * A URL that works for `ttlSeconds` without a session. Private buckets have no
 * other kind of link. With R2 on this is a presigned GET.
 */
export async function signedUrl(
  bucket: StorageBucket,
  path: string,
  ttlSeconds: number = DEFAULT_SIGNED_URL_TTL_SECONDS,
  opts: ClientOption = {},
): Promise<string> {
  const target = resolveR2Target(bucket)
  if (!target) {
    const { data, error } = await supabaseStorage(opts).from(bucket).createSignedUrl(path, ttlSeconds)
    if (error || !data) throw new Error(`Could not sign ${bucket}/${path}: ${error?.message ?? 'unknown'}`)
    return data.signedUrl
  }
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner')
  return getSignedUrl(
    r2Client(target),
    new GetObjectCommand({ Bucket: target.r2Bucket, Key: objectKey(bucket, path) }),
    { expiresIn: ttlSeconds },
  )
}

/**
 * A presigned GET for a Deno edge function that cannot (and should not) hold R2
 * credentials, or null when the bucket is not on R2 (the function then reads
 * Supabase Storage as it always did).
 */
export async function signedUrlIfR2(
  bucket: StorageBucket,
  path: string,
  ttlSeconds: number = PROVIDER_URL_TTL_SECONDS,
): Promise<string | null> {
  return isR2Enabled(bucket) ? signedUrl(bucket, path, ttlSeconds) : null
}

/**
 * A URL a browser can PUT a file to directly. The Content-Type is deliberately
 * not part of the signature, so the browser may send whatever its File reports.
 * `token` is only set on the Supabase path.
 */
export async function signedUploadUrl(
  bucket: StorageBucket,
  path: string,
  opts: ClientOption & { ttlSeconds?: number } = {},
): Promise<{ url: string; token: string | null; path: string }> {
  const target = resolveR2Target(bucket)
  if (!target) {
    const { data, error } = await supabaseStorage(opts).from(bucket).createSignedUploadUrl(path)
    if (error || !data) throw new Error(`Failed to create signed upload URL: ${error?.message ?? 'unknown'}`)
    return { url: data.signedUrl, token: data.token ?? null, path }
  }
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner')
  const url = await getSignedUrl(
    r2Client(target),
    new PutObjectCommand({ Bucket: target.r2Bucket, Key: objectKey(bucket, path) }),
    { expiresIn: opts.ttlSeconds ?? 900 },
  )
  return { url, token: null, path }
}

/**
 * Download an object as a Blob. With R2 on, an object that is not there falls
 * back to Supabase, because rows written before the cut-over keep a bare path.
 */
export async function get(
  bucket: StorageBucket,
  path: string,
  opts: ClientOption = {},
): Promise<{ data: Blob | null; error: StorageError | null }> {
  const target = resolveR2Target(bucket)
  const fromSupabase = async () => {
    const { data, error } = await supabaseStorage(opts).from(bucket).download(path)
    return { data: data ?? null, error: error ? { message: error.message } : null }
  }
  if (!target) return fromSupabase()

  try {
    const res = await r2Client(target).send(
      new GetObjectCommand({ Bucket: target.r2Bucket, Key: objectKey(bucket, path) }),
    )
    const bytes = await (res.Body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray()
    return { data: new Blob([bytes as BlobPart], res.ContentType ? { type: res.ContentType } : undefined), error: null }
  } catch (err) {
    if (isNotFound(err)) return fromSupabase()
    return { data: null, error: { message: errMessage(err) } }
  }
}

export interface StoredObject {
  /** Name relative to the listed prefix. */
  name: string
  size: number
  createdAt: string | null
}

/**
 * Files directly under `prefix` (one level, like Supabase's list). Folder
 * placeholders are skipped.
 */
export async function list(
  bucket: StorageBucket,
  prefix: string,
  opts: ClientOption & { limit?: number; offset?: number } = {},
): Promise<{ data: StoredObject[] | null; error: StorageError | null }> {
  const limit = opts.limit ?? 100
  const offset = opts.offset ?? 0
  const target = resolveR2Target(bucket)
  if (!target) {
    const { data, error } = await supabaseStorage(opts).from(bucket).list(prefix, { limit, offset })
    if (error) return { data: null, error: { message: error.message } }
    return {
      data: (data ?? [])
        .filter((o) => o.id)
        .map((o) => ({
          name: o.name,
          size: (o.metadata as { size?: number } | null)?.size ?? 0,
          createdAt: o.created_at ?? null,
        })),
      error: null,
    }
  }

  const folder = prefix.replace(/^\/+|\/+$/g, '')
  if (folder) assertSafePath(folder)
  const keyPrefix = folder ? `${bucket}/${folder}/` : `${bucket}/`
  try {
    const client = r2Client(target)
    const out: StoredObject[] = []
    let token: string | undefined
    do {
      const res = await client.send(
        new ListObjectsV2Command({
          Bucket: target.r2Bucket,
          Prefix: keyPrefix,
          Delimiter: '/',
          ContinuationToken: token,
        }),
      )
      for (const obj of res.Contents ?? []) {
        if (!obj.Key || obj.Key === keyPrefix) continue
        out.push({
          name: obj.Key.slice(keyPrefix.length),
          size: obj.Size ?? 0,
          createdAt: obj.LastModified ? obj.LastModified.toISOString() : null,
        })
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined
    } while (token && out.length < offset + limit)
    return { data: out.slice(offset, offset + limit), error: null }
  } catch (err) {
    return { data: null, error: { message: errMessage(err) } }
  }
}

// ─── App media path (private buckets behind a session) ───────────────────────

/** "/api/media/<bucket>/<path>": the stable, session-gated address of a private object. */
export function mediaPath(bucket: PrivateBucket, path: string): string {
  assertSafePath(path)
  return `${MEDIA_ROUTE_PREFIX}${bucket}/${encodePath(path)}`
}

/**
 * The address to store for a private object: the /api/media path when the
 * bucket is on R2, the Supabase public URL otherwise (what every caller stored
 * before). Only for buckets that were public on Supabase (chat-media).
 */
export function storedMediaUrl(bucket: PrivateBucket, path: string, env: Env = process.env): string {
  if (isR2Enabled(bucket, env)) return mediaPath(bucket, path)
  return `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`
}

/** Split "/api/media/<bucket>/<path...>" (optionally absolute) into its parts, or null if it is not one. */
export function parseMediaPath(url: string): { bucket: PrivateBucket; path: string } | null {
  let pathname = url
  if (/^https?:\/\//i.test(url)) {
    try {
      pathname = new URL(url).pathname
    } catch {
      return null
    }
  }
  if (!pathname.startsWith(MEDIA_ROUTE_PREFIX)) return null
  const segments = pathname.slice(MEDIA_ROUTE_PREFIX.length).split('/')
  const [bucket, ...rest] = segments
  if (!bucket || !(PRIVATE_BUCKETS as readonly string[]).includes(bucket) || rest.length === 0) return null
  try {
    const path = rest.map(decodeURIComponent).join('/')
    assertSafePath(path)
    return { bucket: bucket as PrivateBucket, path }
  } catch {
    return null
  }
}

/**
 * For a URL about to leave the app (a provider fetching an attachment, an
 * external MCP caller): an /api/media path becomes a presigned URL valid for
 * `ttlSeconds`; anything else (old Supabase URLs, third-party URLs) is returned
 * untouched.
 */
export async function resolveExternalUrl(
  url: string,
  ttlSeconds: number = PROVIDER_URL_TTL_SECONDS,
): Promise<string> {
  const parsed = parseMediaPath(url)
  if (!parsed) return url
  return signedUrl(parsed.bucket, parsed.path, ttlSeconds)
}

/**
 * For messages about to be handed to an external caller (MCP, API): any
 * `metadata.media[].url` that is an /api/media path becomes a presigned URL.
 * Messages without such media are returned as the same objects, untouched.
 */
export async function resolveMessageMediaUrls<T extends { metadata?: unknown }>(
  messages: T[],
  ttlSeconds: number = PROVIDER_URL_TTL_SECONDS,
): Promise<T[]> {
  return Promise.all(
    messages.map(async (message) => {
      const metadata = message.metadata as { media?: unknown } | null | undefined
      const media = metadata?.media
      if (!Array.isArray(media) || !media.some((m) => typeof m?.url === 'string' && parseMediaPath(m.url))) {
        return message
      }
      const resolved = await Promise.all(
        media.map(async (m) =>
          m && typeof m.url === 'string' ? { ...m, url: await resolveExternalUrl(m.url, ttlSeconds) } : m,
        ),
      )
      return { ...message, metadata: { ...metadata, media: resolved } }
    }),
  )
}
