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
  getPlatformSetting: vi.fn(async () => 'platform-openrouter-key'),
}))
vi.mock('@/lib/knowledge/embed', () => ({
  embed: vi.fn(async () => [0.1, 0.2, 0.3]),
  embedBatch: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
}))

import {
  GLOBAL_KNOWLEDGE_MIN_SIMILARITY,
  batchItems,
  classifyGlobalKnowledgeSource,
  globalKnowledgeFetchCount,
  ingestGlobalKnowledgeText,
  listGlobalKnowledgeSources,
  resolveGlobalKnowledgeSourceUrl,
  searchGlobalKnowledge,
  selectBySimilarity,
} from '@/lib/knowledge/global-knowledge'
import { embedBatch } from '@/lib/knowledge/embed'

const NOTION_SOURCE = '11111111-1111-4111-8111-111111111111'
const TEXT_SOURCE = '22222222-2222-4222-8222-222222222222'

function freshDb(mode: 'manual' | 'notion' = 'manual'): FakeDb {
  const db = new FakeDb()
  db.rows('global_knowledge_config').push({ id: 'primary', source_mode: mode })
  state.db = db
  return db
}

describe('selectBySimilarity', () => {
  it('drops rows below the floor, counts them, and keeps the best first', () => {
    const rows = [
      { id: 'a', similarity: 0.31 },
      { id: 'b', similarity: 0.12 },
      { id: 'c', similarity: 0.58 },
      { id: 'd', similarity: 0.29 },
    ]
    const out = selectBySimilarity(rows, { limit: 5, minSimilarity: 0.3 })
    expect(out.kept.map((r) => r.id)).toEqual(['c', 'a'])
    expect(out.filteredOut).toBe(2)
    expect(out.bestSimilarity).toBe(0.58)
  })

  it('treats the floor as inclusive', () => {
    const out = selectBySimilarity([{ similarity: 0.3 }], { limit: 5, minSimilarity: 0.3 })
    expect(out.kept).toHaveLength(1)
    expect(out.filteredOut).toBe(0)
  })

  it('truncates to the limit without counting truncation as filtered', () => {
    const rows = [0.9, 0.8, 0.7, 0.6, 0.5, 0.1].map((similarity, i) => ({ i, similarity }))
    const out = selectBySimilarity(rows, { limit: 3, minSimilarity: 0.3 })
    expect(out.kept.map((r) => r.similarity)).toEqual([0.9, 0.8, 0.7])
    expect(out.filteredOut).toBe(1)
  })

  it('never lets a missing or non-finite similarity through', () => {
    const out = selectBySimilarity(
      [{ similarity: null }, { similarity: undefined }, { similarity: Number.NaN }, { similarity: 0.6 }],
      { limit: 10, minSimilarity: 0 },
    )
    expect(out.kept).toEqual([{ similarity: 0.6 }])
    expect(out.filteredOut).toBe(3)
  })

  it('returns nothing and a null best score for empty input', () => {
    expect(selectBySimilarity([], { limit: 5, minSimilarity: 0.3 })).toEqual({
      kept: [],
      filteredOut: 0,
      bestSimilarity: null,
    })
  })
})

describe('Global Knowledge helpers', () => {
  it('uses a floor below the production relevance band', () => {
    expect(GLOBAL_KNOWLEDGE_MIN_SIMILARITY).toBeGreaterThan(0)
    expect(GLOBAL_KNOWLEDGE_MIN_SIMILARITY).toBeLessThan(0.55)
  })

  it('over-fetches twice the requested count, capped at 20', () => {
    expect(globalKnowledgeFetchCount(5)).toBe(10)
    expect(globalKnowledgeFetchCount(15)).toBe(20)
    expect(globalKnowledgeFetchCount(0)).toBe(2)
  })

  it('links only Notion pages with an http(s) URL', () => {
    expect(resolveGlobalKnowledgeSourceUrl({ source_type: 'notion_page', source_url: 'https://www.notion.so/Page-abc' }))
      .toBe('https://www.notion.so/Page-abc')
    expect(resolveGlobalKnowledgeSourceUrl({ source_type: 'pdf', source_url: 'https://example.com/a.pdf' })).toBeNull()
    expect(resolveGlobalKnowledgeSourceUrl({ source_type: 'notion_page', source_url: 'global-knowledge/x.pdf' })).toBeNull()
    expect(resolveGlobalKnowledgeSourceUrl({ source_type: 'notion_page', source_url: 'javascript:alert(1)' })).toBeNull()
    expect(resolveGlobalKnowledgeSourceUrl({ source_type: 'notion_page', source_url: null })).toBeNull()
    expect(resolveGlobalKnowledgeSourceUrl(null)).toBeNull()
  })

  it('splits into batches of the requested size', () => {
    expect(batchItems([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(batchItems([], 32)).toEqual([])
  })

  it('classifies thin and searchable sources against the source mode', () => {
    const base = { name: 'Bidding basics', chunk_count: 12, status: 'ready' as const, is_active: true }
    expect(classifyGlobalKnowledgeSource({ ...base, source_type: 'text' }, 'manual')).toEqual({ thin: false, searchable: true })
    expect(classifyGlobalKnowledgeSource({ ...base, source_type: 'text' }, 'notion')).toEqual({ thin: false, searchable: false })
    expect(classifyGlobalKnowledgeSource({ ...base, source_type: 'notion_page' }, 'notion').searchable).toBe(true)
    expect(classifyGlobalKnowledgeSource({ ...base, source_type: 'notion_page' }, 'manual').searchable).toBe(false)
    expect(classifyGlobalKnowledgeSource({ ...base, source_type: 'text', status: 'error' }, 'manual').searchable).toBe(false)
    expect(classifyGlobalKnowledgeSource({ ...base, source_type: 'text', is_active: false }, 'manual').searchable).toBe(false)
    expect(classifyGlobalKnowledgeSource({ ...base, source_type: 'text', chunk_count: 1 }, 'manual').thin).toBe(true)
    expect(classifyGlobalKnowledgeSource({ ...base, source_type: 'text', name: 'Untitled' }, 'manual').thin).toBe(true)
  })
})

describe('searchGlobalKnowledge', () => {
  beforeEach(() => {
    const db = freshDb('notion')
    db.rows('global_knowledge_sources').push(
      { id: NOTION_SOURCE, name: 'Meta CBO lesson', source_type: 'notion_page', source_url: 'https://www.notion.so/cbo-123' },
      { id: TEXT_SOURCE, name: 'Pasted text', source_type: 'text', source_url: null },
    )
  })

  it('applies the floor, over-fetches, and attaches source ids and links', async () => {
    const db = state.db as FakeDb
    let requestedCount: unknown
    db.rpcs.set('match_global_knowledge', (args) => {
      requestedCount = args.match_count
      return [
        { id: 1, content: 'CBO spreads budget', similarity: 0.58, metadata: { platform: 'meta', source_name: 'Meta CBO lesson', global_knowledge_source_id: NOTION_SOURCE } },
        { id: 2, content: 'Legacy chunk', similarity: 0.41, metadata: { platform: 'global', playbook_source_id: TEXT_SOURCE } },
        { id: 3, content: 'Unrelated', similarity: 0.12, metadata: { platform: 'meta', global_knowledge_source_id: TEXT_SOURCE } },
      ]
    })

    const result = await searchGlobalKnowledge({ orgId: 'org-1', query: 'how does CBO work', platform: 'meta', topK: 5 })
    if ('error' in result) throw new Error(result.error)

    expect(requestedCount).toBe(10)
    expect(result.filtered_out).toBe(1)
    expect(result.min_similarity).toBe(GLOBAL_KNOWLEDGE_MIN_SIMILARITY)
    expect(result.note).toBeUndefined()
    expect(result.matches).toHaveLength(2)
    expect(result.matches[0]).toMatchObject({
      source_id: NOTION_SOURCE,
      global_knowledge_source_id: NOTION_SOURCE,
      url: 'https://www.notion.so/cbo-123',
      source_name: 'Meta CBO lesson',
    })
    // Legacy playbook metadata still resolves; the name falls back to the source row.
    expect(result.matches[1]).toMatchObject({ source_id: TEXT_SOURCE, url: null, source_name: 'Pasted text' })
  })

  it('returns a do-not-cite note when nothing clears the floor', async () => {
    const db = state.db as FakeDb
    db.rpcs.set('match_global_knowledge', () => [
      { id: 1, content: 'x', similarity: 0.21, metadata: { global_knowledge_source_id: TEXT_SOURCE } },
      { id: 2, content: 'y', similarity: 0.18, metadata: { global_knowledge_source_id: TEXT_SOURCE } },
    ])
    const result = await searchGlobalKnowledge({ orgId: 'org-1', query: 'recipe for lasagna' })
    if ('error' in result) throw new Error(result.error)
    expect(result.matches).toEqual([])
    expect(result.filtered_out).toBe(2)
    expect(result.note).toMatch(/Do not cite Global Knowledge/)
    expect(result.note).toContain('0.21')
  })

  it('honours a caller-provided floor', async () => {
    const db = state.db as FakeDb
    db.rpcs.set('match_global_knowledge', () => [
      { id: 1, content: 'x', similarity: 0.45, metadata: { global_knowledge_source_id: TEXT_SOURCE } },
    ])
    const result = await searchGlobalKnowledge({ orgId: 'org-1', query: 'q', minSimilarity: 0.5 })
    if ('error' in result) throw new Error(result.error)
    expect(result.matches).toHaveLength(0)
    expect(result.min_similarity).toBe(0.5)
  })

  it('keeps the error shape on RPC failure', async () => {
    const result = await searchGlobalKnowledge({ orgId: 'org-1', query: 'q' })
    expect(result).toMatchObject({ error: 'search_failed' })
  })
})

describe('ingestGlobalKnowledgeText', () => {
  // Braces matter: a function returned from beforeEach runs as its teardown.
  beforeEach(() => {
    vi.mocked(embedBatch).mockClear()
  })

  it('refuses in notion mode without writing anything', async () => {
    const db = freshDb('notion')
    const result = await ingestGlobalKnowledgeText({ name: 'Lesson', content: 'Some text', platform: 'meta' })
    expect(result).toMatchObject({ error: 'notion_mode' })
    expect(db.rows('global_knowledge_sources')).toHaveLength(0)
    expect(db.rows('documents')).toHaveLength(0)
    expect(embedBatch).not.toHaveBeenCalled()
  })

  it('embeds in batches of 32 in manual mode', async () => {
    const db = freshDb('manual')
    // ~40 chunks of distinct words at the 500/50 chunker settings.
    const content = Array.from({ length: 40 }, (_, i) => `Paragraph ${i}. ` + `word${i} `.repeat(480)).join('\n\n')
    const result = await ingestGlobalKnowledgeText({ name: '  ', content, platform: 'global' })
    if ('error' in result) throw new Error(`${result.error}: ${result.detail}`)

    const calls = vi.mocked(embedBatch).mock.calls
    expect(result.chunk_count).toBeGreaterThan(32)
    expect(calls.length).toBe(Math.ceil(result.chunk_count / 32))
    for (const [texts] of calls) expect(texts.length).toBeLessThanOrEqual(32)
    expect(db.rows('documents')).toHaveLength(result.chunk_count)
    const source = db.rows('global_knowledge_sources')[0]
    expect(source).toMatchObject({ name: 'Pasted text', status: 'ready', chunk_count: result.chunk_count })
    expect((db.rows('documents')[0].metadata as Record<string, unknown>).source_name).toBe('Pasted text')
  })
})

describe('listGlobalKnowledgeSources', () => {
  it('returns the source mode and health flags', async () => {
    const db = freshDb('notion')
    db.rows('global_knowledge_sources').push(
      { id: NOTION_SOURCE, platform: 'meta', name: 'Untitled', source_type: 'notion_page', status: 'ready', error_detail: null, chunk_count: 1, is_active: true, source_url: 'https://www.notion.so/x', last_synced_at: null, created_at: '2026-10-01T00:00:00Z' },
      { id: TEXT_SOURCE, platform: 'global', name: 'Course', source_type: 'text', status: 'ready', error_detail: null, chunk_count: 30, is_active: true, source_url: null, last_synced_at: null, created_at: '2026-09-01T00:00:00Z' },
    )
    const result = await listGlobalKnowledgeSources({})
    if ('error' in result) throw new Error(result.error)
    expect(result.source_mode).toBe('notion')
    expect(result.count).toBe(2)
    const byId = Object.fromEntries(result.sources.map((s) => [s.id, s]))
    expect(byId[NOTION_SOURCE]).toMatchObject({ thin: true, searchable: true })
    expect(byId[TEXT_SOURCE]).toMatchObject({ thin: false, searchable: false })
  })
})
