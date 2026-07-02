import { describe, it, expect } from 'vitest'
import { findBlockLocation, insertBlockInColumn, moveBlock } from '@/lib/email/editor-dnd'
import type { EmailBlock, EmailDocument } from '@/lib/email/render-template'

function textBlock(id: string): EmailBlock {
  return { id, blockType: 'text', content: id, fontSize: 15, color: '#333', align: 'left' }
}

// Section 's1', 2 columns:
//   col0 = [a, b, c]   col1 = [x, y]
function doc(): EmailDocument {
  return {
    backgroundColor: '#f0f0f0',
    contentWidth: 600,
    sections: [
      {
        id: 's1',
        layout: 2,
        columns: [
          [textBlock('a'), textBlock('b'), textBlock('c')],
          [textBlock('x'), textBlock('y')],
        ],
      },
    ],
  }
}

const ids = (d: EmailDocument, colIdx: number) =>
  d.sections[0].columns[colIdx].map((b) => b.id)

describe('findBlockLocation', () => {
  it('locates a block by id', () => {
    expect(findBlockLocation(doc(), 'b')).toEqual({ sectionId: 's1', colIdx: 0, index: 1 })
    expect(findBlockLocation(doc(), 'y')).toEqual({ sectionId: 's1', colIdx: 1, index: 1 })
  })
  it('returns null for an unknown id', () => {
    expect(findBlockLocation(doc(), 'nope')).toBeNull()
  })
})

describe('insertBlockInColumn', () => {
  it('inserts at an exact index, shifting the rest right', () => {
    const next = insertBlockInColumn(doc(), 's1', 0, 1, textBlock('NEW'))
    expect(ids(next, 0)).toEqual(['a', 'NEW', 'b', 'c'])
  })
  it('clamps an out-of-range index to the end', () => {
    const next = insertBlockInColumn(doc(), 's1', 1, 99, textBlock('NEW'))
    expect(ids(next, 1)).toEqual(['x', 'y', 'NEW'])
  })
  it('returns the doc unchanged for a bad section/column', () => {
    const d = doc()
    expect(insertBlockInColumn(d, 'bogus', 0, 0, textBlock('NEW'))).toBe(d)
    expect(insertBlockInColumn(d, 's1', 5, 0, textBlock('NEW'))).toBe(d)
  })
  it('does not mutate the input document', () => {
    const d = doc()
    insertBlockInColumn(d, 's1', 0, 0, textBlock('NEW'))
    expect(ids(d, 0)).toEqual(['a', 'b', 'c'])
  })
})

describe('moveBlock — within a column', () => {
  it('reorders without changing the column length', () => {
    const next = moveBlock(doc(), 'a', 's1', 0, 2) // move 'a' toward the end
    expect(next.sections[0].columns[0]).toHaveLength(3)
    expect(ids(next, 0)).toContain('a')
    // 'a' removed from front then re-inserted; order changed
    expect(ids(next, 0)).not.toEqual(['a', 'b', 'c'])
  })
})

describe('moveBlock — across columns', () => {
  it('shrinks the source column and grows the target, preserving the id', () => {
    const next = moveBlock(doc(), 'b', 's1', 1, 0) // move 'b' from col0 to col1 head
    expect(ids(next, 0)).toEqual(['a', 'c'])          // source -1
    expect(ids(next, 1)).toEqual(['b', 'x', 'y'])     // target +1, id preserved at index 0
    expect(next.sections[0].columns[0]).toHaveLength(2)
    expect(next.sections[0].columns[1]).toHaveLength(3)
  })
  it('returns doc unchanged for an unknown block id', () => {
    const d = doc()
    expect(moveBlock(d, 'ghost', 's1', 0, 0)).toBe(d)
  })
  it('does not mutate the input document', () => {
    const d = doc()
    moveBlock(d, 'b', 's1', 1, 0)
    expect(ids(d, 0)).toEqual(['a', 'b', 'c'])
    expect(ids(d, 1)).toEqual(['x', 'y'])
  })
})
