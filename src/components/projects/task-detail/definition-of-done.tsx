'use client'

// DefinitionOfDone | callout for the "Expected Deliverable" field.
//
// Replaces the lonely <Input> wrapped in a SectionCard with a styled callout
// that visually signals "this is what done means" — accented border + target
// icon + helper text.

import * as React from 'react'
import { Target } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'

interface Props {
  taskId: string
  value: string
  onSave: (next: string) => void
}

export function DefinitionOfDone({ taskId, value, onSave }: Props) {
  const [draft, setDraft] = React.useState(value)

  // Reset draft when the task switches (defensive | parent already uses key).
  React.useEffect(() => {
    setDraft(value)
  }, [value, taskId])

  return (
    <section
      className={cn(
        'rounded-lg border border-accent/20 bg-accent/[0.04] px-3.5 py-3',
        'transition-colors focus-within:border-accent/40 focus-within:bg-accent/[0.06]',
      )}
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <Target className="h-3.5 w-3.5 text-accent" />
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-accent">
          Definition of done
        </h3>
      </div>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => {
          const next = e.target.value
          if (next !== value) onSave(next)
        }}
        placeholder="What should be delivered for this task to count as done?"
        className={cn(
          'border-0 shadow-none bg-transparent p-0 h-auto text-[13.5px] text-text-primary',
          'placeholder:text-text-tertiary/70 focus-visible:ring-0',
        )}
      />
    </section>
  )
}
