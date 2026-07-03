'use client'

import { useMemo } from 'react'
import type { EmailDocument, EmailBlock } from '@/lib/email/render-template'
import { makeBlockId } from '@/lib/email/render-template'
import { EmailTemplateEditor } from './email-template-editor'
import { updateReusableBlock } from '../actions'
import type { EmailTemplateBuilderRow, ReusableBlock } from '../actions'

/**
 * Standalone editor for a section template (reusable_email_blocks). Wraps the
 * flat `{ blocks }` fragment as a single 1-column section so the full block
 * editor can drive it, and on save flattens the columns back to `{ blocks }`.
 * Runs the shared EmailTemplateEditor in `variant="section"` (no publish,
 * add-section, or section chrome).
 */
export function SectionTemplateEditor({ block }: { block: ReusableBlock }) {
  const syntheticRow: EmailTemplateBuilderRow = useMemo(() => {
    const blocks = (block.document as { blocks?: EmailBlock[] }).blocks ?? []
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
      id: block.id,
      org_id: block.org_id,
      name: block.name,
      description: null,
      status: 'draft',
      document: doc,
      html_snapshot: null,
      plain_text_snapshot: null,
      folder_id: block.folder_id,
      position: block.position,
      created_by: null,
      created_at: block.created_at,
      updated_at: block.updated_at,
    }
  }, [block])

  return (
    <EmailTemplateEditor
      template={syntheticRow}
      reusableBlocks={[]}
      variant="section"
      onSaveDocument={async (doc, name) => {
        const blocks = doc.sections.flatMap((s) => s.columns.flat())
        return updateReusableBlock(block.id, { blocks }, name)
      }}
    />
  )
}
