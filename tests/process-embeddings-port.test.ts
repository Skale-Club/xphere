import { describe, it, expect, vi } from 'vitest'
import { fakeDb, writes, type FakeCall, type Reply } from './helpers/fake-db'
import { processEmbeddingJob, type EmbeddingDeps } from '@/lib/knowledge/process-embeddings'
import { recursiveSplitText } from '@/lib/knowledge/recursive-split'
import { runsInApp } from '@/lib/edge-functions/switch'

const SECRET = 'a'.repeat(64)
const ORG = 'org-1'
const DOC = 'src-1'

interface Opts {
  sourceStatus?: string
  noIntegration?: boolean
  noSource?: boolean
  globalSetting?: boolean
  sourceType?: string
  sourceUrl?: string | null
  updateError?: boolean
}

function setup(o: Opts = {}) {
  const respond = (c: FakeCall): Reply | undefined => {
    if (c.table === 'integrations') {
      return o.noIntegration ? { error: { message: 'none' } } : { data: { encrypted_api_key: 'enc-openai' } }
    }
    if (c.table === 'knowledge_sources' && c.op === 'select') {
      return o.noSource
        ? { error: { message: 'none' } }
        : { data: { id: DOC, organization_id: ORG, source_type: o.sourceType ?? 'text', source_url: o.sourceUrl === undefined ? 'org-1/file.txt' : o.sourceUrl, status: o.sourceStatus ?? 'processing' } }
    }
    if (c.table === 'knowledge_sources' && c.op === 'update') {
      return o.updateError && (c.payload as { status?: string }).status === 'ready' ? { error: { message: 'nope' } } : undefined
    }
    if (c.table === 'platform_settings') {
      return o.globalSetting === false ? { data: null } : { data: { encrypted_value: 'enc-or' } }
    }
    if (c.table === 'global_knowledge_sources' && c.op === 'select') {
      return { data: { id: 'g-1', platform: 'meta', name: 'Playbook', source_type: 'text', source_url: 'g/file.txt', storage_bucket: null, status: o.sourceStatus ?? 'processing' } }
    }
    return undefined
  }
  const { db, calls } = fakeDb(respond)
  const embedBatch = vi.fn(async (texts: string[]) => texts.map(() => new Array(1536).fill(0.1)))
  const download = vi.fn(async () => ({ data: new Blob(['hello world. '.repeat(300)]), error: null }))
  const overrides: Partial<EmbeddingDeps> = {
    decrypt: async (s) => `key-for-${s}`,
    embedBatch,
    download,
    fetchUrl: vi.fn(async () => '<html><script>x()</script><p>Page   text</p></html>'),
    extractPdfText: vi.fn(async () => 'pdf text'),
    env: { ENCRYPTION_SECRET: SECRET },
    now: () => '2026-01-01T00:00:00.000Z',
  }
  return { db, calls, embedBatch, download, overrides }
}

const sourceUpdates = (calls: FakeCall[], table: string) =>
  writes(calls, table, 'update').map((c) => c.payload as Record<string, unknown>)

describe('process-embeddings in-app port: per-org knowledge source', () => {
  it('embeds, stores documents rows and moves processing -> ready', async () => {
    const t = setup()
    const res = await processEmbeddingJob(t.db, { documentId: DOC, organizationId: ORG }, t.overrides)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    const chunkCount = res.body.chunkCount as number
    expect(chunkCount).toBeGreaterThan(1)

    // OpenAI direct, with the decrypted org key and no gateway baseURL
    expect(t.embedBatch.mock.calls[0][1]).toBe('key-for-enc-openai')
    expect(t.embedBatch.mock.calls[0][2]).toEqual({})

    const inserted = writes(t.calls, 'documents', 'insert').flatMap((c) => c.payload as Array<Record<string, unknown>>)
    expect(inserted).toHaveLength(chunkCount)
    expect(Object.keys(inserted[0]).sort()).toEqual(['content', 'embedding', 'metadata'])
    expect((inserted[0].embedding as number[]).length).toBe(1536)
    expect(inserted[0].metadata).toEqual({
      org_id: ORG,
      source_id: DOC,
      source_type: 'text',
      knowledge_source_id: DOC,
    })

    expect(sourceUpdates(t.calls, 'knowledge_sources').pop()).toMatchObject({ status: 'ready', chunk_count: chunkCount })
  })

  it('is idempotent: a source that is not processing is skipped untouched', async () => {
    const t = setup({ sourceStatus: 'ready' })
    const res = await processEmbeddingJob(t.db, { documentId: DOC, organizationId: ORG }, t.overrides)
    expect(res).toEqual({ status: 200, body: { skipped: true } })
    expect(t.embedBatch).not.toHaveBeenCalled()
    expect(writes(t.calls, 'documents', 'insert')).toHaveLength(0)
    expect(sourceUpdates(t.calls, 'knowledge_sources')).toHaveLength(0)
  })

  it('records status error and returns 500 when embedding fails', async () => {
    const t = setup()
    t.embedBatch.mockRejectedValueOnce(new Error('rate limited'))
    const res = await processEmbeddingJob(t.db, { documentId: DOC, organizationId: ORG }, t.overrides)
    expect(res).toEqual({ status: 500, body: { error: 'rate limited' } })
    expect(sourceUpdates(t.calls, 'knowledge_sources').pop()).toMatchObject({ status: 'error', error_detail: 'rate limited' })
    expect(writes(t.calls, 'documents', 'insert')).toHaveLength(0)
  })

  it('records status error when the file cannot be read', async () => {
    const t = setup()
    t.download.mockResolvedValueOnce({ data: null as never, error: { message: 'gone' } })
    const res = await processEmbeddingJob(t.db, { documentId: DOC, organizationId: ORG }, t.overrides)
    expect(res.status).toBe(500)
    expect(String(res.body.error)).toContain('Source file could not be read')
    expect(sourceUpdates(t.calls, 'knowledge_sources').pop()).toMatchObject({ status: 'error' })
  })

  it('returns the same error statuses as the Edge Function for bad input', async () => {
    const t = setup()
    expect((await processEmbeddingJob(t.db, { documentId: DOC }, t.overrides)).status).toBe(400)
    expect((await processEmbeddingJob(t.db, { documentId: DOC, organizationId: ORG }, { ...t.overrides, env: {} })).body)
      .toEqual({ error: 'ENCRYPTION_SECRET not configured' })

    const noKey = setup({ noIntegration: true })
    expect(await processEmbeddingJob(noKey.db, { documentId: DOC, organizationId: ORG }, noKey.overrides)).toEqual({
      status: 400,
      body: { error: 'No active OpenAI integration found' },
    })

    const noSrc = setup({ noSource: true })
    expect((await processEmbeddingJob(noSrc.db, { documentId: DOC, organizationId: ORG }, noSrc.overrides)).status).toBe(404)
  })

  it('reads a trusted signed URL, ignores an untrusted one', async () => {
    const fetchSigned = vi.fn(async () => new Response('signed body '.repeat(10)))
    const ok = setup()
    await processEmbeddingJob(ok.db, { documentId: DOC, organizationId: ORG, downloadUrl: 'https://a.r2.cloudflarestorage.com/o' }, { ...ok.overrides, fetchSigned })
    expect(fetchSigned).toHaveBeenCalledTimes(1)
    expect(ok.download).not.toHaveBeenCalled()

    const bad = setup()
    const fetchBad = vi.fn()
    await processEmbeddingJob(bad.db, { documentId: DOC, organizationId: ORG, downloadUrl: 'https://evil.example.com/o' }, { ...bad.overrides, fetchSigned: fetchBad })
    expect(fetchBad).not.toHaveBeenCalled()
    expect(bad.download).toHaveBeenCalledWith('knowledge-docs', 'org-1/file.txt')
  })

  it('strips scripts and tags from a url source and extracts PDFs through unpdf', async () => {
    const url = setup({ sourceType: 'url', sourceUrl: 'https://example.com/p' })
    await processEmbeddingJob(url.db, { documentId: DOC, organizationId: ORG }, url.overrides)
    const rows = writes(url.calls, 'documents', 'insert').flatMap((c) => c.payload as Array<{ content: string }>)
    expect(rows[0].content).toBe('Page text')

    const pdf = setup({ sourceType: 'pdf' })
    await processEmbeddingJob(pdf.db, { documentId: DOC, organizationId: ORG }, pdf.overrides)
    expect((pdf.overrides.extractPdfText as ReturnType<typeof vi.fn>)).toHaveBeenCalled()
  })

  it('marks the source error when the final status update fails', async () => {
    const t = setup({ updateError: true })
    const res = await processEmbeddingJob(t.db, { documentId: DOC, organizationId: ORG }, t.overrides)
    expect(res.status).toBe(500)
    expect(String(res.body.error)).toContain('Status update failed')
  })
})

describe('process-embeddings in-app port: global knowledge', () => {
  it('uses the platform OpenRouter key through the gateway and keeps the global metadata', async () => {
    const t = setup()
    const res = await processEmbeddingJob(
      t.db,
      { scope: 'ads_playbook', playbookSourceId: 'g-1', platform: 'meta' },
      t.overrides,
    )
    expect(res.status).toBe(200)
    expect(t.embedBatch.mock.calls[0][1]).toBe('key-for-enc-or')
    expect(t.embedBatch.mock.calls[0][2]).toEqual({ baseURL: 'https://openrouter.ai/api/v1' })
    const rows = writes(t.calls, 'documents', 'insert').flatMap((c) => c.payload as Array<{ metadata: unknown }>)
    expect(rows[0].metadata).toEqual({
      scope: 'global_knowledge',
      platform: 'meta',
      global_knowledge_source_id: 'g-1',
      source_name: 'Playbook',
    })
    expect(sourceUpdates(t.calls, 'global_knowledge_sources').pop()).toMatchObject({ status: 'ready' })
  })

  it('marks the source error and answers 400 when the platform key is missing', async () => {
    const t = setup({ globalSetting: false })
    const res = await processEmbeddingJob(t.db, { scope: 'global_knowledge', globalKnowledgeSourceId: 'g-1' }, t.overrides)
    expect(res).toEqual({ status: 400, body: { error: 'No platform OpenRouter key' } })
    expect(sourceUpdates(t.calls, 'global_knowledge_sources').pop()).toMatchObject({ status: 'error' })
  })

  it('skips a global source that is not processing', async () => {
    const t = setup({ sourceStatus: 'ready' })
    const res = await processEmbeddingJob(t.db, { scope: 'global_knowledge', globalKnowledgeSourceId: 'g-1' }, t.overrides)
    expect(res).toEqual({ status: 200, body: { skipped: true } })
    expect(t.embedBatch).not.toHaveBeenCalled()
  })

  it('answers 400 when a global job has no source id', async () => {
    const t = setup()
    expect((await processEmbeddingJob(t.db, { scope: 'global_knowledge' }, t.overrides)).status).toBe(400)
  })
})

describe('recursive splitter', () => {
  it('keeps chunks within 1000 characters and overlaps neighbours', () => {
    const text = Array.from({ length: 80 }, (_, i) => `Sentence number ${i} ends here.`).join(' ')
    const chunks = recursiveSplitText(text, 1000, 100)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((c) => c.length <= 1000)).toBe(true)
    const tail = chunks[0].slice(-30)
    expect(chunks[1].includes(tail.trim().split(' ').slice(-2).join(' '))).toBe(true)
  })

  it('returns one chunk for short text and none for blank text', () => {
    expect(recursiveSplitText('short text')).toEqual(['short text'])
    expect(recursiveSplitText('   \n\n  ')).toEqual([])
  })
})

describe('EDGE_FUNCTIONS_IN_APP switch', () => {
  it('keeps process-embeddings on the Edge Function unless listed', () => {
    expect(runsInApp('process-embeddings', {})).toBe(false)
    expect(runsInApp('process-embeddings', { EDGE_FUNCTIONS_IN_APP: 'process-imports' })).toBe(false)
    expect(runsInApp('process-embeddings', { EDGE_FUNCTIONS_IN_APP: 'process-embeddings' })).toBe(true)
  })
})
