// scripts/r2-copy-remaining.ts
//
// Phase 5 of docs/storage/r2-migration-plan.md: copy what is left in Supabase
// Storage to Cloudflare R2 and repoint the database. Meant to run ON THE SERVER
// (it reads and writes real data), never from a laptop.
//
//   npx tsx scripts/r2-copy-remaining.ts                      # DRY RUN (default): reads only, prints counts
//   npx tsx scripts/r2-copy-remaining.ts --apply              # copy, verify, write manifests, rewrite references
//   npx tsx scripts/r2-copy-remaining.ts --rollback <manifest>            # dry run of a rollback
//   npx tsx scripts/r2-copy-remaining.ts --rollback <manifest> --apply    # restore the old values
//   --only branding,avatars,email-assets,chat-media           # restrict the buckets (default: all four)
//
// <manifest> is a local file or an R2 key under migration-backups/ in the private bucket.
//
// Guarantees:
//   - NEVER deletes from Supabase. The code has no call that could (see CopyIo).
//   - Every object is read back from R2 and its SHA-256 compared with the source.
//   - Before any reference is rewritten, the rollback manifest (table, id, column,
//     old, new) and the object manifest (key, size, sha256) are written to the
//     PRIVATE R2 bucket under migration-backups/<date>/ and read back.
//   - References change by compare-and-set: only while the column still holds
//     the value that was read. A lost race is retried, then reported as a conflict.
//   - Idempotent: a rerun skips objects already verified in R2 and references
//     already rewritten.
//   - Output is counts only: no URLs, paths or customer content.
//
// Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (always);
//      R2_ACCOUNT_ID|R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
//      R2_PUBLIC_BUCKET, R2_PRIVATE_BUCKET, R2_PUBLIC_BASE_URL (for --apply and --rollback --apply).

import { readFileSync } from 'node:fs'
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { objectKey, resolveR2Target, type StorageBucket } from '@/lib/storage'
import {
  COPY_BUCKETS,
  REFERENCE_COLUMNS,
  applyUrlSwap,
  buildObjectManifest,
  buildRollbackManifest,
  casFilterValue,
  copyObjectVerified,
  distinctObjects,
  emptyColumnCounts,
  isPublicCopyBucket,
  manifestKey,
  parseRollbackManifest,
  planRowReferences,
  rewritableRefs,
  rollbackEntriesFor,
  runRollback,
  sha256Hex,
  type ColumnCounts,
  type ColumnStore,
  type CopyBucket,
  type CopyIo,
  type CopyObjectRef,
  type CopyResult,
  type ObjectManifestEntry,
  type PlannedRef,
  type RefColumn,
  type SwapStatus,
  type UrlContext,
} from '@/lib/storage/copy-remaining'
import { DEFAULT_CHAT_MEDIA_RETENTION_DAYS } from '@/lib/storage/retention'

const PAGE = 500
const PUBLIC_CACHE_CONTROL = 'public, max-age=86400'

// ── Args and env ────────────────────────────────────────────────────────────

interface Args {
  apply: boolean
  rollback: string | null
  only: Set<CopyBucket>
}

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, rollback: null, only: new Set(COPY_BUCKETS) }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--apply') args.apply = true
    else if (a === '--rollback') args.rollback = argv[++i] ?? ''
    else if (a === '--only') {
      const names = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
      for (const n of names) {
        if (!(COPY_BUCKETS as readonly string[]).includes(n)) throw new Error(`--only: unknown bucket "${n}"`)
      }
      args.only = new Set(names as CopyBucket[])
    } else throw new Error(`Unknown argument: ${a}`)
  }
  if (args.rollback === '') throw new Error('--rollback needs a manifest path or key')
  return args
}

function need(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is not set`)
  return v
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>

// ── R2 ──────────────────────────────────────────────────────────────────────

const s3Clients = new Map<string, S3Client>()

function r2For(bucket: StorageBucket) {
  // Treat the bucket as switched on for this call, whatever STORAGE_R2_BUCKETS says yet:
  // the copy runs before the app is pointed at R2. Config validation is the app's own.
  const target = resolveR2Target(bucket, { ...process.env, STORAGE_R2_BUCKETS: bucket })
  if (!target) throw new Error(`R2 target missing for ${bucket}`)
  const cacheKey = `${target.endpoint}|${target.accessKeyId}`
  let client = s3Clients.get(cacheKey)
  if (!client) {
    client = new S3Client({
      endpoint: target.endpoint,
      region: 'auto',
      credentials: { accessKeyId: target.accessKeyId, secretAccessKey: target.secretAccessKey },
      forcePathStyle: true,
      requestHandler: { connectionTimeout: 5_000, requestTimeout: 60_000, httpsAgent: { maxSockets: 20 } },
    })
    s3Clients.set(cacheKey, client)
  }
  return { client, target }
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } } | null
  return e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404
}

function makeCopyIo(db: Db): CopyIo {
  return {
    async downloadSource({ bucket, path }) {
      const { data, error } = await db.storage.from(bucket).download(path)
      if (error || !data) throw new Error(`source download failed: ${error?.message ?? 'no data'}`)
      return { bytes: new Uint8Array(await data.arrayBuffer()), contentType: data.type || null }
    },
    async headTarget({ bucket, path }) {
      const { client, target } = r2For(bucket)
      try {
        const res = await client.send(new HeadObjectCommand({ Bucket: target.r2Bucket, Key: objectKey(bucket, path) }))
        return { size: res.ContentLength ?? 0, sha256: res.Metadata?.sha256 ?? null }
      } catch (err) {
        if (isNotFound(err)) return null
        throw err
      }
    },
    async putTarget({ bucket, path }, bytes, meta) {
      const { client, target } = r2For(bucket)
      await client.send(
        new PutObjectCommand({
          Bucket: target.r2Bucket,
          Key: objectKey(bucket, path),
          Body: bytes,
          ContentType: meta.contentType ?? undefined,
          CacheControl: isPublicCopyBucket(bucket) ? PUBLIC_CACHE_CONTROL : undefined,
          Metadata: { sha256: meta.sha256 },
        }),
      )
    },
    async readTarget({ bucket, path }) {
      const { client, target } = r2For(bucket)
      const res = await client.send(new GetObjectCommand({ Bucket: target.r2Bucket, Key: objectKey(bucket, path) }))
      return (res.Body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray()
    },
    async deleteTarget({ bucket, path }) {
      // Only ever an R2 object this run wrote and failed to verify.
      const { client, target } = r2For(bucket)
      await client.send(new DeleteObjectCommand({ Bucket: target.r2Bucket, Key: objectKey(bucket, path) }))
    },
  }
}

/** Write a JSON manifest to the private bucket and prove it reads back identically. */
async function putManifest(key: string, body: unknown): Promise<void> {
  const { client, target } = r2For('chat-media') // any private logical bucket resolves to R2_PRIVATE_BUCKET
  const bytes = new TextEncoder().encode(JSON.stringify(body, null, 2))
  const sha = sha256Hex(bytes)
  await client.send(
    new PutObjectCommand({
      Bucket: target.r2Bucket,
      Key: key,
      Body: bytes,
      ContentType: 'application/json',
      Metadata: { sha256: sha },
    }),
  )
  const res = await client.send(new GetObjectCommand({ Bucket: target.r2Bucket, Key: key }))
  const back = await (res.Body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray()
  if (sha256Hex(back) !== sha) throw new Error(`manifest ${key} did not read back identically`)
}

async function readManifestFromR2(key: string): Promise<string> {
  const { client, target } = r2For('chat-media')
  const res = await client.send(new GetObjectCommand({ Bucket: target.r2Bucket, Key: key }))
  const bytes = await (res.Body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray()
  return new TextDecoder().decode(bytes)
}

// ── Database ────────────────────────────────────────────────────────────────

function makeColumnStore(db: Db): ColumnStore {
  return {
    async read(ref, id) {
      const { data, error } = await db.from(ref.table).select(ref.column).eq('id', id).maybeSingle()
      if (error) throw new Error(`read ${ref.table}.${ref.column}: ${error.message}`)
      if (!data) return { found: false, value: null }
      return { found: true, value: (data as Record<string, unknown>)[ref.column] }
    },
    async compareAndSet(ref, id, expected, next) {
      const { data, error } = await db
        .from(ref.table)
        .update({ [ref.column]: next })
        .eq('id', id)
        .filter(ref.column, 'eq', casFilterValue(ref.kind, expected))
        .select('id')
      if (error) return { updated: false, error: error.message }
      return { updated: (data ?? []).length > 0 }
    },
  }
}

interface RowRef {
  id: string
  value: unknown
  msg?: { org_id: string; created_at: string; metadata: Record<string, unknown> | null }
}

/** Keyset pages over the rows that can hold a reference in this column. */
async function* rowsOf(db: Db, ref: RefColumn, now: Date): AsyncGenerator<RowRef[]> {
  let after: string | null = null
  const cutoffIso = new Date(now.getTime() - DEFAULT_CHAT_MEDIA_RETENTION_DAYS * 86_400_000).toISOString()
  for (;;) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any
    if (ref.kind === 'message-media') {
      q = db
        .from('conversation_messages')
        .select('id, org_id, created_at, metadata')
        .gte('created_at', cutoffIso)
        .ilike('metadata->>media', '%/storage/v1/object/public/chat-media/%')
        .is('metadata->>media_expired_at', null)
    } else {
      q = db.from(ref.table).select(`id, ${ref.column}`).not(ref.column, 'is', null)
    }
    q = q.order('id', { ascending: true }).limit(PAGE)
    if (after) q = q.gt('id', after)
    const { data, error } = await q
    if (error) throw new Error(`scan ${ref.table}.${ref.column}: ${error.message}`)
    const rows = (data ?? []) as Array<Record<string, unknown>>
    if (rows.length === 0) return
    yield rows.map((r) =>
      ref.kind === 'message-media'
        ? {
            id: r.id as string,
            value: r.metadata,
            msg: { org_id: r.org_id as string, created_at: r.created_at as string, metadata: r.metadata as Record<string, unknown> | null },
          }
        : { id: r.id as string, value: r[ref.column] },
    )
    after = rows[rows.length - 1].id as string
    if (rows.length < PAGE) return
  }
}

/** Every object path in a Supabase bucket (folders are walked). */
async function listAllPaths(db: Db, bucket: CopyBucket): Promise<string[]> {
  const out: string[] = []
  const walk = async (prefix: string) => {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await db.storage.from(bucket).list(prefix, { limit: 1000, offset })
      if (error) throw new Error(`list ${bucket}: ${error.message}`)
      for (const item of data ?? []) {
        const full = prefix ? `${prefix}/${item.name}` : item.name
        if (item.id) out.push(full)
        else await walk(full)
      }
      if ((data ?? []).length < 1000) return
    }
  }
  await walk('')
  return out
}

// ── Reporting (counts only) ─────────────────────────────────────────────────

function fmtCounts(c: ColumnCounts): string {
  const skipped = Object.entries(c.skipped).map(([k, v]) => `${k}=${v}`).join(' ')
  const buckets = Object.entries(c.skippedBuckets).map(([k, v]) => `${k}=${v}`).join(' ')
  return (
    `scanned=${c.scanned} toCopy=${c.toCopy} alreadyR2=${c.alreadyR2}` +
    (c.outOfRetention ? ` outOfRetention=${c.outOfRetention}` : '') +
    (c.crossOrg ? ` crossOrg=${c.crossOrg}` : '') +
    (skipped ? ` skipped[${skipped}]` : '') +
    (buckets ? ` otherBuckets[${buckets}]` : '')
  )
}

// ── Modes ───────────────────────────────────────────────────────────────────

async function runCopy(db: Db, args: Args): Promise<number> {
  const now = new Date()
  const supabaseUrl = need('NEXT_PUBLIC_SUPABASE_URL')
  let r2PublicBase = process.env.R2_PUBLIC_BASE_URL ?? null
  if (!r2PublicBase) {
    if (args.apply) throw new Error('R2_PUBLIC_BASE_URL is not set')
    console.log('note: R2_PUBLIC_BASE_URL not set; dry run uses a placeholder and cannot see already-migrated rows')
    r2PublicBase = 'https://r2-public.invalid'
  }
  const ctx: UrlContext = { supabaseUrl, r2PublicBase }

  console.log(`mode: ${args.apply ? 'APPLY' : 'DRY RUN (no writes; pass --apply to write)'}`)

  // 1. Scan the reference columns.
  const refs: PlannedRef[] = []
  const counts: Record<string, ColumnCounts> = {}
  for (const col of REFERENCE_COLUMNS) {
    const c = (counts[`${col.table}.${col.column}`] = emptyColumnCounts())
    for await (const page of rowsOf(db, col, now)) {
      for (const row of page) refs.push(...planRowReferences(col, row, ctx, c, row.msg, now))
    }
  }
  const inScope = refs.filter((r) => args.only.has(r.object.bucket))
  for (const [name, c] of Object.entries(counts)) console.log(`  ${name}: ${fmtCounts(c)}`)

  // 2. email-assets has no database references but can live inside emails already sent: copy it all.
  const extra: CopyObjectRef[] = []
  if (args.only.has('email-assets')) {
    for (const path of await listAllPaths(db, 'email-assets')) extra.push({ bucket: 'email-assets', path })
  }
  // Report what is referenced nowhere in branding/avatars (not copied).
  const referenced = new Set(inScope.map((r) => `${r.object.bucket}/${r.object.path}`))
  for (const bucket of ['branding', 'avatars'] as const) {
    if (!args.only.has(bucket)) continue
    const all = await listAllPaths(db, bucket)
    const unreferenced = all.filter((p) => !referenced.has(`${bucket}/${p}`)).length
    console.log(`  ${bucket}: objects=${all.length} referenced=${all.length - unreferenced} unreferenced(skipped)=${unreferenced}`)
  }

  const objects = distinctObjects([
    ...inScope,
    ...extra.map((o) => ({ table: '', id: '', column: '', kind: 'url' as const, old: '', new: '', object: o })),
  ])
  const byBucket: Record<string, number> = {}
  for (const o of objects) byBucket[o.bucket] = (byBucket[o.bucket] ?? 0) + 1
  console.log(`objects to copy: ${objects.length} ${JSON.stringify(byBucket)}`)
  console.log(`references to rewrite: ${inScope.length}`)

  if (!args.apply) {
    console.log('dry run finished: nothing was written')
    return 0
  }

  // 3. Copy and verify every object by re-reading it from R2.
  const io = makeCopyIo(db)
  const results = new Map<string, CopyResult>()
  const tally = { copied: 0, already: 0, conflict: 0, failed: 0, bytes: 0 }
  for (const obj of objects) {
    const res = await copyObjectVerified(io, obj)
    results.set(`${obj.bucket}/${obj.path}`, res)
    tally[res.status] += 1
    if (res.status === 'copied') tally.bytes += res.size
  }
  console.log(`copy: copied=${tally.copied} already=${tally.already} conflict=${tally.conflict} failed=${tally.failed} bytes=${tally.bytes}`)

  // 4. Manifests first, then rewrites.
  const manifestObjects: ObjectManifestEntry[] = []
  for (const obj of objects) {
    const res = results.get(`${obj.bucket}/${obj.path}`)
    if (res && (res.status === 'copied' || res.status === 'already')) {
      manifestObjects.push({
        bucket: obj.bucket,
        path: obj.path,
        key: objectKey(obj.bucket, obj.path),
        r2Bucket: r2For(obj.bucket).target.r2Bucket,
        size: res.size,
        sha256: res.sha256,
      })
    }
  }
  const ready = rewritableRefs(inScope, results)
  const objectsKey = manifestKey('objects', now)
  const rollbackKey = manifestKey('rollback', now)
  await putManifest(objectsKey, buildObjectManifest(manifestObjects, now))
  await putManifest(rollbackKey, buildRollbackManifest(rollbackEntriesFor(ready), now))
  console.log(`manifests written and verified: ${objectsKey} (${manifestObjects.length} objects), ${rollbackKey} (${ready.length} entries)`)

  // 5. Rewrite references by compare-and-set.
  const store = makeColumnStore(db)
  const swap: Record<SwapStatus, number> = { updated: 0, already: 0, missing: 0, conflict: 0, error: 0 }
  for (const r of ready) {
    const col = REFERENCE_COLUMNS.find((c) => c.table === r.table && c.column === r.column)!
    const out = await applyUrlSwap(store, col, r.id, { from: r.old, to: r.new })
    swap[out.status] += 1
  }
  console.log(`rewrite: updated=${swap.updated} already=${swap.already} missing=${swap.missing} conflict=${swap.conflict} error=${swap.error}`)
  console.log(`not rewritten because the object is not verified in R2: ${inScope.length - ready.length}`)
  console.log('Supabase Storage was not modified.')

  return tally.failed + tally.conflict + swap.conflict + swap.error > 0 ? 1 : 0
}

async function runRollbackMode(db: Db, args: Args): Promise<number> {
  const source = args.rollback!
  const text = source.startsWith('migration-backups/') ? await readManifestFromR2(source) : readFileSync(source, 'utf8')
  const manifest = parseRollbackManifest(text)
  console.log(`mode: ROLLBACK ${args.apply ? 'APPLY' : 'DRY RUN (no writes; pass --apply to restore)'} entries=${manifest.entries.length}`)
  const s = await runRollback(manifest, makeColumnStore(db), args.apply)
  console.log(
    `rollback: ${args.apply ? 'restored' : 'wouldRestore'}=${s.restored} alreadyRestored=${s.alreadyRestored} ` +
      `conflicts=${s.conflicts} missing=${s.missing} errors=${s.errors}`,
  )
  return s.conflicts + s.errors > 0 ? 1 : 0
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const db = createClient(need('NEXT_PUBLIC_SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  }) as Db
  process.exitCode = args.rollback ? await runRollbackMode(db, args) : await runCopy(db, args)
}

main().catch((err) => {
  console.error('r2-copy-remaining failed:', err instanceof Error ? err.message : String(err))
  process.exit(2)
})
