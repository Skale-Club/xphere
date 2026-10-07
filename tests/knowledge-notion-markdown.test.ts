// Global Knowledge Notion write path + database traversal (no network).
import { beforeEach, describe, expect, it, vi } from 'vitest'

const clientMocks = vi.hoisted(() => ({
  createNotionPageFromMarkdown: vi.fn(),
  appendNotionPageMarkdown: vi.fn(),
  retrieveNotionBlockChildren: vi.fn(),
  retrieveNotionDatabase: vi.fn(),
  queryNotionDataSourcePages: vi.fn(),
}))
const syncMocks = vi.hoisted(() => ({ enqueueGlobalKnowledgeRootSync: vi.fn() }))
const dbState = vi.hoisted(() => ({
  roots: [] as Array<Record<string, unknown>>,
  connection: null as Record<string, unknown> | null,
  inserted: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/notion/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/notion/client')>()
  return { ...actual, ...clientMocks }
})
vi.mock('@/lib/notion/connection', () => ({
  resolveNotionAccessToken: vi.fn(async () => 'token'),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => ({
    from(table: string) {
      const builder = {
        select: () => builder,
        neq: () => builder,
        eq: () => builder,
        in: () => builder,
        not: () => builder,
        order: async () => ({ data: table === 'global_knowledge_notion_roots' ? dbState.roots : [], error: null }),
        maybeSingle: async () => ({ data: dbState.connection, error: null }),
        insert: async (row: Record<string, unknown>) => {
          dbState.inserted.push(row)
          return { error: null }
        },
      }
      return builder
    },
  }),
}))
vi.mock('@/lib/knowledge/notion-sync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/knowledge/notion-sync')>()
  return { ...actual, ...syncMocks }
})

import {
  buildGlobalKnowledgePageMarkdown,
  createGlobalKnowledgeNotionPage,
  describeNotionWriteError,
  normalizeNotionPageTitle,
  selectGlobalKnowledgeRoot,
  splitMarkdownSegments,
} from '@/lib/knowledge/notion-write'
import {
  formatNotionPropertiesAsMarkdown,
  isNotionDatabaseRow,
  NotionApiError,
} from '@/lib/notion/client'
import { discoverChildPages, stripEmptyBlocks } from '@/lib/knowledge/notion-sync'

describe('buildGlobalKnowledgePageMarkdown', () => {
  it('normalizes newlines and trailing spaces', () => {
    expect(buildGlobalKnowledgePageMarkdown({ title: 'T', markdown: 'a  \r\nb\r\n\r\n' })).toBe('a\nb')
  })

  it('drops a leading H1 that repeats the title', () => {
    const body = buildGlobalKnowledgePageMarkdown({
      title: 'Creative Testing',
      markdown: '# creative testing\n\n## Step 1\nTest hooks.',
    })
    expect(body).toBe('## Step 1\nTest hooks.')
  })

  it('keeps a leading H1 that differs from the title', () => {
    const body = buildGlobalKnowledgePageMarkdown({ title: 'A', markdown: '# B\n\ntext' })
    expect(body).toBe('# B\n\ntext')
  })

  it('puts a Source line at the top', () => {
    const body = buildGlobalKnowledgePageMarkdown({
      title: 'Video',
      markdown: 'Transcript',
      sourceUrl: 'https://youtu.be/dQw4w9WgXcQ',
    })
    expect(body).toBe('Source: [https://youtu.be/dQw4w9WgXcQ](https://youtu.be/dQw4w9WgXcQ)\n\nTranscript')
  })

  it('encodes characters that would break the link target', () => {
    const body = buildGlobalKnowledgePageMarkdown({
      title: 'X',
      markdown: 'y',
      sourceUrl: 'https://en.wikipedia.org/wiki/Foo_(bar)',
    })
    expect(body.split('\n')[0]).toBe(
      'Source: [https://en.wikipedia.org/wiki/Foo_(bar)](https://en.wikipedia.org/wiki/Foo_%28bar%29)',
    )
  })

  it('returns empty for blank markdown without a source', () => {
    expect(buildGlobalKnowledgePageMarkdown({ title: 'T', markdown: '  \n ' })).toBe('')
  })
})

describe('normalizeNotionPageTitle', () => {
  it('flattens whitespace and caps length', () => {
    expect(normalizeNotionPageTitle('  a\n b  ')).toBe('a b')
    const long = normalizeNotionPageTitle('x'.repeat(500))
    expect(long.length).toBe(200)
    expect(long.endsWith('…')).toBe(true)
  })
})

describe('splitMarkdownSegments', () => {
  it('returns a single segment when it fits', () => {
    expect(splitMarkdownSegments('a\n\nb', 100)).toEqual(['a\n\nb'])
    expect(splitMarkdownSegments('   ', 100)).toEqual([])
  })

  it('splits at blank lines and keeps every segment within the limit', () => {
    const paragraphs = Array.from({ length: 20 }, (_, index) => `Paragraph ${index} ${'x'.repeat(30)}`)
    const segments = splitMarkdownSegments(paragraphs.join('\n\n'), 120)
    expect(segments.length).toBeGreaterThan(1)
    for (const segment of segments) expect(segment.length).toBeLessThanOrEqual(120)
    expect(segments.join('\n\n')).toBe(paragraphs.join('\n\n'))
  })

  it('does not split inside a fenced code block that fits', () => {
    const code = '```\nline1\n\nline2\n```'
    const markdown = `${'a'.repeat(50)}\n\n${code}\n\n${'b'.repeat(50)}`
    const segments = splitMarkdownSegments(markdown, 60)
    expect(segments).toContain(code)
  })

  it('hard-splits a single oversized line', () => {
    const segments = splitMarkdownSegments('z'.repeat(250), 100)
    expect(segments).toEqual(['z'.repeat(100), 'z'.repeat(100), 'z'.repeat(50)])
  })
})

describe('selectGlobalKnowledgeRoot', () => {
  const roots = [
    { id: 'r-global', platform: 'global', status: 'active' },
    { id: 'r-meta', platform: 'meta', status: 'active' },
    { id: 'r-gone', platform: 'google', status: 'disconnected' },
  ]

  it('honours an explicit root id', () => {
    expect(selectGlobalKnowledgeRoot(roots, { rootId: 'r-meta' })).toMatchObject({ ok: true, root: { id: 'r-meta' } })
  })

  it('rejects an unknown or disconnected explicit root', () => {
    expect(selectGlobalKnowledgeRoot(roots, { rootId: 'r-gone' })).toMatchObject({ ok: false, error: 'root_not_found' })
  })

  it('prefers a platform match, then the global root', () => {
    expect(selectGlobalKnowledgeRoot(roots, { platform: 'meta' })).toMatchObject({ root: { id: 'r-meta' } })
    expect(selectGlobalKnowledgeRoot(roots, { platform: 'google' })).toMatchObject({ root: { id: 'r-global' } })
    expect(selectGlobalKnowledgeRoot(roots, {})).toMatchObject({ root: { id: 'r-global' } })
  })

  it('returns no_root when nothing fits', () => {
    expect(selectGlobalKnowledgeRoot([roots[1]], { platform: 'google' })).toMatchObject({ ok: false, error: 'no_root' })
  })
})

describe('describeNotionWriteError', () => {
  it('maps 403 to the missing insert capability error', () => {
    const mapped = describeNotionWriteError(new NotionApiError('nope', 403, null, 'restricted_resource'))
    expect(mapped.error).toBe('notion_insert_capability_missing')
    expect(mapped.detail).toContain('Insert content')
  })

  it('maps 404 and generic errors', () => {
    expect(describeNotionWriteError(new NotionApiError('x', 404)).error).toBe('notion_root_not_accessible')
    expect(describeNotionWriteError(new Error('boom'))).toEqual({ error: 'notion_request_failed', detail: 'boom' })
  })
})

describe('formatNotionPropertiesAsMarkdown', () => {
  it('renders non-empty properties and skips title, timestamps and relations', () => {
    const markdown = formatNotionPropertiesAsMarkdown({
      Name: { type: 'title', title: [{ plain_text: 'Row' }] },
      Summary: { type: 'rich_text', rich_text: [{ plain_text: 'Use ' }, { plain_text: 'broad targeting' }] },
      Budget: { type: 'number', number: 50 },
      Stage: { type: 'select', select: { name: 'Scale' } },
      Status: { type: 'status', status: { name: 'Done' } },
      Tags: { type: 'multi_select', multi_select: [{ name: 'Meta' }, { name: 'CBO' }] },
      Empty: { type: 'rich_text', rich_text: [] },
      Link: { type: 'url', url: 'https://example.com' },
      Done: { type: 'checkbox', checkbox: true },
      When: { type: 'date', date: { start: '2026-01-01', end: null } },
      Score: { type: 'formula', formula: { type: 'number', number: 3 } },
      Edited: { type: 'last_edited_time', last_edited_time: '2026-01-01T00:00:00Z' },
      Related: { type: 'relation', relation: [{ id: 'abc' }] },
      Ref: { type: 'unique_id', unique_id: { prefix: 'KB', number: 7 } },
    })
    expect(markdown).toBe([
      '## Properties',
      '',
      '- Summary: Use broad targeting',
      '- Budget: 50',
      '- Stage: Scale',
      '- Status: Done',
      '- Tags: Meta, CBO',
      '- Link: https://example.com',
      '- Done: Yes',
      '- When: 2026-01-01',
      '- Score: 3',
      '- Ref: KB-7',
    ].join('\n'))
  })

  it('returns empty when nothing has text', () => {
    expect(formatNotionPropertiesAsMarkdown({ Name: { type: 'title', title: [] } })).toBe('')
    expect(formatNotionPropertiesAsMarkdown(undefined)).toBe('')
  })

  it('detects database rows by parent type', () => {
    expect(isNotionDatabaseRow({ type: 'data_source_id', data_source_id: 'x' })).toBe(true)
    expect(isNotionDatabaseRow({ type: 'database_id', database_id: 'x' })).toBe(true)
    expect(isNotionDatabaseRow({ type: 'page_id', page_id: 'x' })).toBe(false)
  })
})

describe('discoverChildPages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('follows child pages, nested blocks and database rows', async () => {
    clientMocks.retrieveNotionBlockChildren.mockImplementation(async (_token: string, blockId: string) => {
      if (blockId === 'root') {
        return [
          { id: 'page-a', type: 'child_page', has_children: true },
          { id: 'toggle', type: 'toggle', has_children: true },
          { id: 'db-1', type: 'child_database', has_children: false },
          { id: 'linked', type: 'child_database', has_children: false },
        ]
      }
      if (blockId === 'toggle') return [{ id: 'page-b', type: 'child_page', has_children: false }]
      return []
    })
    clientMocks.retrieveNotionDatabase.mockImplementation(async (_token: string, id: string) => {
      if (id === 'linked') throw new NotionApiError('linked database', 400, null, 'validation_error')
      return { id, title: 'DB', inTrash: false, dataSources: [{ id: 'ds-1', name: 'Main' }] }
    })
    clientMocks.queryNotionDataSourcePages.mockResolvedValue([
      { id: 'row-1', inTrash: false },
      { id: 'row-2', inTrash: true },
    ])

    const pages = await discoverChildPages('token', 'root')
    expect(pages).toEqual(['page-a', 'row-1', 'page-b'])
    expect(clientMocks.queryNotionDataSourcePages).toHaveBeenCalledWith('token', 'ds-1', expect.objectContaining({ limit: expect.any(Number) }))
  })

  it('propagates rate limits instead of skipping the database', async () => {
    clientMocks.retrieveNotionBlockChildren.mockResolvedValue([{ id: 'db', type: 'child_database', has_children: false }])
    clientMocks.retrieveNotionDatabase.mockRejectedValue(new NotionApiError('slow down', 429, 2))
    await expect(discoverChildPages('token', 'root')).rejects.toThrow('slow down')
  })
})

describe('createGlobalKnowledgeNotionPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbState.inserted = []
    dbState.roots = [
      { id: 'root-1', connection_id: 'conn-1', title: 'Tráfego e Conversão', platform: 'global', status: 'active', notion_page_id: 'notion-root' },
    ]
    dbState.connection = {
      id: 'conn-1', status: 'connected', encrypted_access_token: 'x', encrypted_refresh_token: null, token_expires_at: null,
    }
  })

  it('creates the page under the root and enqueues a deduped reconcile', async () => {
    clientMocks.createNotionPageFromMarkdown.mockResolvedValue({ id: 'page-1', url: 'https://notion.so/page-1' })
    const result = await createGlobalKnowledgeNotionPage({
      title: 'Hook framework',
      markdown: '## Hooks\n- Pattern interrupt',
      platform: 'meta',
      sourceUrl: 'https://example.com/a',
      createdBy: 'user-1',
    })
    expect(result).toEqual({
      ok: true, pageId: 'page-1', url: 'https://notion.so/page-1', rootId: 'root-1', rootTitle: 'Tráfego e Conversão',
    })
    expect(clientMocks.createNotionPageFromMarkdown).toHaveBeenCalledWith('token', {
      parentPageId: 'notion-root',
      title: 'Hook framework',
      markdown: 'Source: [https://example.com/a](https://example.com/a)\n\n## Hooks\n- Pattern interrupt',
    })
    expect(syncMocks.enqueueGlobalKnowledgeRootSync).toHaveBeenCalledWith({
      connectionId: 'conn-1', rootId: 'root-1', jobType: 'reconcile', eventId: 'create:page-1',
    })
    expect(dbState.inserted[0]).toMatchObject({
      external_id: 'page-1', source_type: 'notion_page', notion_root_id: 'root-1', created_by: 'user-1', is_active: false,
    })
  })

  it('maps a 403 to notion_insert_capability_missing and does not enqueue', async () => {
    clientMocks.createNotionPageFromMarkdown.mockRejectedValue(new NotionApiError('forbidden', 403, null, 'restricted_resource'))
    const result = await createGlobalKnowledgeNotionPage({ title: 'T', markdown: 'body' })
    expect(result).toMatchObject({ ok: false, error: 'notion_insert_capability_missing' })
    expect(syncMocks.enqueueGlobalKnowledgeRootSync).not.toHaveBeenCalled()
  })

  it('refuses without a root or with an inactive connection', async () => {
    dbState.roots = []
    expect(await createGlobalKnowledgeNotionPage({ title: 'T', markdown: 'b' })).toMatchObject({ ok: false, error: 'no_root' })
    dbState.roots = [{ id: 'root-1', connection_id: 'conn-1', title: 'R', platform: 'global', status: 'active', notion_page_id: 'n' }]
    dbState.connection = { id: 'conn-1', status: 'disconnected' }
    expect(await createGlobalKnowledgeNotionPage({ title: 'T', markdown: 'b' })).toMatchObject({ ok: false, error: 'notion_not_connected' })
    expect(clientMocks.createNotionPageFromMarkdown).not.toHaveBeenCalled()
  })

  it('validates title and content before touching Notion', async () => {
    expect(await createGlobalKnowledgeNotionPage({ title: ' ', markdown: 'b' })).toMatchObject({ error: 'missing_title' })
    expect(await createGlobalKnowledgeNotionPage({ title: 'T', markdown: ' ' })).toMatchObject({ error: 'empty_content' })
  })

  it('appends the remaining segments for long content', async () => {
    clientMocks.createNotionPageFromMarkdown.mockResolvedValue({ id: 'page-2', url: null })
    const paragraph = 'p'.repeat(30_000)
    await createGlobalKnowledgeNotionPage({ title: 'Long', markdown: `${paragraph}\n\n${paragraph}\n\n${paragraph}` })
    expect(clientMocks.createNotionPageFromMarkdown).toHaveBeenCalledTimes(1)
    expect(clientMocks.appendNotionPageMarkdown).toHaveBeenCalledTimes(2)
  })
})

describe('stripEmptyBlocks', () => {
  it('treats a page holding only empty-block tags as empty', () => {
    expect(stripEmptyBlocks('<empty-block/>')).toBe('')
    expect(stripEmptyBlocks('\n<empty-block/>\n\n<empty-block />\n')).toBe('')
  })

  it('keeps real content and collapses the gaps left behind', () => {
    expect(stripEmptyBlocks('## Ideia\n<empty-block/>\n\n\nTexto')).toBe('## Ideia\n\nTexto')
  })
})
