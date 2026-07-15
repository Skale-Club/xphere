import {
  Type, AlignLeft, Image as ImageIcon, MousePointerClick,
  Minus, MoveVertical, Code,
} from 'lucide-react'
import type { EmailBlockType } from '@/lib/email/render-template'

export interface BlockTypeMeta {
  type: EmailBlockType
  label: string
  description: string
  icon: React.ReactNode
}

/**
 * Source of truth for the block palette. Blocks are added by dragging a chip
 * from here onto the canvas (there is no in-column "+ Block" menu — that
 * affordance was removed; see `EditorApi.addBlock` removal, Phase 3 cleanup).
 * Order here is the order shown in the palette.
 */
export const BLOCK_TYPES: BlockTypeMeta[] = [
  { type: 'heading', label: 'Heading', description: 'Section title', icon: <Type className="h-4 w-4" /> },
  { type: 'text', label: 'Text', description: 'Paragraph of copy', icon: <AlignLeft className="h-4 w-4" /> },
  { type: 'image', label: 'Image', description: 'Upload a picture', icon: <ImageIcon className="h-4 w-4" /> },
  { type: 'button', label: 'Button', description: 'Call to action', icon: <MousePointerClick className="h-4 w-4" /> },
  { type: 'divider', label: 'Divider', description: 'Horizontal rule', icon: <Minus className="h-4 w-4" /> },
  { type: 'spacer', label: 'Spacer', description: 'Vertical gap', icon: <MoveVertical className="h-4 w-4" /> },
  { type: 'html', label: 'HTML', description: 'Raw email HTML', icon: <Code className="h-4 w-4" /> },
]

export const BLOCK_TYPE_LABEL: Record<EmailBlockType, string> = Object.fromEntries(
  BLOCK_TYPES.map((b) => [b.type, b.label]),
) as Record<EmailBlockType, string>
