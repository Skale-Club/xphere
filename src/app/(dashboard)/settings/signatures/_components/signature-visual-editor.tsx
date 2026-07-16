'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  makeBlockId,
  normalizeDocument,
  type EmailDocument,
  type EmailSection,
} from '@/lib/email/render-template'
import { EmailTemplateEditor } from '@/app/(dashboard)/email-templates/_components/email-template-editor'
import type { EmailTemplateBuilderRow } from '@/app/(dashboard)/email-templates/actions'
import type { EmailSignatureRow } from '@/types/database'
import { saveSignature } from '../actions'

/**
 * Drag-and-drop visual builder for a signature, reusing the hardened
 * EmailTemplateEditor in `variant="section"` (no publish/subject/add-section
 * chrome) — the same embedding SectionTemplateEditor uses. The signature's
 * block document round-trips through the full block palette (text, image/logo,
 * button, divider, and a raw-HTML block for pasted markup). Saving compiles the
 * document to the paste-ready fragment via `saveSignature`.
 */
function emptySection(): EmailSection {
  return {
    id: makeBlockId(),
    layout: 1,
    backgroundColor: 'transparent',
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    columns: [[]],
  }
}

export function SignatureVisualEditor({ signature }: { signature: EmailSignatureRow }) {
  const router = useRouter()

  const syntheticRow: EmailTemplateBuilderRow = useMemo(() => {
    const normalized = normalizeDocument(signature.document)
    const doc: EmailDocument = {
      backgroundColor: normalized.backgroundColor ?? '#f0f0f0',
      contentWidth: normalized.contentWidth ?? 500,
      fontFamily: normalized.fontFamily ?? 'Arial, Helvetica, sans-serif',
      sections: normalized.sections.length > 0 ? normalized.sections : [emptySection()],
    }
    return {
      id: signature.id,
      org_id: signature.org_id,
      name: signature.name,
      description: null,
      status: 'draft',
      subject_line: '',
      preview_text: '',
      document: doc,
      html_snapshot: signature.html_snapshot,
      plain_text_snapshot: signature.plain_text_snapshot,
      folder_id: null,
      position: 0,
      created_by: signature.created_by,
      created_at: signature.created_at,
      updated_at: signature.updated_at,
    }
  }, [signature])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={() => router.push(`/settings/signatures/${signature.id}`)}
        >
          <ArrowLeft className="h-3.5 w-3.5" /> HTML editor &amp; export
        </Button>
        <span className="text-xs text-muted-foreground">Visual builder — drag blocks, then Save.</span>
      </div>
      <div className="min-h-0 flex-1">
        <EmailTemplateEditor
          template={syntheticRow}
          sectionTemplates={[]}
          variant="section"
          onSaveDocument={(doc, name) => saveSignature(signature.id, doc, name)}
        />
      </div>
    </div>
  )
}
