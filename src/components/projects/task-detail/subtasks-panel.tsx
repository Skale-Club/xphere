'use client'

// SubtasksPanel | persistent right-column panel inside the task detail modal.
//
// Shows direct children of the currently focused task. Clicking a subtask's
// name "drills into" it (the parent modal swaps focus + pushes a breadcrumb
// frame). Each row shows the checkbox, name, and a chevron when the subtask
// has its own children. New subtasks can be added inline.

import * as React from 'react'
import {
  CheckCircle2,
  ChevronRight,
  Circle,
  Loader2,
  Plus,
  ListTree,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type { ProjectTaskRow } from '@/types/database'

export interface SubtaskRow extends ProjectTaskRow {
  /** Direct-child count of THIS subtask | filled by the parent fetch */
  child_count?: number
}

interface Props {
  /** ID of the currently focused task (subtasks belong to this id) */
  parentTaskId: string
  subtasks: SubtaskRow[]
  loading?: boolean
  onToggle: (sub: SubtaskRow) => void
  onAdd: (name: string) => Promise<void>
  onDrillInto: (sub: SubtaskRow) => void
}

export function SubtasksPanel({
  parentTaskId,
  subtasks,
  loading,
  onToggle,
  onAdd,
  onDrillInto,
}: Props) {
  const [draft, setDraft] = React.useState('')
  const [adding, setAdding] = React.useState(false)

  // Reset draft when the parent (focused task) changes.
  React.useEffect(() => {
    setDraft('')
  }, [parentTaskId])

  const total = subtasks.length
  const done = subtasks.filter((s) => s.completed).length
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)

  async function handleAdd() {
    const name = draft.trim()
    if (!name) return
    setAdding(true)
    try {
      await onAdd(name)
      setDraft('')
    } finally {
      setAdding(false)
    }
  }

  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-border-subtle bg-bg-secondary/40">
      {/* Header */}
      <header className="px-4 py-3 border-b border-border-subtle flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 min-w-0">
          <ListTree className="h-3.5 w-3.5 text-text-tertiary shrink-0" />
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
            Subtasks
            {total > 0 && (
              <span className="ml-1.5 text-text-tertiary font-medium tracking-normal normal-case">
                {done}/{total}
              </span>
            )}
          </h3>
        </div>
        {total > 0 && (
          <div className="flex items-center gap-2 w-[88px]">
            <div className="h-1 flex-1 rounded-full bg-bg-tertiary overflow-hidden">
              <div
                className="h-full bg-accent transition-[width] duration-300 ease-out"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-[10.5px] text-text-tertiary tabular-nums w-7 text-right">
              {pct}%
            </span>
          </div>
        )}
      </header>

      {/* List */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2">
        {loading && (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-text-tertiary" />
          </div>
        )}

        {!loading && total === 0 && (
          <p className="px-2 py-6 text-center text-[12px] text-text-tertiary italic">
            No subtasks yet. Add one below to break this task down.
          </p>
        )}

        {!loading && total > 0 && (
          <ul className="space-y-0.5">
            {subtasks.map((sub) => (
              <li key={sub.id}>
                <div
                  className={cn(
                    'group flex items-center gap-2 rounded-md px-1.5 py-1.5',
                    'hover:bg-bg-tertiary/60 transition-colors',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onToggle(sub)}
                    aria-label={sub.completed ? 'Mark incomplete' : 'Mark complete'}
                    className={cn(
                      'shrink-0 text-text-tertiary hover:text-text-primary transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-full',
                    )}
                  >
                    {sub.completed ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : (
                      <Circle className="h-4 w-4" strokeWidth={1.75} />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDrillInto(sub)}
                    className={cn(
                      'flex-1 min-w-0 flex items-center gap-1.5 text-left text-[13px]',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded',
                      sub.completed && 'text-text-tertiary line-through',
                    )}
                  >
                    <span className="truncate">{sub.name}</span>
                    {typeof sub.child_count === 'number' && sub.child_count > 0 && (
                      <span className="shrink-0 text-[10.5px] text-text-tertiary tabular-nums bg-bg-tertiary/60 px-1.5 py-0.5 rounded">
                        {sub.child_count}
                      </span>
                    )}
                  </button>
                  <ChevronRight
                    className={cn(
                      'h-3.5 w-3.5 shrink-0 text-text-tertiary opacity-0 group-hover:opacity-100',
                      'transition-opacity',
                    )}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Add input */}
      <div className="px-3 py-2.5 border-t border-border-subtle flex gap-2">
        <Input
          className="h-8 text-[13px] flex-1"
          placeholder="Add subtask…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void handleAdd()
            }
          }}
        />
        <Button
          size="sm"
          variant="outline"
          className="h-8 px-2.5"
          onClick={() => void handleAdd()}
          disabled={adding || !draft.trim()}
        >
          {adding ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
    </aside>
  )
}
