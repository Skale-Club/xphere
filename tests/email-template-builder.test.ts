import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoist vi.mock declarations before imports
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { createClient, getUser } from '@/lib/supabase/server'
import {
  createTemplate,
  saveTemplate,
  duplicateTemplate,
  saveReusableBlock,
  getReusableBlocks,
} from '@/app/(dashboard)/email-templates/actions'
import { renderTemplate, emptyDocument } from '@/lib/email/render-template'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSupabase(overrides: Record<string, unknown> = {}) {
  const rpcMock = vi.fn().mockResolvedValue({ data: 'org-uuid', error: null })
  const singleMock = vi.fn()

  const chain: Record<string, unknown> = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    single: singleMock,
    rpc: rpcMock,
    ...overrides,
  }

  // make every method return `this` unless overridden
  for (const key of Object.keys(chain)) {
    if (typeof chain[key] === 'function' && key !== 'rpc' && key !== 'single') {
      const fn = chain[key] as ReturnType<typeof vi.fn>
      if (!fn.getMockImplementation()) {
        fn.mockReturnValue(chain)
      }
    }
  }

  return chain
}

// ─── createTemplate ───────────────────────────────────────────────────────────

describe('createTemplate', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns error when not authenticated', async () => {
    vi.mocked(getUser).mockResolvedValue(null)
    const result = await createTemplate('My Template')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('not_authenticated')
  })

  it('returns error for empty name', async () => {
    vi.mocked(getUser).mockResolvedValue({ id: 'user-1' } as never)
    const supabase = makeSupabase()
    vi.mocked(createClient).mockResolvedValue(supabase as never)
    const result = await createTemplate('   ')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('name_required')
  })

  it('creates a template and returns the id', async () => {
    vi.mocked(getUser).mockResolvedValue({ id: 'user-1' } as never)
    const supabase = makeSupabase()
    ;(supabase.single as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { id: 'tmpl-123' }, error: null })
    vi.mocked(createClient).mockResolvedValue(supabase as never)

    const result = await createTemplate('My Template')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.id).toBe('tmpl-123')
  })
})

// ─── saveTemplate ─────────────────────────────────────────────────────────────

describe('saveTemplate', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns error when not authenticated', async () => {
    vi.mocked(getUser).mockResolvedValue(null)
    const result = await saveTemplate('tmpl-1', {})
    expect(result.ok).toBe(false)
  })

  it('saves document and generates html_snapshot', async () => {
    vi.mocked(getUser).mockResolvedValue({ id: 'user-1' } as never)
    const supabase = makeSupabase()
    ;(supabase.eq as ReturnType<typeof vi.fn>).mockResolvedValue({ error: null })
    vi.mocked(createClient).mockResolvedValue(supabase as never)

    const doc = emptyDocument()
    const result = await saveTemplate('tmpl-1', doc)
    expect(result.ok).toBe(true)
    // Verify update was called with html_snapshot
    expect(supabase.update).toHaveBeenCalledWith(
      expect.objectContaining({ html_snapshot: expect.any(String) })
    )
  })
})

// ─── duplicateTemplate ────────────────────────────────────────────────────────

describe('duplicateTemplate', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns error when not authenticated', async () => {
    vi.mocked(getUser).mockResolvedValue(null)
    const result = await duplicateTemplate('tmpl-1')
    expect(result.ok).toBe(false)
  })

  it('duplicates template with (copy) suffix', async () => {
    vi.mocked(getUser).mockResolvedValue({ id: 'user-1' } as never)

    // First call: fetch original
    // Second call: insert copy
    const singleMock = vi.fn()
      .mockResolvedValueOnce({
        data: { name: 'Newsletter', status: 'draft', document: {}, html_snapshot: null, plain_text_snapshot: null, org_id: 'org-1' },
        error: null,
      })
      .mockResolvedValueOnce({ data: { id: 'tmpl-copy' }, error: null })

    const supabase = makeSupabase({ single: singleMock })
    vi.mocked(createClient).mockResolvedValue(supabase as never)

    const result = await duplicateTemplate('tmpl-1')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.id).toBe('tmpl-copy')

    // Verify insert was called with name containing (copy)
    expect(supabase.insert).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Newsletter (copy)' })
    )
  })
})

// ─── saveReusableBlock ────────────────────────────────────────────────────────

describe('saveReusableBlock', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns error when not authenticated', async () => {
    vi.mocked(getUser).mockResolvedValue(null)
    const result = await saveReusableBlock('Header', 'header', {})
    expect(result.ok).toBe(false)
  })

  it('saves reusable block', async () => {
    vi.mocked(getUser).mockResolvedValue({ id: 'user-1' } as never)
    const supabase = makeSupabase()
    ;(supabase.insert as ReturnType<typeof vi.fn>).mockResolvedValue({ error: null })
    vi.mocked(createClient).mockResolvedValue(supabase as never)

    const result = await saveReusableBlock('Company Header', 'header', { blocks: [] })
    expect(result.ok).toBe(true)
    expect(supabase.insert).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Company Header', block_type: 'header' })
    )
  })
})

// ─── getReusableBlocks ────────────────────────────────────────────────────────

describe('getReusableBlocks', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns empty array when no blocks', async () => {
    vi.mocked(getUser).mockResolvedValue({ id: 'user-1' } as never)
    const supabase = makeSupabase()
    ;(supabase.order as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [], error: null })
    vi.mocked(createClient).mockResolvedValue(supabase as never)

    const result = await getReusableBlocks()
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toEqual([])
  })
})

// ─── renderTemplate ───────────────────────────────────────────────────────────

describe('renderTemplate', () => {
  it('renders non-empty HTML from empty document', () => {
    const doc = emptyDocument()
    const { html, plainText } = renderTemplate(doc)
    expect(html).toBeTruthy()
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<body')
  })

  it('includes heading content in rendered HTML', () => {
    const doc = emptyDocument()
    doc.sections.push({
      id: 's1',
      layout: 1,
      columns: [[
        { blockType: 'heading', content: 'Welcome to Xphere', level: 1, color: '#111', align: 'center' },
      ]],
    })
    const { html } = renderTemplate(doc)
    expect(html).toContain('Welcome to Xphere')
    expect(html).toContain('<h1')
  })

  it('includes text block in rendered HTML', () => {
    const doc = emptyDocument()
    doc.sections.push({
      id: 's2',
      layout: 1,
      columns: [[
        { blockType: 'text', content: 'Hello <strong>world</strong>', fontSize: 16, color: '#333', align: 'left' },
      ]],
    })
    const { html, plainText } = renderTemplate(doc)
    expect(html).toContain('Hello')
    expect(html).toContain('<strong>world</strong>')
    expect(plainText).toContain('Hello')
  })

  it('renders button with correct href', () => {
    const doc = emptyDocument()
    doc.sections.push({
      id: 's3',
      layout: 1,
      columns: [[
        { blockType: 'button', label: 'Get Started', href: 'https://xphere.app', backgroundColor: '#000', textColor: '#fff', borderRadius: 4 },
      ]],
    })
    const { html, plainText } = renderTemplate(doc)
    expect(html).toContain('https://xphere.app')
    expect(html).toContain('Get Started')
    expect(plainText).toContain('Get Started (https://xphere.app)')
  })

  it('renders divider and spacer blocks', () => {
    const doc = emptyDocument()
    doc.sections.push({
      id: 's4',
      layout: 1,
      columns: [[
        { blockType: 'divider', color: '#cccccc', thickness: 2 },
        { blockType: 'spacer', height: 40 },
      ]],
    })
    const { html } = renderTemplate(doc)
    expect(html).toContain('<hr')
    expect(html).toContain('40px')
  })

  it('renders 2-column layout', () => {
    const doc = emptyDocument()
    doc.sections.push({
      id: 's5',
      layout: 2,
      columns: [
        [{ blockType: 'text', content: 'Left column', fontSize: 14, color: '#333', align: 'left' }],
        [{ blockType: 'text', content: 'Right column', fontSize: 14, color: '#333', align: 'left' }],
      ],
    })
    const { html } = renderTemplate(doc)
    expect(html).toContain('Left column')
    expect(html).toContain('Right column')
    expect(html).toContain('50%')
  })

  it('handles unknown blocks gracefully', () => {
    const doc = emptyDocument()
    doc.sections.push({
      id: 's6',
      layout: 1,
      columns: [[{ blockType: 'unknown' as never }]],
    })
    const { html } = renderTemplate(doc)
    expect(html).toBeTruthy()
    expect(html).toContain('<!DOCTYPE html>')
  })
})
