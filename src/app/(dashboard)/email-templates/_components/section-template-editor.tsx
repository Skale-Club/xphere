'use client'

import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import type { EmailDocument } from '@/lib/email/render-template'
import { normalizeSectionTemplateDoc } from '@/lib/email/render-template'
import { EmailTemplateEditor } from './email-template-editor'
import { updateSectionTemplate, updateSectionTemplateType } from '../actions'
import type { EmailTemplateBuilderRow, SectionTemplate } from '../actions'

/**
 * Standalone editor for a section template (email_section_templates). Wraps
 * the stored `{ section }` document (upgrade-on-read from any legacy
 * `{ blocks }` row via normalizeSectionTemplateDoc) as a single-section
 * document so the full block editor can drive it — including the section's
 * own layout/background/padding, which now round-trip intact (Phase 3; the
 * legacy flatten-to-blocks-on-save lost them). Runs the shared
 * EmailTemplateEditor in `variant="section"` (no publish, add-section, or
 * section chrome). The section_type is edited inline via the toolbar
 * selector (persisted immediately, independent of the document Save).
 */
export function SectionTemplateEditor({ sectionTemplate }: { sectionTemplate: SectionTemplate }) {
  const [sectionType, setSectionType] = useState(sectionTemplate.section_type)
  const [, startTransition] = useTransition()

  const syntheticRow: EmailTemplateBuilderRow = useMemo(() => {
    const { section } = normalizeSectionTemplateDoc(sectionTemplate.document)
    const doc: EmailDocument = {
      backgroundColor: '#f0f0f0',
      contentWidth: 600,
      fontFamily: 'Arial, Helvetica, sans-serif',
      sections: [section],
    }
    return {
      id: sectionTemplate.id,
      org_id: sectionTemplate.org_id,
      name: sectionTemplate.name,
      description: null,
      status: 'draft',
      // Section templates have no subject/preview — not applicable outside
      // the full template editor (variant='template' hides those fields).
      subject_line: '',
      preview_text: '',
      document: doc,
      html_snapshot: null,
      plain_text_snapshot: null,
      folder_id: sectionTemplate.folder_id,
      position: sectionTemplate.position,
      created_by: null,
      created_at: sectionTemplate.created_at,
      updated_at: sectionTemplate.updated_at,
    }
  }, [sectionTemplate])

  return (
    <EmailTemplateEditor
      template={syntheticRow}
      sectionTemplates={[]}
      variant="section"
      sectionType={sectionType}
      onSectionTypeChange={(value) => {
        const prev = sectionType
        setSectionType(value)
        startTransition(async () => {
          const res = await updateSectionTemplateType(sectionTemplate.id, value)
          if (!res.ok) {
            setSectionType(prev)
            toast.error(res.error ?? 'Failed to update type')
          }
        })
      }}
      onSaveDocument={async (doc, name) => {
        // variant='section' never adds/removes sections (no add-section bar,
        // no section chrome), so doc.sections always has exactly the one
        // section this editor was seeded with.
        const section = doc.sections[0]
        if (!section) return { ok: false, error: 'Section is empty' }
        return updateSectionTemplate(sectionTemplate.id, { section }, name)
      }}
    />
  )
}
