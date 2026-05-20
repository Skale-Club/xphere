'use client'

/**
 * InlineEditField (SEED-039).
 *
 * A click-to-edit field used throughout the contact info panel. Click to
 * reveal an input (or textarea when `multiline`), Enter or blur to save,
 * Escape to cancel. Optimistic — shows the new value immediately and rolls
 * back if `onSave` rejects. Toasts on success / error.
 *
 * Intentionally framework-light: no react-hook-form, no zod here. Validation
 * happens on the server action; this component only orchestrates the UI loop.
 */

import * as React from 'react'
import { Pencil } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'

interface InlineEditFieldProps {
  value: string | null
  placeholder?: string
  /** Resolves to ok or rejects → component rolls back. */
  onSave: (next: string) => Promise<void>
  type?: 'text' | 'tel' | 'email'
  multiline?: boolean
  /** Optional className applied to the display element. */
  className?: string
  /** Optional className for the input element. */
  inputClassName?: string
  /** Optional aria-label for the input. */
  ariaLabel?: string
  /** When true, an empty save is allowed (clears the field). Default false. */
  allowEmpty?: boolean
}

export function InlineEditField({
  value,
  placeholder = 'Click to add',
  onSave,
  type = 'text',
  multiline = false,
  className,
  inputClassName,
  ariaLabel,
  allowEmpty = true,
}: InlineEditFieldProps) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState<string>(value ?? '')
  const [displayed, setDisplayed] = React.useState<string | null>(value)
  const [saving, setSaving] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const skipBlurRef = React.useRef(false)

  // Sync external value changes when not editing.
  React.useEffect(() => {
    if (!editing) {
      setDisplayed(value)
      setDraft(value ?? '')
    }
  }, [value, editing])

  React.useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      // Move caret to end on focus.
      if (inputRef.current && 'setSelectionRange' in inputRef.current) {
        const len = inputRef.current.value.length
        try {
          inputRef.current.setSelectionRange(len, len)
        } catch {
          // ignore — some input types don't support selection
        }
      }
    }
  }, [editing])

  async function commit() {
    const next = draft.trim()
    const current = displayed ?? ''
    if (next === current) {
      setEditing(false)
      return
    }
    if (!next && !allowEmpty) {
      toast.error('Value cannot be empty')
      return
    }
    const previous = displayed
    setDisplayed(next || null)
    setEditing(false)
    setSaving(true)
    try {
      await onSave(next)
      toast.success('Saved')
    } catch (e) {
      setDisplayed(previous)
      setDraft(previous ?? '')
      toast.error(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  function cancel() {
    skipBlurRef.current = true
    setDraft(displayed ?? '')
    setEditing(false)
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
      return
    }
    if (e.key === 'Enter' && !(multiline && e.shiftKey)) {
      e.preventDefault()
      void commit()
    }
  }

  function handleBlur() {
    if (skipBlurRef.current) {
      skipBlurRef.current = false
      return
    }
    void commit()
  }

  if (editing) {
    const sharedClasses = cn(
      'w-full rounded-[6px] border border-accent/60 bg-bg-primary px-2 py-1 text-[12.5px] text-text-primary',
      'outline-none ring-[3px] ring-accent/15',
      inputClassName,
    )
    return multiline ? (
      <textarea
        ref={(el) => {
          inputRef.current = el
        }}
        value={draft}
        rows={3}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKey}
        onBlur={handleBlur}
        disabled={saving}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={cn(sharedClasses, 'resize-y leading-relaxed')}
      />
    ) : (
      <input
        ref={(el) => {
          inputRef.current = el
        }}
        type={type}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKey}
        onBlur={handleBlur}
        disabled={saving}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={sharedClasses}
      />
    )
  }

  const empty = !displayed
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={cn(
        'group inline-flex w-full items-center gap-1.5 rounded-[6px] px-1.5 py-0.5 text-left',
        'hover:bg-bg-tertiary transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        className,
      )}
      title="Click to edit"
    >
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-[12.5px]',
          empty ? 'italic text-text-tertiary' : 'text-text-primary',
        )}
      >
        {empty ? placeholder : displayed}
      </span>
      <Pencil className="h-3 w-3 shrink-0 text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  )
}
