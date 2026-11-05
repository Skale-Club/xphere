import { describe, it, expect } from 'vitest'
import {
  REFERENCE_COLUMNS,
  allowedBucketsFor,
  applyUrlSwap,
  buildObjectManifest,
  buildRollbackManifest,
  casFilterValue,
  classifyUrl,
  collectUrls,
  columnFor,
  copyObjectVerified,
  distinctObjects,
  emptyColumnCounts,
  manifestKey,
  messageInScope,
  newUrlFor,
  parseRollbackManifest,
  parseSupabasePublicUrl,
  planRowReferences,
  rewritableRefs,
  rollbackEntriesFor,
  runRollback,
  sha256Hex,
  swapUrlsInValue,
  toPgArrayLiteral,
  type ColumnStore,
  type CopyIo,
  type CopyObjectRef,
  type CopyResult,
  type RefColumn,
  type UrlContext,
} from '@/lib/storage/copy-remaining'

const SUPA = 'https://proj.supabase.co'
const R2 = 'https://media.xphere.app'
const CTX: UrlContext = { supabaseUrl: SUPA, r2PublicBase: R2 }
const PUB = `${SUPA}/storage/v1/object/public`
const NOW = new Date('2026-11-05T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString()
const ORG_A = '11111111-1111-4111-8111-111111111111'
const ORG_B = '22222222-2222-4222-8222-222222222222'

const col = (table: string, column: string): RefColumn => columnFor(table, column)

describe('scope: the reference columns', () => {
  it('covers exactly the columns that were asked for', () => {
    expect(REFERENCE_COLUMNS.map((c) => `${c.table}.${c.column}`).sort()).toEqual(
      [
        'accounts.avatar_url',
        'contacts.avatar_url',
        'conversation_messages.metadata',
        'folders.icon',
        'landing_config.cta_image_url',
        'landing_config.scroll_images',
        'organizations.logo_url',
        'organizations.widget_avatar_url',
        'seo_config.favicon_url',
        'seo_config.og_image_url',
        'website_analyses.logo_url',
      ].sort(),
    )
  })

  it('plain columns may point at branding, avatars, email-assets; messages only at chat-media', () => {
    expect(allowedBucketsFor('url')).toEqual(['branding', 'avatars', 'email-assets'])
    expect(allowedBucketsFor('message-media')).toEqual(['chat-media'])
  })
})

describe('classifyUrl and URL mapping', () => {
  const allowed = allowedBucketsFor('url')

  it('maps a public Supabase URL to the R2 public URL, keeping the ?v= tail and encoding the path', () => {
    const c = classifyUrl(`${PUB}/avatars/u1/my%20pic.png?v=123`, CTX, allowed)
    expect(c).toEqual({ kind: 'copy', bucket: 'avatars', path: 'u1/my pic.png', suffix: '?v=123' })
    if (c.kind !== 'copy') throw new Error('unreachable')
    expect(newUrlFor(c.bucket, c.path, c.suffix, CTX)).toBe(`${R2}/avatars/u1/my%20pic.png?v=123`)
  })

  it('maps chat-media to the session-gated /api/media path', () => {
    expect(newUrlFor('chat-media', `${ORG_A}/c/m/a.jpg`, '', CTX)).toBe(`/api/media/chat-media/${ORG_A}/c/m/a.jpg`)
  })

  it('recognises already-migrated values (R2 public base and /api/media)', () => {
    expect(classifyUrl(`${R2}/branding/x.png`, CTX, allowed)).toEqual({ kind: 'already-r2' })
    expect(classifyUrl(`/api/media/chat-media/${ORG_A}/a.jpg`, CTX, ['chat-media'])).toEqual({ kind: 'already-r2' })
  })

  it('skips website-screenshots entirely, naming the bucket', () => {
    expect(classifyUrl(`${PUB}/website-screenshots/${ORG_A}/desktop.jpg`, CTX, allowed)).toEqual({
      kind: 'skip',
      reason: 'screenshots',
      bucket: 'website-screenshots',
    })
  })

  it('skips our other buckets and buckets a column may not point at', () => {
    expect(classifyUrl(`${PUB}/global-knowledge/a.pdf`, CTX, allowed)).toEqual({
      kind: 'skip',
      reason: 'out-of-scope-bucket',
      bucket: 'global-knowledge',
    })
    // chat-media is not allowed in a plain column.
    expect(classifyUrl(`${PUB}/chat-media/${ORG_A}/a.jpg`, CTX, allowed)).toMatchObject({ reason: 'out-of-scope-bucket' })
    // and branding is not allowed inside a message.
    expect(classifyUrl(`${PUB}/branding/a.png`, CTX, ['chat-media'])).toMatchObject({ reason: 'out-of-scope-bucket' })
  })

  it('skips third-party URLs, other Supabase projects, emoji icons and empty values', () => {
    expect(classifyUrl('https://example.com/logo.png', CTX, allowed)).toMatchObject({ reason: 'external' })
    expect(classifyUrl('https://other.supabase.co/storage/v1/object/public/branding/a.png', CTX, allowed)).toMatchObject({ reason: 'external' })
    expect(classifyUrl('📁', CTX, allowed)).toMatchObject({ reason: 'not-url' })
    expect(classifyUrl('', CTX, allowed)).toMatchObject({ reason: 'not-url' })
    expect(classifyUrl(null, CTX, allowed)).toMatchObject({ reason: 'not-url' })
  })

  it('rejects traversal in a path', () => {
    expect(classifyUrl(`${PUB}/branding/a/%2e%2e/b.png`, CTX, allowed)).toMatchObject({ reason: 'unsafe-path' })
    expect(parseSupabasePublicUrl(`${PUB}/branding`, SUPA)).toBeNull()
  })
})

describe('messages: scope filter', () => {
  it('keeps messages inside retention and drops flagged or older ones', () => {
    expect(messageInScope({ created_at: ago(5), metadata: {} }, NOW)).toBe(true)
    expect(messageInScope({ created_at: ago(29.9), metadata: null }, NOW)).toBe(true)
    expect(messageInScope({ created_at: ago(31), metadata: {} }, NOW)).toBe(false)
    expect(messageInScope({ created_at: ago(2), metadata: { media_expired_at: '2026-11-01T00:00:00Z' } }, NOW)).toBe(false)
    expect(messageInScope({ created_at: 'garbage', metadata: {} }, NOW)).toBe(false)
  })

  const media = (...urls: string[]) => ({ media: urls.map((url) => ({ url, mime_type: 'image/jpeg' })) })
  const meta = col('conversation_messages', 'metadata')
  const msg = (created: number, metadata: Record<string, unknown>, org = ORG_A) => ({ org_id: org, created_at: ago(created), metadata })

  it('plans only in-scope messages and counts the rest', () => {
    const counts = emptyColumnCounts()
    const url = `${PUB}/chat-media/${ORG_A}/c/m/a.jpg`
    const inside = planRowReferences(meta, { id: 'm1', value: media(url) }, CTX, counts, msg(3, media(url)), NOW)
    expect(inside).toHaveLength(1)
    expect(inside[0]).toMatchObject({ old: url, new: `/api/media/chat-media/${ORG_A}/c/m/a.jpg`, object: { bucket: 'chat-media', path: `${ORG_A}/c/m/a.jpg` } })

    const old = planRowReferences(meta, { id: 'm2', value: media(url) }, CTX, counts, msg(45, media(url)), NOW)
    const flagged = planRowReferences(meta, { id: 'm3', value: media(url) }, CTX, counts, msg(3, { ...media(url), media_expired_at: ago(1) }), NOW)
    expect(old).toEqual([])
    expect(flagged).toEqual([])
    expect(counts).toMatchObject({ scanned: 3, toCopy: 1, outOfRetention: 2 })
  })

  it('refuses a path whose first segment is not the message org', () => {
    const counts = emptyColumnCounts()
    const url = `${PUB}/chat-media/${ORG_B}/c/m/a.jpg`
    expect(planRowReferences(meta, { id: 'm1', value: media(url) }, CTX, counts, msg(3, media(url)), NOW)).toEqual([])
    expect(counts.crossOrg).toBe(1)
  })

  it('also plans thumbnail_url and ignores original_url and proxy URLs', () => {
    const counts = emptyColumnCounts()
    const a = `${PUB}/chat-media/${ORG_A}/a.jpg`
    const t = `${PUB}/chat-media/${ORG_A}/t.jpg`
    const value = { media: [{ url: a, thumbnail_url: t, original_url: `${PUB}/chat-media/${ORG_A}/o.jpg` }, { url: '/api/zernio/media?u=1' }] }
    const planned = planRowReferences(meta, { id: 'm1', value }, CTX, counts, msg(3, value), NOW)
    expect(planned.map((p) => p.old)).toEqual([a, t])
    expect(counts.skipped['not-url']).toBe(1)
  })

  it('reports a non-message column for any bucket, such as website_analyses.logo_url', () => {
    const logo = col('website_analyses', 'logo_url')
    const counts = emptyColumnCounts()
    planRowReferences(logo, { id: 'w1', value: 'https://prospect.example.com/logo.png' }, CTX, counts)
    planRowReferences(logo, { id: 'w2', value: `${PUB}/website-screenshots/x/desktop.jpg` }, CTX, counts)
    planRowReferences(logo, { id: 'w3', value: `${PUB}/global-knowledge/x.png` }, CTX, counts)
    const ok = planRowReferences(logo, { id: 'w4', value: `${PUB}/branding/logo.png` }, CTX, counts)
    expect(ok).toHaveLength(1)
    expect(counts).toMatchObject({ scanned: 4, toCopy: 1, skipped: { external: 1, screenshots: 1, 'out-of-scope-bucket': 1 } })
    expect(counts.skippedBuckets).toEqual({ 'website-screenshots': 1, 'global-knowledge': 1 })
  })

  it('an array column plans each distinct URL once', () => {
    const arr = col('landing_config', 'scroll_images')
    const u1 = `${PUB}/branding/landing/1.jpg`
    const u2 = `${PUB}/branding/landing/2.jpg`
    const planned = planRowReferences(arr, { id: 'l1', value: [u1, u2, u1, `${R2}/branding/landing/3.jpg`] }, CTX, emptyColumnCounts())
    expect(planned.map((p) => p.old)).toEqual([u1, u2])
  })
})

describe('swapUrlsInValue and compare-and-set filters', () => {
  it('swaps only the matching URLs and preserves every other metadata key', () => {
    const value = { delivery_status: 'read', media: [{ url: 'A', thumbnail_url: 'B', mime_type: 'x' }, { url: 'C' }] }
    const { value: next, changed } = swapUrlsInValue('message-media', value, [{ from: 'A', to: 'A2' }])
    expect(changed).toBe(1)
    expect(next).toEqual({ delivery_status: 'read', media: [{ url: 'A2', thumbnail_url: 'B', mime_type: 'x' }, { url: 'C' }] })
    expect(value.media[0].url).toBe('A') // input is not mutated
  })

  it('returns the same reference when nothing matches', () => {
    const value = { media: [{ url: 'A' }] }
    const res = swapUrlsInValue('message-media', value, [{ from: 'Z', to: 'Z2' }])
    expect(res.changed).toBe(0)
    expect(res.value).toBe(value)
    expect(swapUrlsInValue('url-array', ['a'], [{ from: 'b', to: 'c' }]).changed).toBe(0)
    expect(swapUrlsInValue('url', null, [{ from: 'b', to: 'c' }]).changed).toBe(0)
  })

  it('swaps in arrays and plain values', () => {
    expect(swapUrlsInValue('url-array', ['a', 'b', 'a'], [{ from: 'a', to: 'x' }])).toEqual({ value: ['x', 'b', 'x'], changed: 2 })
    expect(swapUrlsInValue('url', 'a', [{ from: 'a', to: 'x' }])).toEqual({ value: 'x', changed: 1 })
  })

  it('collectUrls reads url and thumbnail_url of messages', () => {
    expect(collectUrls('message-media', { media: [{ url: 'a', thumbnail_url: 'b', original_url: 'c' }] })).toEqual(['a', 'b'])
    expect(collectUrls('url-array', ['a', 1, 'b'])).toEqual(['a', 'b'])
    expect(collectUrls('url', null)).toEqual([])
  })

  it('builds the filter text per kind (array literal quoting included)', () => {
    expect(toPgArrayLiteral(['a', 'b"c', 'd\\e'])).toBe('{"a","b\\"c","d\\\\e"}')
    expect(casFilterValue('url', 'https://x/y?z=1,2')).toBe('https://x/y?z=1,2')
    expect(casFilterValue('url-array', ['a', 'b'])).toBe('{"a","b"}')
    expect(casFilterValue('message-media', { a: 1 })).toBe('{"a":1}')
  })
})

/** In-memory ColumnStore whose compare-and-set really compares. */
class FakeColumns implements ColumnStore {
  rows = new Map<string, unknown>() // `${table}.${column}#${id}` -> value
  casCalls: Array<{ expected: unknown; next: unknown }> = []
  /** Mutate the row right before the first CAS to simulate a concurrent write. */
  raceOnce: ((rows: Map<string, unknown>) => void) | null = null
  failWith: string | null = null
  private k(ref: RefColumn, id: string) {
    return `${ref.table}.${ref.column}#${id}`
  }
  set(ref: RefColumn, id: string, value: unknown) {
    this.rows.set(this.k(ref, id), value)
  }
  get(ref: RefColumn, id: string) {
    return this.rows.get(this.k(ref, id))
  }
  async read(ref: RefColumn, id: string) {
    const key = this.k(ref, id)
    return this.rows.has(key) ? { found: true, value: structuredClone(this.rows.get(key)) } : { found: false, value: null }
  }
  async compareAndSet(ref: RefColumn, id: string, expected: unknown, next: unknown) {
    this.casCalls.push({ expected, next })
    if (this.failWith) return { updated: false, error: this.failWith }
    if (this.raceOnce) {
      const r = this.raceOnce
      this.raceOnce = null
      r(this.rows)
    }
    const key = this.k(ref, id)
    if (JSON.stringify(this.rows.get(key)) !== JSON.stringify(expected)) return { updated: false }
    this.rows.set(key, next)
    return { updated: true }
  }
}

describe('applyUrlSwap: compare-and-set', () => {
  const ref = col('contacts', 'avatar_url')

  it('updates when the column still holds the old value', async () => {
    const db = new FakeColumns()
    db.set(ref, 'c1', 'OLD')
    expect(await applyUrlSwap(db, ref, 'c1', { from: 'OLD', to: 'NEW' })).toEqual({ status: 'updated' })
    expect(db.get(ref, 'c1')).toBe('NEW')
    expect(db.casCalls).toEqual([{ expected: 'OLD', next: 'NEW' }])
  })

  it('is idempotent: a second run finds the new value and writes nothing', async () => {
    const db = new FakeColumns()
    db.set(ref, 'c1', 'OLD')
    await applyUrlSwap(db, ref, 'c1', { from: 'OLD', to: 'NEW' })
    db.casCalls.length = 0
    expect(await applyUrlSwap(db, ref, 'c1', { from: 'OLD', to: 'NEW' })).toEqual({ status: 'already' })
    expect(db.casCalls).toHaveLength(0)
  })

  it('does not overwrite a value that changed to something else', async () => {
    const db = new FakeColumns()
    db.set(ref, 'c1', 'SOMETHING ELSE')
    expect(await applyUrlSwap(db, ref, 'c1', { from: 'OLD', to: 'NEW' })).toEqual({ status: 'missing' })
    expect(db.get(ref, 'c1')).toBe('SOMETHING ELSE')
    expect(db.casCalls).toHaveLength(0)
  })

  it('a row edited between read and write: guard fails, re-read, retry keeps the concurrent edit', async () => {
    const meta = col('conversation_messages', 'metadata')
    const db = new FakeColumns()
    db.set(meta, 'm1', { delivery_status: 'sent', media: [{ url: 'OLD' }] })
    db.raceOnce = (rows) => rows.set('conversation_messages.metadata#m1', { delivery_status: 'read', media: [{ url: 'OLD' }] })
    expect(await applyUrlSwap(db, meta, 'm1', { from: 'OLD', to: 'NEW' })).toEqual({ status: 'updated' })
    expect(db.get(meta, 'm1')).toEqual({ delivery_status: 'read', media: [{ url: 'NEW' }] })
    expect(db.casCalls).toHaveLength(2)
  })

  it('gives up with conflict when the row keeps changing, without writing', async () => {
    const db = new FakeColumns()
    db.set(ref, 'c1', 'OLD')
    let n = 0
    const orig = db.compareAndSet.bind(db)
    db.compareAndSet = async (r, id, expected, next) => {
      db.set(r, id, `OLD`) // same content, so use a differing guard instead
      n += 1
      return orig(r, id, `STALE-${n}`, next)
    }
    expect(await applyUrlSwap(db, ref, 'c1', { from: 'OLD', to: 'NEW' })).toEqual({ status: 'conflict' })
    expect(db.get(ref, 'c1')).toBe('OLD')
    expect(n).toBe(3)
  })

  it('reports a missing row and a store error', async () => {
    const db = new FakeColumns()
    expect(await applyUrlSwap(db, ref, 'nope', { from: 'a', to: 'b' })).toEqual({ status: 'missing' })
    db.set(ref, 'c1', 'OLD')
    db.failWith = 'boom'
    expect(await applyUrlSwap(db, ref, 'c1', { from: 'OLD', to: 'NEW' })).toEqual({ status: 'error', error: 'boom' })
  })

  it('swaps one element of an array column and leaves the others', async () => {
    const arr = col('landing_config', 'scroll_images')
    const db = new FakeColumns()
    db.set(arr, 'l1', ['A', 'B', 'C'])
    await applyUrlSwap(db, arr, 'l1', { from: 'B', to: 'B2' })
    expect(db.get(arr, 'l1')).toEqual(['A', 'B2', 'C'])
  })
})

describe('manifests', () => {
  const refs = planRowReferences(
    col('accounts', 'avatar_url'),
    { id: 'a1', value: `${PUB}/avatars/a/b.png` },
    CTX,
    emptyColumnCounts(),
  )

  it('rollback entries carry table, id, column, old and new', () => {
    expect(rollbackEntriesFor(refs)).toEqual([
      { table: 'accounts', id: 'a1', column: 'avatar_url', kind: 'url', old: `${PUB}/avatars/a/b.png`, new: `${R2}/avatars/a/b.png` },
    ])
  })

  it('builds both manifests and the private-bucket key under migration-backups/<date>/', () => {
    const m = buildRollbackManifest(rollbackEntriesFor(refs), NOW)
    expect(m).toMatchObject({ version: 1, createdAt: NOW.toISOString() })
    const o = buildObjectManifest(
      [{ bucket: 'avatars', path: 'a/b.png', key: 'avatars/a/b.png', r2Bucket: 'xphere-assets', size: 3, sha256: sha256Hex(new Uint8Array([1, 2, 3])) }],
      NOW,
    )
    expect(o.objects[0]).toMatchObject({ key: 'avatars/a/b.png', size: 3 })
    expect(o.objects[0].sha256).toHaveLength(64)
    expect(manifestKey('rollback', NOW)).toBe('migration-backups/2026-11-05/rollback-120000.json')
    expect(manifestKey('objects', NOW)).toBe('migration-backups/2026-11-05/objects-120000.json')
  })

  it('parseRollbackManifest round-trips and rejects unknown shapes or columns', () => {
    const text = JSON.stringify(buildRollbackManifest(rollbackEntriesFor(refs), NOW))
    expect(parseRollbackManifest(text).entries).toHaveLength(1)
    expect(() => parseRollbackManifest('{"version":2,"entries":[]}')).toThrow(/rollback manifest/i)
    const bad = { version: 1, createdAt: 'x', entries: [{ table: 'users', id: '1', column: 'password', old: 'a', new: 'b' }] }
    expect(() => parseRollbackManifest(JSON.stringify(bad))).toThrow(/known reference columns/)
  })

  it('distinctObjects dedupes and rewritableRefs keeps only verified objects', () => {
    const a = `${PUB}/avatars/x.png`
    const b = `${PUB}/avatars/y.png`
    const planned = [
      ...planRowReferences(col('accounts', 'avatar_url'), { id: '1', value: a }, CTX, emptyColumnCounts()),
      ...planRowReferences(col('contacts', 'avatar_url'), { id: '2', value: a }, CTX, emptyColumnCounts()),
      ...planRowReferences(col('contacts', 'avatar_url'), { id: '3', value: b }, CTX, emptyColumnCounts()),
    ]
    expect(distinctObjects(planned)).toEqual([
      { bucket: 'avatars', path: 'x.png' },
      { bucket: 'avatars', path: 'y.png' },
    ])
    const results = new Map<string, CopyResult>([
      ['avatars/x.png', { status: 'copied', size: 1, sha256: 'h' }],
      ['avatars/y.png', { status: 'failed', size: 1, sha256: 'h', error: 'e' }],
    ])
    expect(rewritableRefs(planned, results).map((r) => r.id)).toEqual(['1', '2'])
    results.set('avatars/y.png', { status: 'conflict', size: 1, sha256: 'h' })
    expect(rewritableRefs(planned, results).map((r) => r.id)).toEqual(['1', '2'])
  })
})

describe('runRollback', () => {
  const ref = col('contacts', 'avatar_url')
  const entry = (id: string) => ({ table: 'contacts', id, column: 'avatar_url', kind: 'url' as const, old: 'OLD', new: 'NEW' })
  const manifest = (...ids: string[]) => buildRollbackManifest(ids.map(entry), NOW)

  it('restores the old value where the column still holds the new one', async () => {
    const db = new FakeColumns()
    db.set(ref, 'c1', 'NEW')
    const s = await runRollback(manifest('c1'), db, true)
    expect(s).toMatchObject({ total: 1, restored: 1, conflicts: 0 })
    expect(db.get(ref, 'c1')).toBe('OLD')
  })

  it('leaves a changed value alone (conflict) and is idempotent (already restored)', async () => {
    const db = new FakeColumns()
    db.set(ref, 'c1', 'EDITED BY A USER')
    db.set(ref, 'c2', 'OLD')
    const s = await runRollback(manifest('c1', 'c2', 'c3'), db, true)
    expect(s).toMatchObject({ restored: 0, conflicts: 1, alreadyRestored: 1, missing: 1 })
    expect(db.get(ref, 'c1')).toBe('EDITED BY A USER')
    expect(db.casCalls).toHaveLength(0)
  })

  it('dry run reports what it would do and writes nothing', async () => {
    const db = new FakeColumns()
    db.set(ref, 'c1', 'NEW')
    const s = await runRollback(manifest('c1'), db, false)
    expect(s.restored).toBe(1)
    expect(db.get(ref, 'c1')).toBe('NEW')
    expect(db.casCalls).toHaveLength(0)
  })

  it('rolls back a message URL without disturbing newer metadata', async () => {
    const meta = col('conversation_messages', 'metadata')
    const db = new FakeColumns()
    db.set(meta, 'm1', { delivery_status: 'read', media: [{ url: 'NEW' }] })
    const m = buildRollbackManifest([{ table: 'conversation_messages', id: 'm1', column: 'metadata', kind: 'message-media', old: 'OLD', new: 'NEW' }], NOW)
    await runRollback(m, db, true)
    expect(db.get(meta, 'm1')).toEqual({ delivery_status: 'read', media: [{ url: 'OLD' }] })
  })
})

/** In-memory source and target. The io has no way to delete from the source. */
class FakeIo implements CopyIo {
  source = new Map<string, { bytes: Uint8Array; contentType: string | null }>()
  target = new Map<string, { bytes: Uint8Array; sha256: string | null }>()
  puts: string[] = []
  deletes: string[] = []
  corruptOnPut = false
  failDownload = false
  private k(o: CopyObjectRef) {
    return `${o.bucket}/${o.path}`
  }
  async downloadSource(o: CopyObjectRef) {
    if (this.failDownload) throw new Error('source down')
    const s = this.source.get(this.k(o))
    if (!s) throw new Error('not found')
    return s
  }
  async headTarget(o: CopyObjectRef) {
    const t = this.target.get(this.k(o))
    return t ? { size: t.bytes.byteLength, sha256: t.sha256 } : null
  }
  async putTarget(o: CopyObjectRef, bytes: Uint8Array, meta: { sha256: string }) {
    this.puts.push(this.k(o))
    this.target.set(this.k(o), { bytes: this.corruptOnPut ? new Uint8Array([...bytes, 9]) : bytes, sha256: meta.sha256 })
  }
  async readTarget(o: CopyObjectRef) {
    return this.target.get(this.k(o))!.bytes
  }
  async deleteTarget(o: CopyObjectRef) {
    this.deletes.push(this.k(o))
    this.target.delete(this.k(o))
  }
}

describe('copyObjectVerified', () => {
  const obj: CopyObjectRef = { bucket: 'branding', path: 'landing/1.jpg' }
  const bytes = new Uint8Array([1, 2, 3, 4])

  it('copies, reads back from the target and reports the sha256', async () => {
    const io = new FakeIo()
    io.source.set('branding/landing/1.jpg', { bytes, contentType: 'image/jpeg' })
    const r = await copyObjectVerified(io, obj)
    expect(r).toEqual({ status: 'copied', size: 4, sha256: sha256Hex(bytes) })
    expect(io.target.get('branding/landing/1.jpg')?.sha256).toBe(sha256Hex(bytes))
  })

  it('a rerun skips an object already verified there', async () => {
    const io = new FakeIo()
    io.source.set('branding/landing/1.jpg', { bytes, contentType: null })
    await copyObjectVerified(io, obj)
    io.puts.length = 0
    expect((await copyObjectVerified(io, obj)).status).toBe('already')
    expect(io.puts).toHaveLength(0)
  })

  it('a read-back that differs removes the bad R2 copy and fails', async () => {
    const io = new FakeIo()
    io.source.set('branding/landing/1.jpg', { bytes, contentType: null })
    io.corruptOnPut = true
    const r = await copyObjectVerified(io, obj)
    expect(r).toMatchObject({ status: 'failed', error: expect.stringMatching(/read-back/) })
    expect(io.deletes).toEqual(['branding/landing/1.jpg'])
    expect(io.target.size).toBe(0)
  })

  it('never overwrites a different object already at the target key', async () => {
    const io = new FakeIo()
    io.source.set('branding/landing/1.jpg', { bytes, contentType: null })
    io.target.set('branding/landing/1.jpg', { bytes: new Uint8Array([7]), sha256: 'other' })
    const r = await copyObjectVerified(io, obj)
    expect(r.status).toBe('conflict')
    expect(io.puts).toHaveLength(0)
    expect(io.target.get('branding/landing/1.jpg')?.bytes).toEqual(new Uint8Array([7]))
  })

  it('a target with no recorded hash is not trusted either', async () => {
    const io = new FakeIo()
    io.source.set('branding/landing/1.jpg', { bytes, contentType: null })
    io.target.set('branding/landing/1.jpg', { bytes, sha256: null })
    expect((await copyObjectVerified(io, obj)).status).toBe('conflict')
  })

  it('a source failure is a failed copy and writes nothing', async () => {
    const io = new FakeIo()
    io.failDownload = true
    const r = await copyObjectVerified(io, obj)
    expect(r.status).toBe('failed')
    expect(io.puts).toHaveLength(0)
  })

  it('the io contract has no way to delete from the source', () => {
    const io = new FakeIo()
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(io)).filter((m) => m !== 'constructor')
    expect(methods.filter((m) => /delete|remove/i.test(m))).toEqual(['deleteTarget'])
    expect(io.source.size).toBe(0)
  })
})
