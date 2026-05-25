'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { renameToolConfig } from '@/app/(dashboard)/workflows/actions'
import { useBreadcrumbOverride } from '@/components/layout/breadcrumb-override-context'

interface Props {
  toolConfigId: string
  initialName: string
}

export function InlineToolName({ toolConfigId, initialName }: Props) {
  const [name, setName] = React.useState(initialName)
  const [draft, setDraft] = React.useState(initialName)
  const [editing, setEditing] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const { setSegmentLabel } = useBreadcrumbOverride()

  React.useEffect(() => {
    setSegmentLabel(toolConfigId, name)
  }, [toolConfigId, name, setSegmentLabel])

  React.useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  function startEditing() {
    setDraft(name)
    setEditing(true)
  }

  function save() {
    const trimmed = draft.trim()
    if (!trimmed || trimmed === name) {
      setEditing(false)
      return
    }
    startTransition(async () => {
      const result = await renameToolConfig(toolConfigId, trimmed)
      if (result?.error) {
        toast.error(result.error)
      } else {
        setName(trimmed)
        setEditing(false)
      }
    })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') save()
    if (e.key === 'Escape') setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="text-lg font-semibold bg-transparent border-b border-border outline-none w-full max-w-sm disabled:opacity-60"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={handleKeyDown}
        disabled={isPending}
        autoFocus
      />
    )
  }

  return (
    <h1
      className="text-lg font-semibold cursor-pointer hover:opacity-70 transition-opacity"
      onClick={startEditing}
      title="Click to rename"
    >
      {name}
    </h1>
  )
}
