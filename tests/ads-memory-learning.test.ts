import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FakeDb } from './helpers/fake-supabase'

const state = vi.hoisted(() => ({ db: null as unknown }))

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => state.db,
}))
vi.mock('@/lib/integrations/get-provider-key', () => ({
  getProviderKey: vi.fn(async (provider: string) => (provider === 'openrouter' ? 'org-openrouter-key' : null)),
}))
vi.mock('@/lib/platform-settings', () => ({
  getPlatformSetting: vi.fn(async () => null),
}))
vi.mock('@/lib/knowledge/embed', () => ({
  embed: vi.fn(async () => [0.1, 0.2, 0.3]),
  embedBatch: vi.fn(async (texts: string[]) => texts.map(() => [0.4, 0.5, 0.6])),
}))

import {
  backfillMemoryEmbeddings,
  coerceKnowledgeRefs,
  createMemory,
  memoryEmbeddingText,
  toAdsMemory,
  updateMemory,
} from '@/lib/ads/journey-db'
import {
  ADS_MEMORY_MIN_SIMILARITY,
  memorySearchLimit,
  memorySearchStatuses,
  searchMemoriesSemantic,
  selectMemoryMatches,
} from '@/lib/ads/memory-search'
import { embed } from '@/lib/knowledge/embed'

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER_ORG = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const SOURCE_A = '11111111-1111-4111-8111-111111111111'
const SOURCE_B = '22222222-2222-4222-8222-222222222222'

function freshDb(): FakeDb {
  const db = new FakeDb()
  db.rows('ads_journey').push({ id: 'journey-1', org_id: ORG })
  state.db = db
  return db
}

function memoryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    org_id: ORG,
    journey_id: 'journey-1',
    type: 'decision',
    status: 'active',
    source: 'mcp',
    platform: 'meta',
    title: 'Keep CBO on prospecting',
    content: 'CBO beat ABO for prospecting in Q3.',
    campaign_id: null,
    campaign_name: null,
    confidence: 3,
    proposed: false,
    metadata: {},
    knowledge_refs: [],
    change_request_id: null,
    superseded_by: null,
    embedding: null,
    embedded_at: null,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    ...overrides,
  }
}

describe('knowledge ref coercion', () => {
  it('dedupes by source, accepts stored (nullable) refs, and drops invalid ones', () => {
    const refs = coerceKnowledgeRefs([
      { source_id: SOURCE_A, source_name: '  CBO lesson ', url: 'https://www.notion.so/cbo' },
      { source_id: SOURCE_A, source_name: 'duplicate' },
      { source_id: SOURCE_B, source_name: null, url: null },
      { source_id: 'not-a-uuid', source_name: 'bad' },
      { source_id: SOURCE_B.replace('2222', '3333'), url: 'not a url' },
    ])
    expect(refs).toEqual([
      { source_id: SOURCE_A, source_name: 'CBO lesson', url: 'https://www.notion.so/cbo' },
      { source_id: SOURCE_B, source_name: null, url: null },
    ])
  })

  it('returns [] for nothing', () => {
    expect(coerceKnowledgeRefs(undefined)).toEqual([])
    expect(coerceKnowledgeRefs([])).toEqual([])
  })

  it('parses stored refs when mapping a row and tolerates junk', () => {
    const memory = toAdsMemory(memoryRow({ knowledge_refs: [{ source_id: SOURCE_A }, 'junk', { nope: 1 }] }))
    expect(memory.knowledge_refs).toEqual([{ source_id: SOURCE_A, source_name: null, url: null }])
    expect(toAdsMemory(memoryRow({ knowledge_refs: null })).knowledge_refs).toEqual([])
  })

  it('embeds the title together with the content', () => {
    expect(memoryEmbeddingText(' Title ', ' Body ')).toBe('Title\n\nBody')
  })
})

describe('memory search selection', () => {
  const row = (similarity: number | null, id = crypto.randomUUID()) => ({
    id, type: 'decision', status: 'active', source: 'mcp', platform: 'meta', title: 't', content: 'c',
    campaign_id: null, campaign_name: null, confidence: 3, knowledge_refs: [{ source_id: SOURCE_A }],
    change_request_id: null, created_at: '2026-10-01T00:00:00Z', similarity,
  })

  it('cuts below the floor and shapes hits', () => {
    const { memories, filteredOut } = selectMemoryMatches([row(0.2), row(0.55, 'keep'), row(null)], {
      limit: 10,
      minSimilarity: ADS_MEMORY_MIN_SIMILARITY,
    })
    expect(filteredOut).toBe(2)
    expect(memories).toHaveLength(1)
    expect(memories[0]).toMatchObject({ id: 'keep', similarity: 0.55 })
    expect(memories[0].knowledge_refs).toEqual([{ source_id: SOURCE_A, source_name: null, url: null }])
  })

  it('clamps limits and statuses', () => {
    expect(memorySearchLimit(undefined)).toBe(10)
    expect(memorySearchLimit(0)).toBe(1)
    expect(memorySearchLimit(500)).toBe(50)
    expect(memorySearchLimit(Number.NaN)).toBe(10)
    expect(memorySearchStatuses(undefined)).toEqual(['active'])
    expect(memorySearchStatuses(['bogus'])).toEqual(['active'])
    expect(memorySearchStatuses(['active', 'needs_review', 'active'])).toEqual(['active', 'needs_review'])
  })
})

describe('createMemory', () => {
  beforeEach(() => {
    vi.mocked(embed).mockReset()
    vi.mocked(embed).mockResolvedValue([0.1, 0.2, 0.3])
  })

  it('persists refs and an in-org change link, then embeds', async () => {
    const db = freshDb()
    db.rows('ads_change_requests').push({ id: 'cr-1', org_id: ORG })
    const id = await createMemory({
      orgId: ORG, type: 'decision', source: 'mcp', title: 'T', content: 'C',
      knowledgeRefs: [{ source_id: SOURCE_A, source_name: 'Lesson' }],
      changeRequestId: 'cr-1',
    })
    expect(id).toBeTruthy()
    const row = db.rows('ads_memories')[0]
    expect(row.knowledge_refs).toEqual([{ source_id: SOURCE_A, source_name: 'Lesson', url: null }])
    expect(row.change_request_id).toBe('cr-1')
    expect(row.embedding).toEqual([0.1, 0.2, 0.3])
    expect(row.embedded_at).toBeTruthy()
    expect(embed).toHaveBeenCalledWith('T\n\nC', 'org-openrouter-key', expect.objectContaining({ model: 'text-embedding-3-small' }))
  })

  it('drops a change link from another org', async () => {
    const db = freshDb()
    db.rows('ads_change_requests').push({ id: 'cr-x', org_id: OTHER_ORG })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const id = await createMemory({ orgId: ORG, type: 'insight', source: 'mcp', title: 'T', content: 'C', changeRequestId: 'cr-x' })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
    expect(id).toBeTruthy()
    expect(db.rows('ads_memories')[0].change_request_id).toBeNull()
  })

  it('still saves the memory when embedding fails', async () => {
    const db = freshDb()
    vi.mocked(embed).mockRejectedValueOnce(new Error('provider down'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const id = await createMemory({ orgId: ORG, type: 'insight', source: 'mcp', title: 'T', content: 'C' })
    spy.mockRestore()
    expect(id).toBeTruthy()
    expect(db.rows('ads_memories')[0].embedding ?? null).toBeNull()
  })
})

describe('updateMemory', () => {
  beforeEach(() => {
    vi.mocked(embed).mockReset()
    vi.mocked(embed).mockResolvedValue([0.9, 0.9, 0.9])
  })

  it('approves: needs_review -> active clears proposed', async () => {
    const db = freshDb()
    const m = memoryRow({ status: 'needs_review', proposed: true })
    db.rows('ads_memories').push(m)
    const result = await updateMemory({ orgId: ORG, memoryId: m.id, status: 'active' })
    expect(result.ok).toBe(true)
    expect(db.rows('ads_memories')[0]).toMatchObject({ status: 'active', proposed: false })
    expect(embed).not.toHaveBeenCalled()
  })

  it('supersedes with a same-org memory and forces the status', async () => {
    const db = freshDb()
    const old = memoryRow()
    const replacement = memoryRow({ title: 'Switch to ABO' })
    db.rows('ads_memories').push(old, replacement)
    const result = await updateMemory({ orgId: ORG, memoryId: old.id, supersededBy: replacement.id })
    if (!result.ok) throw new Error(result.error)
    expect(result.memory).toMatchObject({ status: 'superseded', superseded_by: replacement.id })
  })

  it('rejects self, cross-org, circular and conflicting supersession', async () => {
    const db = freshDb()
    const a = memoryRow()
    const foreign = memoryRow({ org_id: OTHER_ORG })
    const b = memoryRow({ superseded_by: a.id, status: 'superseded' })
    db.rows('ads_memories').push(a, foreign, b)

    expect(await updateMemory({ orgId: ORG, memoryId: a.id, supersededBy: a.id }))
      .toMatchObject({ ok: false, error: 'invalid_superseded_by' })
    expect(await updateMemory({ orgId: ORG, memoryId: a.id, supersededBy: foreign.id }))
      .toMatchObject({ ok: false, error: 'invalid_superseded_by' })
    expect(await updateMemory({ orgId: ORG, memoryId: a.id, supersededBy: b.id }))
      .toMatchObject({ ok: false, error: 'invalid_superseded_by' })
    expect(await updateMemory({ orgId: ORG, memoryId: a.id, supersededBy: b.id, status: 'active' }))
      .toMatchObject({ ok: false, error: 'invalid_input' })
    expect(db.rows('ads_memories')[0].status).toBe('active')
  })

  it('is org-scoped: another org cannot touch the memory', async () => {
    const db = freshDb()
    const m = memoryRow()
    db.rows('ads_memories').push(m)
    expect(await updateMemory({ orgId: OTHER_ORG, memoryId: m.id, status: 'archived' }))
      .toMatchObject({ ok: false, error: 'not_found' })
    expect(db.rows('ads_memories')[0].status).toBe('active')
  })

  it('re-embeds when the text changes and replaces refs', async () => {
    const db = freshDb()
    const m = memoryRow({ embedding: [0, 0, 0], embedded_at: '2026-10-01T00:00:00Z' })
    db.rows('ads_memories').push(m)
    const result = await updateMemory({
      orgId: ORG, memoryId: m.id, content: 'CBO lost to ABO in October.',
      knowledgeRefs: [{ source_id: SOURCE_B }],
    })
    if (!result.ok) throw new Error(result.error)
    expect(embed).toHaveBeenCalledWith('Keep CBO on prospecting\n\nCBO lost to ABO in October.', expect.any(String), expect.any(Object))
    const row = db.rows('ads_memories')[0]
    expect(row.embedding).toEqual([0.9, 0.9, 0.9])
    expect(row.knowledge_refs).toEqual([{ source_id: SOURCE_B, source_name: null, url: null }])
  })

  it('validates input and reports no-op updates', async () => {
    const db = freshDb()
    const m = memoryRow()
    db.rows('ads_memories').push(m)
    expect(await updateMemory({ orgId: ORG, memoryId: m.id, confidence: 9 })).toMatchObject({ ok: false, error: 'invalid_input' })
    expect(await updateMemory({ orgId: ORG, memoryId: m.id, title: '   ' })).toMatchObject({ ok: false, error: 'invalid_input' })
    expect(await updateMemory({ orgId: ORG, memoryId: m.id })).toMatchObject({ ok: false, error: 'no_changes' })
  })
})

describe('backfill + semantic search', () => {
  it('embeds missing vectors for the org only', async () => {
    const db = freshDb()
    db.rows('ads_memories').push(
      memoryRow(),
      memoryRow({ embedding: [1, 1, 1], embedded_at: '2026-10-01T00:00:00Z' }),
      memoryRow({ org_id: OTHER_ORG }),
    )
    expect(await backfillMemoryEmbeddings(ORG)).toBe(1)
    const rows = db.rows('ads_memories')
    expect(rows[0].embedding).toEqual([0.4, 0.5, 0.6])
    expect(rows[2].embedding).toBeNull()
  })

  it('backfills, calls the org-scoped RPC, and applies the floor', async () => {
    const db = freshDb()
    db.rows('ads_memories').push(memoryRow())
    let rpcArgs: Record<string, unknown> = {}
    db.rpcs.set('match_ads_memories', (args) => {
      rpcArgs = args
      return [
        { ...memoryRow({ id: 'hit' }), similarity: 0.52 },
        { ...memoryRow({ id: 'miss' }), similarity: 0.11 },
      ]
    })
    const result = await searchMemoriesSemantic({ orgId: ORG, query: 'CBO vs ABO', platform: 'meta', statuses: ['active', 'needs_review'], limit: 5 })
    if ('error' in result) throw new Error(result.error)
    expect(result.backfilled).toBe(1)
    expect(rpcArgs).toMatchObject({ p_org_id: ORG, platform_filter: 'meta', status_filter: ['active', 'needs_review'], match_count: 10 })
    expect(result.memories.map((m) => m.id)).toEqual(['hit'])
    expect(result.filtered_out).toBe(1)
  })

  it('rejects an empty query', async () => {
    freshDb()
    expect(await searchMemoriesSemantic({ orgId: ORG, query: '  ' })).toMatchObject({ error: 'empty_query' })
  })
})
