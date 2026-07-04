'use client'

import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import type { EmailDocument, EmailBlock } from '@/lib/email/render-template'
import { makeBlockId } from '@/lib/email/render-template'
import { EmailTemplateEditor } from './email-template-editor'
import { updateSectionTemplate, updateSectionTemplateType } from '../actions'
import type { EmailTemplateBuilderRow, SectionTemplate } from '../actions'

/**
 * Standalone editor for a section template (email_section_templates). Wraps the
 * flat `{ blocks }` fragment as a single 1-column section so the full block
 * editor can drive it, and on save flattens the columns back to `{ blocks }`.
 * Runs the shared EmailTemplateEditor in `variant="section"` (no publish,
 * add-section, or section chrome). The section_type is edited inline via the
 * toolbar selector (persisted immediately, independent of the document Save).
 */
export function SectionTemplateEditor({ sectionTemplate }: { sectionTemplate: SectionTemplate }) {
  const [sectionType, setSectionType] = useState(sectionTemplate.section_type)
  const [, startTransition] = useTransition()

  const syntheticRow: EmailTemplateBuilderRow = useMemo(() => {
    const blocks = (sectionTemplate.document as { blocks?: EmailBlock[] }).blocks ?? []
    const doc: EmailDocument = {
      backgroundColor: '#f0f0f0',
      contentWidth: 600,
      fontFamily: 'Arial, Helvetica, sans-serif',
      sections: [
        {
          id: makeBlockId(),
          layout: 1,
          backgroundColor: '#ffffff',
          padding: { top: 16, right: 24, bottom: 16, left: 24 },
          columns: [blocks],
        },
      ],
    }
    return {
      id: sectionTemplate.id,
      org_id: sectionTemplate.org_id,
      name: sectionTemplate.name,
      description: null,
      status: 'draft',
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
        const blocks = doc.sections.flatMap((s) => s.columns.flat())
        return updateSectionTemplate(sectionTemplate.id, { blocks }, name)
      }}
    />
  )
}
