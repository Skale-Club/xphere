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
import { Mail, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { normaliseEmailStrict, isValidEmail } from '@/lib/contacts/zod-schemas'
import { InlineEditActions } from './inline-edit-field'

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

  function handleWrapperBlur(e: React.FocusEvent<HTMLDivElement>) {
    if (skipBlurRef.current) {
      skipBlurRef.current = false
      return
    }
    const next = e.relatedTarget as Node | null
    if (next && e.currentTarget.contains(next)) return
    void commit()
  }

  if (editing) {
    return (
      <div
        className={cn('flex w-full items-center gap-1', className)}
        onBlur={handleWrapperBlur}
      >
        <input
          ref={inputRef}
          type="email"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKey}
          disabled={saving}
          placeholder={placeholder}
          aria-label={ariaLabel}
          className={cn(
            'w-full rounded-[6px] border border-accent/60 bg-bg-primary px-2 py-1 text-[12.5px] text-text-primary',
            'outline-none ring-[3px] ring-accent/15',
          )}
        />
        <InlineEditActions saving={saving} onSave={() => void commit()} onCancel={cancel} />
      </div>
    )
  }

  const empty = !displayed
  const malformed = !empty && !isValidEmail(displayed)

  // Empty: whole row enters edit mode (no value to act on).
  if (empty) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={ariaLabel}
        className={cn(
          'inline-flex w-full items-center gap-1.5 rounded-[6px] px-1.5 py-0.5 text-left',
          'hover:bg-bg-tertiary transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
          className,
        )}
        title="Click to edit"
      >
        <span className="min-w-0 flex-1 truncate text-[12.5px] italic text-text-tertiary">
          {placeholder}
        </span>
      </button>
    )
  }

  // Populated: value text is clickable to edit; right action icon opens mailto.
  return (
    <div className={cn('inline-flex w-full items-center gap-1.5', className)}>
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={ariaLabel}
        className={cn(
          'min-w-0 flex-1 truncate rounded-[6px] px-1.5 py-0.5 text-left text-[12.5px] flex items-center gap-1.5',
          'hover:bg-bg-tertiary transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
          malformed ? 'text-amber-200' : 'text-text-primary',
        )}
        title={malformed ? 'Invalid email format — click to fix' : 'Click to edit'}
      >
        {malformed && <AlertTriangle className="h-3 w-3 shrink-0 text-amber-400" />}
        <span className="truncate">{displayed}</span>
      </button>
      {!malformed && (
        <a
          href={`mailto:${displayed}`}
          onClick={(e) => e.stopPropagation()}
          aria-label="Send email"
          title={`Send email to ${displayed}`}
          className="shrink-0 rounded p-1 text-text-tertiary hover:text-accent hover:bg-bg-tertiary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <Mail className="h-3 w-3" />
        </a>
      )}
    </div>
  )
}
