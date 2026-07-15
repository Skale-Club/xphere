'use client'

import { createContext, useContext } from 'react'
import type {
  EmailDocument,
  EmailSection,
  EmailBlock,
} from '@/lib/email/render-template'
import type { SectionTemplate } from '../../actions'

/**
 * The editor API shared across the palette, canvas and inspector via context —
 * avoids drilling ~15 callbacks through the section/column/block tree.
 *
 * All block mutations are keyed by the stable block `id`; the implementation
 * resolves the section/column location internally (findBlockLocation), so the
 * inspector only needs the selected block, not its coordinates.
 */
export interface EditorApi {
  doc: EmailDocument

  /** 'template' = full email (multi-section, publish). 'section' = a single
   *  section template (no add-section, no publish, no section chrome). */
  variant: 'template' | 'section'

  // ── Document-level email settings (Phase 3 — persisted in the
  //    `email_templates.subject_line` / `preview_text` columns, not the
  //    document jsonb). Always present in the API for a uniform Document
  //    inspector; 'section' variant callers just don't render the fields. ──
  subjectLine: string
  previewText: string
  setSubjectLine: (v: string) => void
  setPreviewText: (v: string) => void

  // ── Selection ──────────────────────────────────────────────
  selectedSectionId: string | null
  selectedBlockId: string | null
  selectBlock: (id: string | null) => void
  selectSection: (id: string | null) => void

  // ── Section mutations ──────────────────────────────────────
  addSection: (layout?: 1 | 2 | 3) => void
  removeSection: (sectionId: string) => void
  duplicateSection: (sectionId: string) => void
  updateSection: (sectionId: string, updates: Partial<EmailSection>) => void
  moveSection: (sectionId: string, dir: -1 | 1) => void

  // ── Block mutations ────────────────────────────────────────
  /** Inserts a saved section template as a NEW section (cloned ids), after
   *  `afterSectionId` — or at the document end when null. Section templates
   *  now store a full `EmailSection` (Phase 3), not a blocks-only fragment
   *  spliced into a column. */
  insertSectionTemplate: (afterSectionId: string | null, st: SectionTemplate) => void
  removeBlock: (blockId: string) => void
  duplicateBlock: (blockId: string) => void
  updateBlock: (blockId: string, updates: Partial<EmailBlock>) => void
  moveBlockDir: (blockId: string, dir: -1 | 1) => void

  // ── Raw doc setter (used by drag-and-drop handlers) ────────
  setDoc: (updater: (prev: EmailDocument) => EmailDocument) => void

  // ── Section templates ──────────────────────────────────────
  sectionTemplates: SectionTemplate[]
  openSaveSectionTemplate: (sectionId: string) => void
}

export const EditorContext = createContext<EditorApi | null>(null)

export function useEditor(): EditorApi {
  const ctx = useContext(EditorContext)
  if (!ctx) throw new Error('useEditor must be used within an EditorContext provider')
  return ctx
}
