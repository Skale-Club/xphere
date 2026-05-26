'use client'

// TaskHeader | top section of the task detail sheet.
//
// Contains:
//   - breadcrumb (project name · task id slice)
//   - inline-editable title (h1, controlled, saves on blur or Enter)
//   - dropdown menu with destructive actions (Delete via AlertDialog)
//   - saving indicator
//
// Replaces the original "tiny <Input> at top + AI View button floating right"
// layout that broke visual hierarchy.

import * as React from 'react'
import { Loader2, MoreHorizontal, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

interface Props {
  taskId: string
  projectName: string | null
  name: string
  saving: boolean
  onRename: (next: string) => void
  onDelete: () => Promise<void>
}

export function TaskHeader({
  taskId,
  projectName,
  name,
  saving,
  onRename,
  onDelete,
}: Props) {
  const [draft, setDraft] = React.useState(name)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)

  // Resync local draft when the task switches (key={taskId} on parent also
  // forces a fresh component, but this guards in-place updates too).
  React.useEffect(() => {
    setDraft(name)
  }, [name, taskId])

  function commit() {
    const next = draft.trim()
    if (next && next !== name) onRename(next)
    else if (!next) setDraft(name) // refuse empty rename
  }

  async function handleConfirmDelete() {
    setDeleting(true)
    try {
      await onDelete()
      setDeleteOpen(false)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <header className="px-5 sm:px-6 pt-5 pb-4 border-b border-border-subtle">
      <div className="flex items-center justify-between gap-3 text-[11px] text-text-tertiary">
        <div className="flex items-center gap-1.5 min-w-0">
          {projectName && <span className="truncate">{projectName}</span>}
          {projectName && <span aria-hidden>·</span>}
          <span className="font-mono shrink-0">#{taskId.slice(0, 8)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {saving && (
            <span className="flex items-center gap-1 text-text-tertiary">
              <Loader2 className="h-3 w-3 animate-spin" />
              Saving…
            </span>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                aria-label="Task actions"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault()
                  setDeleteOpen(true)
                }}
                className="text-destructive focus:text-destructive focus:bg-destructive/10"
              >
                <Trash2 className="h-3.5 w-3.5 mr-2" />
                Delete task
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <input
        className={cn(
          'mt-1.5 w-full bg-transparent text-[20px] font-semibold tracking-tight',
          'border-0 outline-none p-0',
          'placeholder:text-text-tertiary/50',
          'focus-visible:outline-none',
        )}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            ;(e.target as HTMLInputElement).blur()
          }
          if (e.key === 'Escape') {
            setDraft(name)
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        placeholder="Task title…"
        aria-label="Task title"
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this task?</AlertDialogTitle>
            <AlertDialogDescription>
              This is permanent. Subtasks, comments and execution runs attached
              to this task will be removed too.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                void handleConfirmDelete()
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
            >
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </header>
  )
}
