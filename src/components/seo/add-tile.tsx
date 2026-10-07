'use client'

import { Plus } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * Dashed "add another" card that closes a grid of cards. Used as a dialog
 * trigger (`<DialogTrigger asChild>`), so it forwards ref and props.
 */
export function AddTile({
  label,
  hint,
  className,
  ...props
}: React.ComponentProps<'button'> & { label: string; hint?: string }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        'group flex h-full min-h-[172px] w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border',
        'text-text-tertiary transition-colors hover:border-accent/50 hover:bg-accent/[0.03] hover:text-text-primary',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        className,
      )}
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-bg-tertiary transition-colors group-hover:bg-accent/10 group-hover:text-accent">
        <Plus className="h-4 w-4" />
      </span>
      <span className="text-[13px] font-medium">{label}</span>
      {hint && <span className="max-w-[220px] text-center text-[12px] text-text-tertiary">{hint}</span>}
    </button>
  )
}
