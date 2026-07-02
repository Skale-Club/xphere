import type { EmailDocument, EmailBlock } from './render-template'

export type BlockLocation = { sectionId: string; colIdx: number; index: number }

/** Find where a block currently lives. Returns null if the id is not in the doc. */
export function findBlockLocation(doc: EmailDocument, blockId: string): BlockLocation | null {
  for (const section of doc.sections) {
    const cols = section.columns ?? []
    for (let colIdx = 0; colIdx < cols.length; colIdx++) {
      const index = cols[colIdx].findIndex((b) => b.id === blockId)
      if (index !== -1) return { sectionId: section.id, colIdx, index }
    }
  }
  return null
}

/**
 * Return a NEW document with `block` inserted into section/column at `index`.
 * `index` is clamped to [0, column.length]. Unknown section/column → doc returned unchanged.
 * Pure: never mutates `doc`.
 */
export function insertBlockInColumn(
  doc: EmailDocument,
  sectionId: string,
  colIdx: number,
  index: number,
  block: EmailBlock,
): EmailDocument {
  const section = doc.sections.find((s) => s.id === sectionId)
  if (!section || colIdx < 0 || colIdx >= (section.columns?.length ?? 0)) return doc
  return {
    ...doc,
    sections: doc.sections.map((s) => {
      if (s.id !== sectionId) return s
      const columns = s.columns.map((col, ci) => {
        if (ci !== colIdx) return col
        const clamped = Math.max(0, Math.min(index, col.length))
        const next = col.slice()
        next.splice(clamped, 0, block)
        return next
      })
      return { ...s, columns }
    }),
  }
}

/**
 * Return a NEW document with `blockId` removed from wherever it is and re-inserted
 * into (toSectionId, toColIdx) at `toIndex`. Handles within-column reorder AND
 * cross-column move. If the block isn't found, or the target column doesn't exist,
 * returns `doc` unchanged. Pure: never mutates `doc`.
 *
 * Note on within-column reorder: we remove first, then clamp/insert against the
 * POST-removal column length. Callers pass the target index computed from the
 * over-item's position; splice-after-remove yields the intuitive drop slot.
 */
export function moveBlock(
  doc: EmailDocument,
  blockId: string,
  toSectionId: string,
  toColIdx: number,
  toIndex: number,
): EmailDocument {
  const from = findBlockLocation(doc, blockId)
  if (!from) return doc
  const target = doc.sections.find((s) => s.id === toSectionId)
  if (!target || toColIdx < 0 || toColIdx >= (target.columns?.length ?? 0)) return doc

  const block = doc.sections[
    doc.sections.findIndex((s) => s.id === from.sectionId)
  ].columns[from.colIdx][from.index]

  // 1. Remove from source (new arrays only where touched).
  const removed: EmailDocument = {
    ...doc,
    sections: doc.sections.map((s) => {
      if (s.id !== from.sectionId) return s
      const columns = s.columns.map((col, ci) =>
        ci === from.colIdx ? col.filter((b) => b.id !== blockId) : col,
      )
      return { ...s, columns }
    }),
  }

  // 2. Insert into target at clamped index.
  return insertBlockInColumn(removed, toSectionId, toColIdx, toIndex, block)
}
