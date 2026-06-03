'use client'

// TaskHeader | top section of the task detail sheet.
//
// Contains:
//   - breadcrumb (project name · ancestor task chain · current task id slice)
//     | crumbs are clickable when an onClick is provided so users can navigate
//     | back up the focus stack
//   - inline-editable title (h1, controlled, saves on blur or Enter)
//   - dropdown menu with destructive actions (Delete via AlertDialog)
//   - saving indicator

import * as React from 'react'
import { Archive, ChevronRight, Loader2, MoreHorizontal, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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

export interface BreadcrumbCrumb {
  label: string
  onClick?: () => void
}

interface Props {
  taskId: string
  projectName: string | null
  name: string
  saving: boolean
  /**
   * Optional ancestor chain of focused tasks (not including the current one).
   * Each crumb is clickable when onClick is provided | renders inert otherwise.
   * The current task is rendered at the end of the chain as a static crumb.
   */
  crumbs?: BreadcrumbCrumb[]
  onRename: (next: string) => void
  onDelete: () => Promise<void>
  onArchive?: () => Promise<void>
}

export function TaskHeader({
  taskId,
  projectName,
  name,
  saving,
  crumbs,
  onRename,
  onDelete,
  onArchive,
}: Props) {
  const [draft, setDraft] = React.useState(name)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [archiving, setArchiving] = React.useState(false)

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

  async function handleArchive() {
    if (!onArchive) return
    setArchiving(true)
    try {
      await onArchive()
    } finally {
      setArchiving(false)
    }
  }

  return (
    <header className="px-5 sm:px-6 pt-5 pb-4 border-b border-border-subtle">
      <div className="flex items-center justify-between gap-3 text-[11px] text-text-tertiary">
        <nav aria-label="Task breadcrumb" className="flex items-center gap-1 min-w-0 flex-wrap">
          {projectName && (
            <>
              <span className="truncate max-w-[140px]">{projectName}</span>
              <ChevronRight className="h-3 w-3 shrink-0 text-text-tertiary/70" aria-hidden />
            </>
          )}
          {crumbs?.map((c, i) => (
            <React.Fragment key={`${c.label}-${i}`}>
              {c.onClick ? (
                <button
                  type="button"
                  onClick={c.onClick}
                  className={cn(
                    'truncate max-w-[140px] hover:text-text-primary transition-colors',
                    'focus-visible:outline-none focus-visible:underline rounded',
                  )}
                >
                  {c.label}
                </button>
              ) : (
                <span className="truncate max-w-[140px]">{c.label}</span>
              )}
              <ChevronRight className="h-3 w-3 shrink-0 text-text-tertiary/70" aria-hidden />
            </React.Fragment>
          ))}
          <span className="font-mono shrink-0 text-text-tertiary/80">
            #{taskId.slice(0, 8)}
          </span>
        </nav>
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
              {onArchive && (
                <DropdownMenuItem
                  onSelect={(e) => { e.preventDefault(); void handleArchive() }}
                  disabled={archiving}
                >
                  {archiving
                    ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                    : <Archive className="h-3.5 w-3.5 mr-2" />}
                  Archive task
                </DropdownMenuItem>
              )}
              {onArchive && <DropdownMenuSeparator />}
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
