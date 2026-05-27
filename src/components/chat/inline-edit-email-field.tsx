'use client'

/**
 * InlineEditEmailField.
 *
 * Click-to-edit email field for the chat contact info panel. Mirrors the
 * UX of InlineEditField (click to enter, blur/Enter to save, Escape to
 * cancel, optimistic + rollback + toast) but adds **strict email format
 * validation** before calling onSave — the underlying server action also
 * validates, but doing it here too means the operator gets an immediate
 * toast and stays in edit mode to fix the typo instead of seeing the
 * value silently disappear.
 *
 * Display mode renders a small amber warning icon when the saved value
 * is malformed (legacy data that predates strict validation) so the
 * operator knows to click and fix it.
 */

import * as React from 'react'
import { Pencil, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { normaliseEmailStrict, isValidEmail } from '@/lib/contacts/zod-schemas'

interface InlineEditEmailFieldProps {
  value: string | null
  placeholder?: string
  /** Server save callback. Receives the validated, lowercased email (or empty string). */
  onSave: (next: string) => Promise<void>
  ariaLabel?: string
  className?: string
}

export function InlineEditEmailField({
  value,
  placeholder = 'Add email',
  onSave,
  ariaLabel,
  className,
}: InlineEditEmailFieldProps) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState<string>(value ?? '')
  const [displayed, setDisplayed] = React.useState<string | null>(value)
  const [saving, setSaving] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const skipBlurRef = React.useRef(false)

  React.useEffect(() => {
    if (!editing) {
      setDisplayed(value)
      setDraft(value ?? '')
    }
  }, [value, editing])

  React.useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      try {
        inputRef.current?.setSelectionRange(
          inputRef.current.value.length,
          inputRef.current.value.length,
        )
      } catch {
        /* ignore */
      }
    }
  }, [editing])

  async function commit() {
    const result = normaliseEmailStrict(draft)
    if (!result.ok) {
      toast.error(result.error)
      // Stay in edit mode so the user can fix it
      skipBlurRef.current = true
      requestAnimationFrame(() => inputRef.current?.focus())
      return
    }
    const next = result.value ?? ''
    const current = displayed ?? ''
    if (next === current) {
      setEditing(false)
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

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
      return
    }
    if (e.key === 'Enter') {
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
    return (
      <input
        ref={inputRef}
        type="email"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKey}
        onBlur={handleBlur}
        disabled={saving}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={cn(
          'w-full rounded-[6px] border border-accent/60 bg-bg-primary px-2 py-1 text-[12.5px] text-text-primary',
          'outline-none ring-[3px] ring-accent/15',
          className,
        )}
      />
    )
  }

  const empty = !displayed
  const malformed = !empty && !isValidEmail(displayed)

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      aria-label={ariaLabel}
      className={cn(
        'group inline-flex w-full items-center gap-1.5 rounded-[6px] px-1.5 py-0.5 text-left',
        'hover:bg-bg-tertiary transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        className,
      )}
      title={malformed ? 'Invalid email format — click to fix' : 'Click to edit'}
    >
      {malformed && (
        <AlertTriangle className="h-3 w-3 shrink-0 text-amber-400" />
      )}
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-[12.5px]',
          empty
            ? 'italic text-text-tertiary'
            : malformed
              ? 'text-amber-200'
              : 'text-text-primary',
        )}
      >
        {empty ? placeholder : displayed}
      </span>
      <Pencil className="h-3 w-3 shrink-0 text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  )
}
