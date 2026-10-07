import { describe, expect, it } from 'vitest'
import { encode } from 'gpt-tokenizer'
import { chunkNotionPage, stripChildReferences } from '@/lib/knowledge/notion-chunk'

describe('stripChildReferences', () => {
  it('drops child page and database lines but keeps prose', () => {
    const markdown = [
      'Intro text.',
      '<page url="https://app.notion.com/p/abc">A1: Lesson</page>',
      '<database url="https://app.notion.com/p/def">Rows</database>',
      'More text with an inline <mention-page url="x">ref</mention-page>.',
    ].join('\n')
    expect(stripChildReferences(markdown)).toBe(
      'Intro text.\nMore text with an inline <mention-page url="x">ref</mention-page>.',
    )
  })

  it('leaves nothing for a page that only lists its children', () => {
    expect(stripChildReferences('<page url="a">A</page>\n<page url="b">B</page>')).toBe('')
  })
})

describe('chunkNotionPage', () => {
  it('returns nothing for an empty body', () => {
    expect(chunkNotionPage({ title: 'T', body: '  ' })).toEqual([])
  })

  it('keeps a small page in one chunk that opens with the title', () => {
    const chunks = chunkNotionPage({
      title: 'Google Maps ads',
      body: '## Requisitos\nPerfil vinculado.\n## Medição\nTipo de clique.',
    })
    expect(chunks).toEqual([
      '# Google Maps ads\n## Requisitos\nPerfil vinculado.\n## Medição\nTipo de clique.',
    ])
  })

  it('drops a leading H1 that repeats the title', () => {
    const chunks = chunkNotionPage({ title: 'Topic', body: '# Topic\n## A\ntext' })
    expect(chunks).toEqual(['# Topic\n## A\ntext'])
  })

  it('starts every chunk with the title and the heading path of its content', () => {
    const paragraph = (n: number) => `Paragraph ${n} ${'lorem ipsum dolor sit amet '.repeat(20)}`
    const body = [
      '## Passo 2',
      '### Nível de conta',
      ...Array.from({ length: 6 }, (_, i) => paragraph(i)).join('\n\n').split('\n'),
      '## Checklist',
      '- item',
    ].join('\n')
    const chunks = chunkNotionPage({ title: 'Maps', body, maxTokens: 300 })

    expect(chunks.length).toBeGreaterThan(2)
    for (const chunk of chunks) {
      expect(chunk.startsWith('# Maps\n')).toBe(true)
      expect(encode(chunk).length).toBeLessThanOrEqual(300)
    }
    // Every piece of the oversized section repeats its full heading path.
    const sectionChunks = chunks.filter((c) => c.includes('Paragraph'))
    for (const chunk of sectionChunks) {
      expect(chunk).toContain('## Passo 2\n### Nível de conta\n')
    }
    expect(chunks.at(-1)).toContain('## Checklist\n- item')
  })

  it('does not repeat a shared parent heading for a sibling in the same chunk', () => {
    const chunks = chunkNotionPage({
      title: 'T',
      body: '## Parent\n### A\none\n### B\ntwo',
    })
    expect(chunks).toEqual(['# T\n## Parent\n### A\none\n### B\ntwo'])
  })

  it('keeps text that comes before the first heading', () => {
    const chunks = chunkNotionPage({ title: 'T', body: 'Lead text.\n## A\nbody' })
    expect(chunks).toEqual(['# T\nLead text.\n## A\nbody'])
  })
})
