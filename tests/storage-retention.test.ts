import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { PostgrestFilterBuilder, PostgrestQueryBuilder } from '@supabase/postgrest-js'
import {
  runStorageRetention,
  createSupabaseRetentionStore,
  RUN_BUDGET_MS,
  mergeExpiredMetadata,
  chatMediaPathFromUrl,
  extractChatMediaPaths,
  extractChatMediaRefs,
  chatMediaPathFromMediaUrl,
  screenshotBackendFromUrl,
  type R2Ops,
  type StorageBackend,
  type RetentionStore,
  type ScreenshotRow,
  type ChatMessageRow,
} from '@/lib/storage/retention'

const SUPA = 'https://proj.supabase.co'
const R2_BASE = 'https://media.xphere.app'
const PREFIX = `${SUPA}/storage/v1/object/public/chat-media/`
const NOW = new Date('2026-11-05T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const iso = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * DAY).toISOString()

const ORG_A = '11111111-1111-4111-8111-111111111111'
const ORG_B = '22222222-2222-4222-8222-222222222222'
const A1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const A2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'

const uid = (i: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`

const ALL_ON = {
  STORAGE_RETENTION_SCREENSHOTS_ENABLED: 'true',
  STORAGE_RETENTION_CHAT_ENABLED: 'true',
}

interface AnalysisRow {
  id: string
  desktop: string | null
  mobile: string | null
  analyzed_at: string
}

class FakeStore implements RetentionStore {
  analyses: AnalysisRow[] = []
  messages: Array<ChatMessageRow> = []
  objects = new Map<string, number>() // `${bucket}/${path}` -> size
  removeCalls: Array<{ bucket: string; paths: string[] }> = []
  /** Backend of each removeCalls entry, same index. */
  removeBackends: StorageBackend[] = []
  failRemoveWhen: (bucket: string, paths: string[], backend: StorageBackend) => boolean = () => false
  failMark = false
  failClear = false
  clearCalls: string[][] = []
  /** Called on listing/remove/reference calls so a test can advance a fake clock. */
  onCall: () => void = () => {}

  async listScreenshotRows({ cutoffIso, afterId, limit }: { cutoffIso: string; afterId: string | null; limit: number }) {
    this.onCall()
    return this.analyses
      .filter((a) => (a.desktop || a.mobile) && a.analyzed_at < cutoffIso && (!afterId || a.id > afterId))
      .sort((x, y) => (x.id < y.id ? -1 : 1))
      .slice(0, limit)
      .map((a): ScreenshotRow => ({ id: a.id, desktopUrl: a.desktop, mobileUrl: a.mobile }))
  }
  async clearScreenshotUrls(ids: string[]) {
    this.clearCalls.push(ids)
    if (this.failClear) return { error: 'clear failed' }
    for (const id of ids) {
      const a = this.analyses.find((r) => r.id === id)!
      a.desktop = null
      a.mobile = null
    }
    return { error: null }
  }
  async countEligibleScreenshots({ cutoffIso }: { cutoffIso: string }): Promise<number | null> {
    return this.analyses.filter((a) => (a.desktop || a.mobile) && a.analyzed_at < cutoffIso).length
  }
  async countEligibleChatMessages({ cutoffIso }: { cutoffIso: string }): Promise<number | null> {
    return this.messages.filter((m) => m.created_at < cutoffIso && !m.metadata?.media_expired_at).length
  }
  async listChatMessages({ cutoffIso, after, limit }: { cutoffIso: string; after: { createdAt: string; id: string } | null; limit: number }) {
    return this.messages
      .filter((m) => m.created_at < cutoffIso && !m.metadata?.media_expired_at)
      .filter((m) => !after || m.created_at > after.createdAt || (m.created_at === after.createdAt && m.id > after.id))
      .sort((x, y) => (x.created_at + x.id < y.created_at + y.id ? -1 : 1))
      .slice(0, limit)
  }
  async isReferencedSince({ orgId, path, sinceIso }: { orgId: string; path: string; sinceIso: string }) {
    this.onCall()
    return this.messages.some(
      (m) => m.org_id === orgId && m.created_at >= sinceIso && JSON.stringify(m.metadata?.media ?? []).includes(path),
    )
  }
  async markMediaExpired({ messageId, expiredAtIso }: { messageId: string; expiredAtIso: string }) {
    if (this.failMark) return { error: 'write failed' }
    const m = this.messages.find((r) => r.id === messageId)!
    m.metadata = mergeExpiredMetadata(m.metadata, expiredAtIso)
    return { error: null }
  }
  private objectKey(backend: StorageBackend, bucket: string, path: string) {
    return backend === 'r2' ? `r2:${bucket}/${path}` : `${bucket}/${path}`
  }
  async removeObjects(bucket: string, paths: string[], backend: StorageBackend = 'supabase') {
    this.removeCalls.push({ bucket, paths })
    this.removeBackends.push(backend)
    this.onCall()
    if (this.failRemoveWhen(bucket, paths, backend)) return { error: 'storage down' }
    for (const p of paths) this.objects.delete(this.objectKey(backend, bucket, p))
    return { error: null }
  }
  async statObjects(bucket: string, paths: string[], backend: StorageBackend = 'supabase') {
    const out = new Map<string, number>()
    for (const p of paths) {
      const s = this.objects.get(this.objectKey(backend, bucket, p))
      if (typeof s === 'number') out.set(p, s)
    }
    return out
  }

  addAnalysis(id: string, ageDays = 3) {
    this.analyses.push({ id, desktop: `${SUPA}/x/${id}/desktop.jpg`, mobile: `${SUPA}/x/${id}/mobile.jpg`, analyzed_at: iso(ageDays) })
    this.objects.set(`website-screenshots/${id}/desktop.jpg`, 100)
    this.objects.set(`website-screenshots/${id}/mobile.jpg`, 50)
  }
  addMessage(id: string, orgId: string, ageDays: number, path: string, extra: Record<string, unknown> = {}) {
    this.messages.push({
      id,
      org_id: orgId,
      created_at: iso(ageDays),
      metadata: { delivery_status: 'read', media: [{ url: PREFIX + path, mime_type: 'image/jpeg' }], ...extra },
    })
    this.objects.set(`chat-media/${path}`, 1000)
  }
  /** A message whose media is stored as the R2 `/api/media/chat-media/...` address. */
  addR2Message(id: string, orgId: string, ageDays: number, path: string, extra: Record<string, unknown> = {}) {
    this.messages.push({
      id,
      org_id: orgId,
      created_at: iso(ageDays),
      metadata: { media: [{ url: `/api/media/chat-media/${path}`, mime_type: 'image/jpeg' }], ...extra },
    })
    this.objects.set(`r2:chat-media/${path}`, 2000)
  }
  /** A screenshot row whose URLs sit under the R2 public base. */
  addR2Analysis(id: string, ageDays = 3, variants: Array<'desktop' | 'mobile'> = ['desktop', 'mobile']) {
    this.analyses.push({
      id,
      desktop: variants.includes('desktop') ? `${R2_BASE}/website-screenshots/${id}/desktop.jpg` : null,
      mobile: variants.includes('mobile') ? `${R2_BASE}/website-screenshots/${id}/mobile.jpg` : null,
      analyzed_at: iso(ageDays),
    })
    for (const v of variants) this.objects.set(`r2:website-screenshots/${id}/${v}.jpg`, 70)
  }
}

const run = (store: FakeStore, env: Record<string, string | undefined> = {}) =>
  runStorageRetention({ store, now: NOW, env, supabaseUrl: SUPA })

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

describe('simulation by default', () => {
  it('changes nothing but reports the targets and bytes', async () => {
    const s = new FakeStore()
    s.addAnalysis(A1)
    s.addMessage('m1', ORG_A, 40, `${ORG_A}/c1/m1/a.jpg`)
    const before = JSON.stringify([s.analyses, s.messages, [...s.objects]])

    const r = await run(s)

    expect(JSON.stringify([s.analyses, s.messages, [...s.objects]])).toBe(before)
    expect(s.removeCalls).toHaveLength(0)
    expect(r.screenshots).toMatchObject({ mode: 'simulation', rows: 1, objects: 2, bytes: 150, removedObjects: 0 })
    expect(r.chat).toMatchObject({ mode: 'simulation', messages: 1, objects: 1, bytes: 1000, removedObjects: 0, flaggedMessages: 0 })
  })

  it('treats anything other than exactly "true" as simulation', async () => {
    const s = new FakeStore()
    s.addAnalysis(A1)
    await run(s, { STORAGE_RETENTION_SCREENSHOTS_ENABLED: '1' })
    await run(s, { STORAGE_RETENTION_SCREENSHOTS_ENABLED: 'TRUE' })
    expect(s.removeCalls).toHaveLength(0)
  })
})

describe('independent flags', () => {
  it('screenshots enabled, chat not', async () => {
    const s = new FakeStore()
    s.addAnalysis(A1)
    s.addMessage('m1', ORG_A, 40, `${ORG_A}/c1/m1/a.jpg`)
    const r = await run(s, { STORAGE_RETENTION_SCREENSHOTS_ENABLED: 'true' })
    expect(r.screenshots.mode).toBe('live')
    expect(r.chat.mode).toBe('simulation')
    expect(s.objects.has(`website-screenshots/${A1}/desktop.jpg`)).toBe(false)
    expect(s.objects.has(`chat-media/${ORG_A}/c1/m1/a.jpg`)).toBe(true)
    expect(s.messages[0].metadata?.media_expired_at).toBeUndefined()
  })

  it('chat enabled, screenshots not', async () => {
    const s = new FakeStore()
    s.addAnalysis(A1)
    s.addMessage('m1', ORG_A, 40, `${ORG_A}/c1/m1/a.jpg`)
    const r = await run(s, { STORAGE_RETENTION_CHAT_ENABLED: 'true' })
    expect(r.screenshots.mode).toBe('simulation')
    expect(r.chat.mode).toBe('live')
    expect(s.objects.has(`website-screenshots/${A1}/desktop.jpg`)).toBe(true)
    expect(s.analyses[0].desktop).not.toBeNull()
    expect(s.objects.has(`chat-media/${ORG_A}/c1/m1/a.jpg`)).toBe(false)
    expect(s.messages[0].metadata?.media_expired_at).toBeTypeOf('string')
  })
})

describe('screenshots', () => {
  it('removes only the two exact paths derived from the row id, then clears the URLs, never the row', async () => {
    const s = new FakeStore()
    s.addAnalysis(A1)
    // A hostile URL text must not influence the path.
    s.analyses[0].desktop = `${SUPA}/storage/v1/object/public/website-screenshots/../../other/secret.jpg`
    s.objects.set('website-screenshots/other/secret.jpg', 9)

    const r = await run(s, ALL_ON)

    expect(s.removeCalls).toEqual([
      { bucket: 'website-screenshots', paths: [`${A1}/desktop.jpg`, `${A1}/mobile.jpg`] },
    ])
    expect(s.objects.has('website-screenshots/other/secret.jpg')).toBe(true)
    expect(s.analyses).toHaveLength(1)
    expect(s.analyses[0]).toMatchObject({ desktop: null, mobile: null })
    expect(r.screenshots).toMatchObject({ clearedRows: 1, removedObjects: 2, failedRows: 0 })
  })

  it('keeps the URLs when removal fails and reports the failure', async () => {
    const s = new FakeStore()
    s.addAnalysis(A1)
    s.failRemoveWhen = () => true
    const r = await run(s, ALL_ON)
    expect(s.analyses[0].desktop).not.toBeNull()
    expect(s.analyses[0].mobile).not.toBeNull()
    expect(r.screenshots.failedRows).toBe(1)
    expect(r.screenshots.clearedRows).toBe(0)
    expect(r.screenshots.failures[0]).toMatchObject({ id: A1 })
  })

  it('a failed batch removal clears no URLs, reports every row and stops the sweep', async () => {
    const s = new FakeStore()
    s.addAnalysis(A1)
    s.addAnalysis(A2)
    s.failRemoveWhen = () => true
    const r = await run(s, ALL_ON)
    expect(s.removeCalls).toHaveLength(1)
    expect(s.removeCalls[0].paths).toHaveLength(4)
    expect(s.clearCalls).toHaveLength(0)
    expect(s.analyses.every((a) => a.desktop && a.mobile)).toBe(true)
    expect(r.screenshots).toMatchObject({ failedRows: 2, clearedRows: 0, removedObjects: 0, truncated: true })
  })

  it('removes a whole page in ONE call and clears its rows by ids in ONE call', async () => {
    const s = new FakeStore()
    s.addAnalysis(A1)
    s.addAnalysis(A2)
    const r = await run(s, ALL_ON)
    expect(s.removeCalls).toEqual([
      {
        bucket: 'website-screenshots',
        paths: [`${A1}/desktop.jpg`, `${A1}/mobile.jpg`, `${A2}/desktop.jpg`, `${A2}/mobile.jpg`],
      },
    ])
    expect(s.clearCalls).toEqual([[A1, A2]])
    expect(r.screenshots).toMatchObject({ rows: 2, removedObjects: 4, clearedRows: 2, failedRows: 0, bytes: 0 })
  })

  it('a failed clear is reported and leaves the rows for the next run', async () => {
    const s = new FakeStore()
    s.addAnalysis(A1)
    s.failClear = true
    const r = await run(s, ALL_ON)
    expect(r.screenshots).toMatchObject({ failedRows: 1, clearedRows: 0 })
    s.failClear = false
    const r2 = await run(s, ALL_ON)
    expect(r2.screenshots.clearedRows).toBe(1)
  })

  it('simulation samples sizes from the first page only', async () => {
    const s = new FakeStore()
    for (let i = 0; i < 150; i++) s.addAnalysis(uid(i))
    const stat = vi.spyOn(s, 'statObjects')
    const r = await run(s)
    expect(stat).toHaveBeenCalledTimes(1)
    expect(r.screenshots).toMatchObject({ rows: 150, objects: 300, bytesSampled: true })
    // First page = 100 rows of 150 bytes each.
    expect(r.screenshots.bytes).toBe(100 * 150)
  })

  it('ignores rows younger than one day and is idempotent on repeat', async () => {
    const s = new FakeStore()
    s.addAnalysis(A1, 0.5)
    s.addAnalysis(A2, 3)
    await run(s, ALL_ON)
    expect(s.analyses.find((a) => a.id === A1)!.desktop).not.toBeNull()
    expect(s.analyses.find((a) => a.id === A2)!.desktop).toBeNull()
    s.removeCalls.length = 0
    await run(s, ALL_ON)
    expect(s.removeCalls).toHaveLength(0)
  })
})

describe('chat media', () => {
  it('removes the object, flags the message, keeps text and every metadata key', async () => {
    const s = new FakeStore()
    const path = `${ORG_A}/c1/m1/a.jpg`
    s.addMessage('m1', ORG_A, 40, path, { note: 'keep me' })
    const r = await run(s, ALL_ON)
    expect(s.removeCalls).toEqual([{ bucket: 'chat-media', paths: [path] }])
    expect(s.messages[0].metadata).toMatchObject({
      delivery_status: 'read',
      note: 'keep me',
      media: [{ url: PREFIX + path, mime_type: 'image/jpeg' }],
      media_expired_at: NOW.toISOString(),
    })
    expect(r.chat).toMatchObject({ removedObjects: 1, flaggedMessages: 1 })
  })

  it('skips a path whose first segment is not the message org', async () => {
    const s = new FakeStore()
    s.addMessage('m1', ORG_A, 40, `${ORG_B}/c1/m1/a.jpg`)
    const r = await run(s, ALL_ON)
    expect(s.removeCalls).toHaveLength(0)
    expect(s.objects.has(`chat-media/${ORG_B}/c1/m1/a.jpg`)).toBe(true)
    expect(s.messages[0].metadata?.media_expired_at).toBeUndefined()
    expect(r.chat.skippedCrossOrg).toBe(1)
  })

  it('keeps an object still referenced by a newer message', async () => {
    const s = new FakeStore()
    const path = `${ORG_A}/c1/shared/a.jpg`
    s.addMessage('old', ORG_A, 40, path)
    s.addMessage('new', ORG_A, 2, path)
    const r = await run(s, ALL_ON)
    expect(s.removeCalls).toHaveLength(0)
    expect(s.objects.has(`chat-media/${path}`)).toBe(true)
    expect(s.messages.find((m) => m.id === 'old')!.metadata?.media_expired_at).toBeUndefined()
    expect(r.chat.skippedReferenced).toBe(1)
  })

  it('never reprocesses an already-flagged message', async () => {
    const s = new FakeStore()
    s.addMessage('m1', ORG_A, 40, `${ORG_A}/c1/m1/a.jpg`, { media_expired_at: '2026-10-01T00:00:00.000Z' })
    const r = await run(s, ALL_ON)
    expect(s.removeCalls).toHaveLength(0)
    expect(r.chat.messages).toBe(0)
    expect(s.messages[0].metadata?.media_expired_at).toBe('2026-10-01T00:00:00.000Z')
  })

  it('leaves messages younger than the retention alone', async () => {
    const s = new FakeStore()
    s.addMessage('m1', ORG_A, 10, `${ORG_A}/c1/m1/a.jpg`)
    await run(s, ALL_ON)
    expect(s.removeCalls).toHaveLength(0)
  })

  it('ignores URLs that are not this project chat-media (proxy, other host)', async () => {
    const s = new FakeStore()
    s.addMessage('m1', ORG_A, 40, `${ORG_A}/c1/m1/a.jpg`)
    s.messages[0].metadata = {
      media: [
        { url: 'https://other.example.com/storage/v1/object/public/chat-media/' + ORG_A + '/a.jpg', mime_type: 'image/jpeg' },
        { url: '/api/zernio/media?u=abc', mime_type: 'image/jpeg' },
      ],
    }
    await run(s, ALL_ON)
    expect(s.removeCalls).toHaveLength(0)
  })

  it('one org failing does not stop the others', async () => {
    const s = new FakeStore()
    s.addMessage('mA', ORG_A, 40, `${ORG_A}/c1/mA/a.jpg`)
    s.addMessage('mB', ORG_B, 39, `${ORG_B}/c1/mB/a.jpg`)
    s.failRemoveWhen = (_b, paths) => paths[0].startsWith(ORG_A)
    const r = await run(s, ALL_ON)
    expect(s.messages.find((m) => m.id === 'mA')!.metadata?.media_expired_at).toBeUndefined()
    expect(s.messages.find((m) => m.id === 'mB')!.metadata?.media_expired_at).toBeTypeOf('string')
    expect(r.chat.orgs[ORG_A].failedMessages).toBe(1)
    expect(r.chat.orgs[ORG_B].flaggedMessages).toBe(1)
  })

  it('a failed flag write is reported and a repeat run finishes the job', async () => {
    const s = new FakeStore()
    s.addMessage('m1', ORG_A, 40, `${ORG_A}/c1/m1/a.jpg`)
    s.failMark = true
    const r1 = await run(s, ALL_ON)
    expect(r1.chat.failedMessages).toBe(1)
    s.failMark = false
    const r2 = await run(s, ALL_ON)
    expect(r2.chat.flaggedMessages).toBe(1)
    expect(s.messages[0].metadata?.media_expired_at).toBeTypeOf('string')
  })
})

describe('chat media on R2 and mixed databases', () => {
  const R2_PATH = `${ORG_A}/c1/m1/a.jpg`

  it('removes an /api/media chat-media object through the R2 backend and flags the message', async () => {
    const s = new FakeStore()
    s.addR2Message('m1', ORG_A, 40, R2_PATH)
    const r = await run(s, ALL_ON)
    expect(s.removeCalls).toEqual([{ bucket: 'chat-media', paths: [R2_PATH] }])
    expect(s.removeBackends).toEqual(['r2'])
    expect(s.objects.has(`r2:chat-media/${R2_PATH}`)).toBe(false)
    expect(s.messages[0].metadata?.media_expired_at).toBe(NOW.toISOString())
    expect(r.chat).toMatchObject({ messages: 1, objects: 1, bytes: 2000, removedObjects: 1, flaggedMessages: 1 })
  })

  it('simulation counts R2 objects and sizes without removing anything', async () => {
    const s = new FakeStore()
    s.addR2Message('m1', ORG_A, 40, R2_PATH)
    const r = await run(s)
    expect(s.removeCalls).toHaveLength(0)
    expect(r.chat).toMatchObject({ mode: 'simulation', messages: 1, objects: 1, bytes: 2000 })
  })

  it('applies the first-segment-must-equal-org rule to the R2 form', async () => {
    const s = new FakeStore()
    s.addR2Message('m1', ORG_A, 40, `${ORG_B}/c1/m1/a.jpg`)
    const r = await run(s, ALL_ON)
    expect(s.removeCalls).toHaveLength(0)
    expect(r.chat.skippedCrossOrg).toBe(1)
    expect(s.messages[0].metadata?.media_expired_at).toBeUndefined()
  })

  it('ignores /api/media addresses for other buckets, traversal and absolute foreign hosts', async () => {
    const s = new FakeStore()
    s.addR2Message('m1', ORG_A, 40, R2_PATH)
    s.messages[0].metadata = {
      media: [
        { url: `/api/media/recordings/${ORG_A}/x.webm` },
        { url: `/api/media/chat-media/${ORG_A}/../${ORG_B}/x.jpg` },
        { url: `/api/media/chat-media/${ORG_A}/%2e%2e/x.jpg` },
        { url: `https://evil.example.com/api/media/chat-media/${ORG_A}/x.jpg` },
      ],
    }
    await run(s, ALL_ON)
    expect(s.removeCalls).toHaveLength(0)
    expect(chatMediaPathFromMediaUrl(`/api/media/chat-media/${ORG_A}/a.jpg?x=1`)).toBe(`${ORG_A}/a.jpg`)
  })

  it('a message mixing both forms removes each object from its own backend', async () => {
    const s = new FakeStore()
    s.addMessage('m1', ORG_A, 40, `${ORG_A}/c1/m1/old.jpg`)
    s.objects.set(`r2:chat-media/${ORG_A}/c1/m1/new.jpg`, 5)
    s.messages[0].metadata = {
      media: [
        { url: PREFIX + `${ORG_A}/c1/m1/old.jpg` },
        { url: `/api/media/chat-media/${ORG_A}/c1/m1/new.jpg` },
      ],
    }
    const r = await run(s, ALL_ON)
    expect(s.removeCalls).toEqual([
      { bucket: 'chat-media', paths: [`${ORG_A}/c1/m1/old.jpg`] },
      { bucket: 'chat-media', paths: [`${ORG_A}/c1/m1/new.jpg`] },
    ])
    expect(s.removeBackends).toEqual(['supabase', 'r2'])
    expect(r.chat).toMatchObject({ objects: 2, removedObjects: 2, flaggedMessages: 1 })
  })

  it('a failing R2 removal flags nothing; the retry removes only what is left', async () => {
    const s = new FakeStore()
    s.addR2Message('m1', ORG_A, 40, R2_PATH)
    s.failRemoveWhen = (_b, _p, backend) => backend === 'r2'
    const r1 = await run(s, ALL_ON)
    expect(r1.chat).toMatchObject({ failedMessages: 1, flaggedMessages: 0, removedObjects: 0 })
    expect(s.messages[0].metadata?.media_expired_at).toBeUndefined()
    expect(s.objects.has(`r2:chat-media/${R2_PATH}`)).toBe(true)
    s.failRemoveWhen = () => false
    const r2 = await run(s, ALL_ON)
    expect(r2.chat.flaggedMessages).toBe(1)
  })

  it('keeps an R2 object still referenced by a newer message', async () => {
    const s = new FakeStore()
    s.addR2Message('old', ORG_A, 40, R2_PATH)
    s.addR2Message('new', ORG_A, 2, R2_PATH)
    const r = await run(s, ALL_ON)
    expect(s.removeCalls).toHaveLength(0)
    expect(r.chat.skippedReferenced).toBe(1)
  })

  it('extractChatMediaRefs reports the backend of each URL and dedupes per backend', () => {
    const md = {
      media: [
        { url: `${PREFIX}${ORG_A}/a.jpg`, thumbnail_url: `/api/media/chat-media/${ORG_A}/t.jpg` },
        { url: `/api/media/chat-media/${ORG_A}/a.jpg` },
        { url: `/api/media/chat-media/${ORG_A}/a.jpg` },
      ],
    }
    expect(extractChatMediaRefs(md, PREFIX)).toEqual([
      { path: `${ORG_A}/a.jpg`, backend: 'supabase' },
      { path: `${ORG_A}/t.jpg`, backend: 'r2' },
      { path: `${ORG_A}/a.jpg`, backend: 'r2' },
    ])
    expect(extractChatMediaPaths(md, PREFIX).sort()).toEqual([`${ORG_A}/a.jpg`, `${ORG_A}/t.jpg`])
  })
})

describe('screenshots on R2 and mixed batches', () => {
  const runR2 = (store: FakeStore) =>
    runStorageRetention({ store, now: NOW, env: { ...ALL_ON, R2_PUBLIC_BASE_URL: R2_BASE }, supabaseUrl: SUPA })

  it('decides the backend from the stored URL', () => {
    expect(screenshotBackendFromUrl(`${R2_BASE}/website-screenshots/${A1}/desktop.jpg`, R2_BASE)).toBe('r2')
    expect(screenshotBackendFromUrl(`${R2_BASE}/website-screenshots/${A1}/desktop.jpg`, `${R2_BASE}/`)).toBe('r2')
    expect(
      screenshotBackendFromUrl(`${SUPA}/storage/v1/object/public/website-screenshots/${A1}/desktop.jpg`, R2_BASE),
    ).toBe('supabase')
    expect(screenshotBackendFromUrl(`${R2_BASE}.evil.com/x`, R2_BASE)).toBe('supabase')
    // No R2 env: everything is Supabase, as before the cut-over.
    expect(screenshotBackendFromUrl(`${R2_BASE}/website-screenshots/${A1}/desktop.jpg`, undefined)).toBe('supabase')
  })

  it('an R2 row is removed through R2 with the path from the row id alone, then cleared', async () => {
    const s = new FakeStore()
    s.addR2Analysis(A1)
    s.analyses[0].desktop = `${R2_BASE}/website-screenshots/../../other/secret.jpg`
    const r = await runR2(s)
    expect(s.removeCalls).toEqual([{ bucket: 'website-screenshots', paths: [`${A1}/desktop.jpg`, `${A1}/mobile.jpg`] }])
    expect(s.removeBackends).toEqual(['r2'])
    expect(s.analyses[0]).toMatchObject({ desktop: null, mobile: null })
    expect(r.screenshots).toMatchObject({ rows: 1, removedObjects: 2, clearedRows: 1, failedRows: 0 })
  })

  it('a mixed batch removes per backend and clears every row in one call', async () => {
    const s = new FakeStore()
    s.addAnalysis(A1)
    s.addR2Analysis(A2)
    const r = await runR2(s)
    expect(s.removeBackends).toEqual(['supabase', 'r2'])
    expect(s.removeCalls.map((c) => c.paths)).toEqual([
      [`${A1}/desktop.jpg`, `${A1}/mobile.jpg`],
      [`${A2}/desktop.jpg`, `${A2}/mobile.jpg`],
    ])
    expect(s.clearCalls).toEqual([[A1, A2]])
    expect(r.screenshots).toMatchObject({ rows: 2, removedObjects: 4, clearedRows: 2, failedRows: 0 })
  })

  it('clears only the rows whose backend succeeded when the other backend fails', async () => {
    const s = new FakeStore()
    s.addAnalysis(A1)
    s.addR2Analysis(A2)
    s.failRemoveWhen = (_b, _p, backend) => backend === 'r2'
    const r = await runR2(s)
    expect(s.clearCalls).toEqual([[A1]])
    expect(s.analyses.find((a) => a.id === A1)).toMatchObject({ desktop: null, mobile: null })
    expect(s.analyses.find((a) => a.id === A2)!.desktop).not.toBeNull()
    expect(s.objects.has(`r2:website-screenshots/${A2}/desktop.jpg`)).toBe(true)
    expect(r.screenshots).toMatchObject({ clearedRows: 1, failedRows: 1, removedObjects: 2, truncated: true })
    expect(r.screenshots.failures[0]).toMatchObject({ id: A2 })
  })

  it('a row with one Supabase and one R2 variant stays untouched if either backend fails', async () => {
    const s = new FakeStore()
    s.addAnalysis(A1)
    s.analyses[0].mobile = `${R2_BASE}/website-screenshots/${A1}/mobile.jpg`
    s.objects.set(`r2:website-screenshots/${A1}/mobile.jpg`, 1)
    s.failRemoveWhen = (_b, _p, backend) => backend === 'r2'
    const r = await runR2(s)
    expect(s.clearCalls).toHaveLength(0)
    expect(s.analyses[0].desktop).not.toBeNull()
    expect(r.screenshots).toMatchObject({ clearedRows: 0, failedRows: 1 })
  })

  it('without R2 env every row goes to Supabase, exactly as before', async () => {
    const s = new FakeStore()
    s.addR2Analysis(A1) // an R2-looking URL but no R2 base configured
    await run(s, ALL_ON)
    expect(s.removeBackends).toEqual(['supabase'])
  })
})

describe('totals', () => {
  it('reports the real eligible totals even when the run is capped, in both modes', async () => {
    const s = new FakeStore()
    for (let i = 0; i < 350; i++) s.addAnalysis(uid(i))
    s.addMessage('m1', ORG_A, 40, `${ORG_A}/c1/m1/a.jpg`)
    s.addMessage('m2', ORG_A, 41, `${ORG_A}/c1/m2/a.jpg`)

    const sim = await run(s)
    expect(sim.screenshots).toMatchObject({ rows: 300, totalEligibleRows: 350, truncated: true })
    expect(sim.chat).toMatchObject({ messages: 2, totalEligibleMessages: 2 })

    const live = await run(s, ALL_ON)
    expect(live.screenshots.totalEligibleRows).toBe(350)
    expect(live.chat.totalEligibleMessages).toBe(2)
  })

  it('reports null when a count is unavailable instead of failing the sweep', async () => {
    const s = new FakeStore()
    s.addAnalysis(A1)
    s.countEligibleScreenshots = async () => {
      throw new Error('boom')
    }
    const r = await run(s)
    expect(r.screenshots).toMatchObject({ rows: 1, totalEligibleRows: null })
  })
})

describe('time budget', () => {
  it('stops screenshots between pages with truncated: true', async () => {
    const s = new FakeStore()
    for (let i = 0; i < 250; i++) s.addAnalysis(uid(i))
    let t = 0
    // Each page listing costs 40s of fake time (live mode adds a removal call too):
    // the run is past the 60s budget before it can finish 250 rows.
    s.onCall = () => {
      t += 40_000
    }
    const r = await runStorageRetention({ store: s, now: NOW, env: ALL_ON, supabaseUrl: SUPA, clock: () => t })
    expect(RUN_BUDGET_MS).toBe(60_000)
    expect(r.screenshots.truncated).toBe(true)
    expect(r.screenshots.rows).toBeGreaterThan(0)
    expect(r.screenshots.rows).toBeLessThan(250)
  })

  it('stops chat between messages with truncated: true', async () => {
    const s = new FakeStore()
    for (let i = 0; i < 5; i++) s.addMessage(`m${i}`, ORG_A, 40 + i, `${ORG_A}/c1/m${i}/a.jpg`)
    let t = 0
    s.onCall = () => {
      t += 30_000
    }
    const r = await runStorageRetention({ store: s, now: NOW, env: ALL_ON, supabaseUrl: SUPA, clock: () => t })
    expect(r.chat.truncated).toBe(true)
    expect(r.chat.scannedMessages).toBeLessThan(5)
  })

  it('does not truncate when the clock stays inside the budget', async () => {
    const s = new FakeStore()
    s.addAnalysis(A1)
    const r = await runStorageRetention({ store: s, now: NOW, env: ALL_ON, supabaseUrl: SUPA, clock: () => 0 })
    expect(r.screenshots.truncated).toBe(false)
    expect(r.chat.truncated).toBe(false)
  })
})

describe('supabase adapter query shape', () => {
  // Fake client whose query builders only accept methods that exist on the REAL
  // postgrest-js builders, so a call like .and(...) fails here instead of in prod.
  type Call = { table: string; method: string; args: unknown[] }
  type Result = { data?: unknown; count?: number | null; error?: { message: string } | null }
  const real = (name: string) => name in PostgrestFilterBuilder.prototype || name in PostgrestQueryBuilder.prototype

  function fakeClient(results: Record<string, Result> = {}) {
    const calls: Call[] = []
    const builder = (table: string): unknown => {
      const proxy: unknown = new Proxy(
        {},
        {
          get(_t, prop) {
            if (typeof prop !== 'string') return undefined
            if (prop === 'then') {
              const res = { data: [], count: 0, error: null, ...(results[table] ?? {}) }
              return (resolve: (v: unknown) => unknown) => resolve(res)
            }
            if (!real(prop)) throw new Error(`${prop}() does not exist on the real postgrest-js builder`)
            return (...args: unknown[]) => {
              calls.push({ table, method: prop, args })
              return proxy
            }
          },
        },
      )
      return proxy
    }
    const storageCalls: Array<{ bucket: string; op: string; args: unknown[] }> = []
    const client = {
      from: (table: string) => builder(table),
      storage: {
        from: (bucket: string) => ({
          remove: async (...args: unknown[]) => {
            storageCalls.push({ bucket, op: 'remove', args })
            return { error: null }
          },
        }),
      },
    } as unknown as SupabaseClient
    return { client, calls, storageCalls }
  }

  const cutoff = '2026-11-04T12:00:00.000Z'

  it('the fake rejects methods the real builder lacks (and() in particular)', () => {
    expect(real('and')).toBe(false)
    expect(real('or')).toBe(true)
    expect(real('in')).toBe(true)
    const { client } = fakeClient()
    expect(() => (client.from('t') as unknown as { and: (s: string) => unknown }).and('x')).toThrow(/does not exist/)
  })

  it('listScreenshotRows chains two or() calls, quotes timestamps and never uses and()', async () => {
    const { client, calls } = fakeClient()
    await createSupabaseRetentionStore(client).listScreenshotRows({ cutoffIso: cutoff, afterId: A1, limit: 100 })
    const ors = calls.filter((c) => c.method === 'or').map((c) => String(c.args[0]))
    expect(ors).toHaveLength(2)
    expect(ors[0]).toBe('screenshot_desktop_url.not.is.null,screenshot_mobile_url.not.is.null')
    expect(ors[1]).toBe(`analyzed_at.lt."${cutoff}",and(analyzed_at.is.null,created_at.lt."${cutoff}")`)
    expect(calls.some((c) => c.method === 'and')).toBe(false)
    expect(calls.find((c) => c.method === 'gt')?.args).toEqual(['id', A1])
  })

  it('listChatMessages quotes the keyset cursor timestamps', async () => {
    const { client, calls } = fakeClient()
    const createdAt = '2026-10-01T10:00:00.123+00:00'
    await createSupabaseRetentionStore(client).listChatMessages({
      cutoffIso: cutoff,
      after: { createdAt, id: 'm1' },
      limit: 10,
    })
    const or = calls.filter((c) => c.method === 'or').at(-1)
    expect(or?.args[0]).toBe(`created_at.gt."${createdAt}",and(created_at.eq."${createdAt}",id.gt.m1)`)
  })

  it('clearScreenshotUrls clears by ids with in(), and skips the call for no ids', async () => {
    const { client, calls } = fakeClient()
    const store = createSupabaseRetentionStore(client)
    expect(await store.clearScreenshotUrls([])).toEqual({ error: null })
    expect(calls).toHaveLength(0)
    expect(await store.clearScreenshotUrls([A1, A2])).toEqual({ error: null })
    expect(calls.find((c) => c.method === 'in')?.args).toEqual(['id', [A1, A2]])
    expect(calls.find((c) => c.method === 'update')?.args[0]).toEqual({
      screenshot_desktop_url: null,
      screenshot_mobile_url: null,
    })
  })

  it('count queries use head/exact counts and return null on error', async () => {
    const ok = fakeClient({ website_analyses: { count: 42 }, conversation_messages: { count: 7 } })
    const store = createSupabaseRetentionStore(ok.client)
    expect(await store.countEligibleScreenshots({ cutoffIso: cutoff })).toBe(42)
    expect(await store.countEligibleChatMessages({ cutoffIso: cutoff })).toBe(7)
    const selects = ok.calls.filter((c) => c.method === 'select')
    expect(selects.every((c) => (c.args[1] as { head?: boolean }).head === true)).toBe(true)
    // 2 for the screenshot count + 1 for the chat count (both URL forms).
    expect(ok.calls.filter((c) => c.method === 'or')).toHaveLength(3)

    const bad = fakeClient({ website_analyses: { error: { message: 'x' } } })
    expect(await createSupabaseRetentionStore(bad.client).countEligibleScreenshots({ cutoffIso: cutoff })).toBeNull()
  })

  it('removeObjects sends one remove call with every path', async () => {
    const { client, storageCalls } = fakeClient()
    await createSupabaseRetentionStore(client).removeObjects('website-screenshots', ['a/b.jpg', 'c/d.jpg'])
    expect(storageCalls).toEqual([{ bucket: 'website-screenshots', op: 'remove', args: [['a/b.jpg', 'c/d.jpg']] }])
  })

  // ── both backends ──────────────────────────────────────────────────────────
  const storageClient = () => {
    const removed: Array<{ bucket: string; paths: string[] }> = []
    const client = {
      storage: {
        from: (bucket: string) => ({
          remove: async (paths: string[]) => {
            removed.push({ bucket, paths })
            return { error: null }
          },
          list: async () => ({ data: [{ name: 'a.jpg', metadata: { size: 11 } }] }),
        }),
      },
    } as unknown as SupabaseClient
    return { client, removed }
  }
  const r2Ops = (enabled: boolean) => {
    const removed: Array<{ bucket: string; paths: string[] }> = []
    const ops: R2Ops = {
      isEnabled: () => enabled,
      remove: async (bucket, paths) => {
        removed.push({ bucket, paths })
        return { error: null }
      },
      list: async () => ({ data: [{ name: 'a.jpg', size: 22 }], error: null }),
    }
    return { ops, removed }
  }

  it('routes an R2 removal to R2 only and a Supabase removal to Supabase only', async () => {
    const { client, removed } = storageClient()
    const r2 = r2Ops(true)
    const store = createSupabaseRetentionStore(client, { r2: r2.ops })
    expect(await store.removeObjects('chat-media', ['o/a.jpg'], 'r2')).toEqual({ error: null })
    expect(r2.removed).toEqual([{ bucket: 'chat-media', paths: ['o/a.jpg'] }])
    expect(removed).toHaveLength(0)
    expect(await store.removeObjects('chat-media', ['o/b.jpg'])).toEqual({ error: null })
    expect(removed).toEqual([{ bucket: 'chat-media', paths: ['o/b.jpg'] }])
    expect(r2.removed).toHaveLength(1)
  })

  it('an R2 removal never falls back to Supabase: no ops or bucket not on R2 is an error', async () => {
    const { client, removed } = storageClient()
    const none = createSupabaseRetentionStore(client)
    expect((await none.removeObjects('chat-media', ['o/a.jpg'], 'r2')).error).toMatch(/not wired/)
    const off = createSupabaseRetentionStore(client, { r2: r2Ops(false).ops })
    expect((await off.removeObjects('chat-media', ['o/a.jpg'], 'r2')).error).toMatch(/not enabled/)
    expect(removed).toHaveLength(0)
  })

  it('statObjects reads sizes from the named backend', async () => {
    const { client } = storageClient()
    const store = createSupabaseRetentionStore(client, { r2: r2Ops(true).ops })
    expect((await store.statObjects('chat-media', ['d/a.jpg'], 'supabase')).get('d/a.jpg')).toBe(11)
    expect((await store.statObjects('chat-media', ['d/a.jpg'], 'r2')).get('d/a.jpg')).toBe(22)
    expect((await createSupabaseRetentionStore(client).statObjects('chat-media', ['d/a.jpg'], 'r2')).size).toBe(0)
  })

  // Emulates PostgREST ilike (case-insensitive; % and * are wildcards) on a metadata JSON text.
  const likeMatches = (pattern: string, text: string) => {
    const body = pattern
      .split(/[%*]/)
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')
    return new RegExp(`^${body}$`, 'i').test(text)
  }

  const SUPA_JSON = JSON.stringify({ media: [{ url: `${PREFIX}${ORG_A}/c/a.jpg` }] })
  const R2_JSON = JSON.stringify({ media: [{ url: `/api/media/chat-media/${ORG_A}/c/a.jpg` }] })
  const OTHER_JSON = JSON.stringify({ media: [{ url: '/api/zernio/media?u=abc' }] })

  it('the listing and count filters match both address forms and nothing else', async () => {
    const { client, calls } = fakeClient()
    const store = createSupabaseRetentionStore(client)
    await store.listChatMessages({ cutoffIso: cutoff, after: null, limit: 10 })
    await store.countEligibleChatMessages({ cutoffIso: cutoff })
    const filters = calls.filter((c) => c.method === 'or').map((c) => String(c.args[0]))
    expect(filters).toHaveLength(2)
    expect(filters[0]).toBe(filters[1])
    expect(calls.some((c) => c.method === 'ilike')).toBe(false)
    const patterns = filters[0].split(',').map((f) => {
      expect(f.startsWith('metadata->>media.ilike.')).toBe(true)
      return f.slice('metadata->>media.ilike.'.length)
    })
    const matches = (text: string) => patterns.some((p) => likeMatches(p, text))
    expect(matches(SUPA_JSON)).toBe(true)
    expect(matches(R2_JSON)).toBe(true)
    expect(matches(OTHER_JSON)).toBe(false)
  })

  it('isReferencedSince matches a reference in either form', async () => {
    const { client, calls } = fakeClient({ conversation_messages: { count: 1 } })
    const store = createSupabaseRetentionStore(client)
    expect(await store.isReferencedSince({ orgId: ORG_A, path: `${ORG_A}/c/a.jpg`, sinceIso: cutoff })).toBe(true)
    const pattern = String(calls.find((c) => c.method === 'ilike')!.args[1])
    expect(likeMatches(pattern, SUPA_JSON)).toBe(true)
    expect(likeMatches(pattern, R2_JSON)).toBe(true)
    expect(likeMatches(pattern, OTHER_JSON)).toBe(false)
  })
})

describe('pure helpers', () => {
  it('mergeExpiredMetadata preserves keys and tolerates null', () => {
    expect(mergeExpiredMetadata({ a: 1, media: [] }, 'T')).toEqual({ a: 1, media: [], media_expired_at: 'T' })
    expect(mergeExpiredMetadata(null, 'T')).toEqual({ media_expired_at: 'T' })
  })

  it('chatMediaPathFromUrl rejects traversal, foreign hosts and odd characters', () => {
    expect(chatMediaPathFromUrl(`${PREFIX}${ORG_A}/c/m/1-0.jpg?x=1`, PREFIX)).toBe(`${ORG_A}/c/m/1-0.jpg`)
    expect(chatMediaPathFromUrl(`${PREFIX}${ORG_A}/../x.jpg`, PREFIX)).toBeNull()
    expect(chatMediaPathFromUrl(`${PREFIX}${ORG_A}/%2e%2e/x.jpg`, PREFIX)).toBeNull()
    expect(chatMediaPathFromUrl(`${PREFIX}${ORG_A}/a%25b.jpg`, PREFIX)).toBeNull()
    expect(chatMediaPathFromUrl('https://evil.com/x', PREFIX)).toBeNull()
    expect(chatMediaPathFromUrl(undefined, PREFIX)).toBeNull()
  })

  it('extractChatMediaPaths reads url and thumbnail_url only', () => {
    const md = {
      media: [{ url: `${PREFIX}${ORG_A}/a.jpg`, thumbnail_url: `${PREFIX}${ORG_A}/t.jpg`, original_url: `${PREFIX}${ORG_A}/o.jpg` }],
    }
    expect(extractChatMediaPaths(md, PREFIX).sort()).toEqual([`${ORG_A}/a.jpg`, `${ORG_A}/t.jpg`])
  })
})

describe('cron route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.doMock('@/lib/supabase/admin', () => ({ createServiceRoleClient: () => ({}) }))
    vi.doMock('@/lib/api-error', () => ({ captureApiError: () => {} }))
  })

  it('rejects a bad secret', async () => {
    vi.stubEnv('CRON_SECRET', 'right')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPA)
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'k')
    const { GET } = await import('@/app/api/cron/storage-retention/route')
    const res = await GET(new Request('http://x/api/cron/storage-retention', { headers: { authorization: 'Bearer wrong' } }))
    expect(res.status).toBe(401)
    const none = await GET(new Request('http://x/api/cron/storage-retention'))
    expect(none.status).toBe(401)
    vi.unstubAllEnvs()
  })

  it('fails closed when CRON_SECRET is not configured', async () => {
    vi.stubEnv('CRON_SECRET', '')
    const { GET } = await import('@/app/api/cron/storage-retention/route')
    const res = await GET(new Request('http://x/', { headers: { authorization: 'Bearer ' } }))
    expect(res.status).toBe(503)
    vi.unstubAllEnvs()
  })
})
