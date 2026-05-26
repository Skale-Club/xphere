'use client'

// SubtaskChecklist | proper checklist with completion bar + inline add.
//
// Replaces the cramped "Add subtask..." + button inline at the bottom of the
// old SectionCard. Shows progress (X/Y) visually as a thin bar, plus a
// single-line composer that creates on Enter.

import * as React from 'react'
import { CheckCircle2, Circle, Loader2, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type { ProjectTaskRow } from '@/types/database'

interface Props {
  subtasks: ProjectTaskRow[]
  onToggle: (sub: ProjectTaskRow) => void
  onAdd: (name: string) => Promise<void>
}

export function SubtaskChecklist({ subtasks, onToggle, onAdd }: Props) {
  const [draft, setDraft] = React.useState('')
  const [adding, setAdding] = React.useState(false)

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
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">
          Subtasks {total > 0 && <span className="ml-1 text-text-secondary font-semibold">· {done}/{total}</span>}
        </h3>
        {total > 0 && (
          <div className="flex items-center gap-2 min-w-[80px]">
            <div className="h-1 flex-1 rounded-full bg-bg-tertiary overflow-hidden">
              <div
                className="h-full bg-accent transition-[width] duration-300 ease-out"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-[10.5px] text-text-tertiary tabular-nums w-7 text-right">{pct}%</span>
          </div>
        )}
      </div>

      {total > 0 && (
        <ul className="space-y-0.5">
          {subtasks.map((sub) => (
            <li key={sub.id}>
              <button
                type="button"
                onClick={() => onToggle(sub)}
                className={cn(
                  'group w-full flex items-center gap-2.5 py-1.5 px-1 -mx-1 rounded-md text-left text-[13px]',
                  'hover:bg-bg-tertiary/40 transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg-primary',
                )}
              >
                {sub.completed ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                ) : (
                  <Circle className="h-4 w-4 text-text-tertiary group-hover:text-text-secondary shrink-0" strokeWidth={1.75} />
                )}
                <span className={cn('flex-1 min-w-0 truncate', sub.completed && 'line-through text-text-tertiary')}>
                  {sub.name}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
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
          {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </section>
  )
}
