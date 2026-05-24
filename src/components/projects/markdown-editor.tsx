'use client'

import * as React from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown } from 'tiptap-markdown'
import { cn } from '@/lib/utils'
import {
  Bold,
  Italic,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Code,
  Link as LinkIcon,
} from 'lucide-react'

interface Props {
  value: string
  onChange?: (md: string) => void
  onBlur?: (md: string) => void
  placeholder?: string
  className?: string
  minRows?: number
}

export function MarkdownEditor({ value, onChange, onBlur, placeholder = 'Add a description...', className, minRows = 4 }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        codeBlock: { languageClassPrefix: 'language-' },
      }),
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder }),
      Markdown.configure({ html: false, tightLists: true, transformPastedText: true }),
    ],
    content: value,
    editorProps: {
      attributes: {
        class: 'prose prose-sm dark:prose-invert max-w-none focus:outline-none min-h-[var(--editor-min-height)] py-2 px-0',
      },
    },
    onUpdate({ editor }) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onChange?.((editor.storage as any).markdown.getMarkdown())
    },
    onBlur({ editor }) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onBlur?.((editor.storage as any).markdown.getMarkdown())
    },
  })

  // Sync external value changes (e.g. task switch)
  const prevValue = React.useRef(value)
  React.useEffect(() => {
    if (!editor || value === prevValue.current) return
    prevValue.current = value
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const current = (editor.storage as any).markdown.getMarkdown()
    if (current !== value) {
      editor.commands.setContent(value, { emitUpdate: false })
    }
  }, [editor, value])

  function setLink() {
    if (!editor) return
    const url = window.prompt('URL:', editor.getAttributes('link').href ?? '')
    if (url === null) return
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
    }
  }

  const tools = [
    { icon: Bold, label: 'Bold', action: () => editor?.chain().focus().toggleBold().run(), active: () => editor?.isActive('bold') ?? false },
    { icon: Italic, label: 'Italic', action: () => editor?.chain().focus().toggleItalic().run(), active: () => editor?.isActive('italic') ?? false },
    { icon: Heading2, label: 'Heading 2', action: () => editor?.chain().focus().toggleHeading({ level: 2 }).run(), active: () => editor?.isActive('heading', { level: 2 }) ?? false },
    { icon: Heading3, label: 'Heading 3', action: () => editor?.chain().focus().toggleHeading({ level: 3 }).run(), active: () => editor?.isActive('heading', { level: 3 }) ?? false },
    { icon: List, label: 'Bullet list', action: () => editor?.chain().focus().toggleBulletList().run(), active: () => editor?.isActive('bulletList') ?? false },
    { icon: ListOrdered, label: 'Numbered list', action: () => editor?.chain().focus().toggleOrderedList().run(), active: () => editor?.isActive('orderedList') ?? false },
    { icon: Quote, label: 'Blockquote', action: () => editor?.chain().focus().toggleBlockquote().run(), active: () => editor?.isActive('blockquote') ?? false },
    { icon: Code, label: 'Code', action: () => editor?.chain().focus().toggleCode().run(), active: () => editor?.isActive('code') ?? false },
    { icon: LinkIcon, label: 'Link', action: setLink, active: () => editor?.isActive('link') ?? false },
  ]

  return (
    <div
      className={cn('rounded-md border border-input bg-background text-sm focus-within:ring-1 focus-within:ring-ring', className)}
      style={{ '--editor-min-height': `${minRows * 1.5}rem` } as React.CSSProperties}
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-input px-1.5 py-1">
        {tools.map(({ icon: Icon, label, action, active }) => (
          <button
            key={label}
            type="button"
            title={label}
            onMouseDown={(e) => { e.preventDefault(); action() }}
            className={cn(
              'rounded p-1 transition-colors hover:bg-accent',
              active() ? 'bg-accent text-foreground' : 'text-muted-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        ))}
      </div>

      {/* Editor content */}
      <div className="px-3">
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}
