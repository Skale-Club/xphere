import { describe, it, expect } from 'vitest'
import {
  renderTemplate,
  normalizeDocument,
  makeBlockId,
  type EmailBlock,
  type EmailDocument,
} from '@/lib/email/render-template'

// A "legacy" document as it exists in the DB today: blocks have NO id.
function legacyDoc(): Record<string, unknown> {
  return {
    backgroundColor: '#f0f0f0',
    contentWidth: 600,
    fontFamily: 'Arial, sans-serif',
    sections: [
      {
        id: 's1',
        layout: 2,
        columns: [
          [
            { blockType: 'heading', content: 'Welcome', level: 1, color: '#111', align: 'center' },
            { blockType: 'text', content: 'Hello <strong>world</strong>', fontSize: 16, color: '#333', align: 'left' },
          ],
          [
            { blockType: 'button', label: 'Go', href: 'https://xphere.app', backgroundColor: '#000', textColor: '#fff', borderRadius: 4 },
            { blockType: 'divider', color: '#ccc', thickness: 2 },
            { blockType: 'spacer', height: 40 },
          ],
        ],
      },
    ],
  }
}

function allBlockIds(doc: EmailDocument): string[] {
  return doc.sections.flatMap((s) => s.columns.flat().map((b) => b.id))
}

describe('normalizeDocument — id backfill', () => {
  it('backfills a non-empty id on every block of a legacy document', () => {
    const doc = normalizeDocument(legacyDoc())
    const ids = allBlockIds(doc)
    expect(ids).toHaveLength(5)
    for (const id of ids) {
      expect(typeof id).toBe('string')
      expect(id.length).toBeGreaterThan(0)
    }
  })

  it('assigns unique ids across all blocks', () => {
    const doc = normalizeDocument(legacyDoc())
    const ids = allBlockIds(doc)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('is idempotent — existing ids are preserved on a second normalize', () => {
    const first = normalizeDocument(legacyDoc())
    const second = normalizeDocument(first)
    expect(allBlockIds(second)).toEqual(allBlockIds(first))
    expect(second.sections[0].id).toBe(first.sections[0].id)
  })

  it('falls back to an empty document for non-document input', () => {
    expect(normalizeDocument(null).sections).toEqual([])
    expect(normalizeDocument([] as unknown).sections).toEqual([])
    expect(normalizeDocument({ foo: 'bar' }).sections).toEqual([])
  })

  it('does not mutate its input', () => {
    const raw = legacyDoc()
    const rawFirstBlock = (raw.sections as { columns: unknown[][] }[])[0].columns[0][0] as Record<string, unknown>
    normalizeDocument(raw)
    expect(rawFirstBlock.id).toBeUndefined()
  })
})

describe('renderTemplate — HTML is unchanged by ids', () => {
  it('produces byte-identical HTML before and after id backfill', () => {
    const raw = legacyDoc()
    const before = renderTemplate(raw).html
    const normalized = normalizeDocument(raw)
    const after = renderTemplate(normalized).html
    expect(after).toBe(before)
  })

  it('never emits a backfilled block id into the HTML', () => {
    const normalized = normalizeDocument(legacyDoc())
    const { html } = renderTemplate(normalized)
    for (const id of allBlockIds(normalized)) {
      expect(html).not.toContain(id)
    }
  })
})

describe('reusable-block re-mint — distinct ids (data-level guarantee)', () => {
  it('re-minting a saved block set twice yields disjoint id sets', () => {
    // Simulate a saved reusable block: two blocks that already carry ids.
    const saved: EmailBlock[] = [
      { id: 'saved-a', blockType: 'text', content: 'A', fontSize: 14, color: '#333', align: 'left' },
      { id: 'saved-b', blockType: 'divider', color: '#ccc', thickness: 1 },
    ]
    // The editor's insertReusableBlock does exactly this on each insert:
    const remint = (blocks: EmailBlock[]) => blocks.map((b) => ({ ...b, id: makeBlockId() }))
    const firstInsert = remint(saved)
    const secondInsert = remint(saved)

    const firstIds = firstInsert.map((b) => b.id)
    const secondIds = secondInsert.map((b) => b.id)

    // No collision with the saved originals, and the two inserts are disjoint.
    expect(firstIds).not.toContain('saved-a')
    expect(new Set([...firstIds, ...secondIds]).size).toBe(4)
  })
})
