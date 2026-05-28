'use client'

/**
 * Inline click-to-edit phone field for the company modal. Mirrors
 * InlineEditField's commit/rollback loop but swaps the plain <input> for the
 * shared <PhoneInput> (country flag + mask, stores E.164). Display mode renders
 * the formatted number via formatPhoneDisplay.
 */

import * as React from 'react'
import { Pencil } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { PhoneInput } from '@/components/ui/phone-input'
import { InlineEditActions } from '@/components/chat/inline-edit-field'
import { formatPhoneDisplay } from '@/lib/phone-numbers/format'

interface InlinePhoneFieldProps {
  value: string | null
  placeholder?: string
  /** Resolves to ok or rejects → component rolls back. Saves the E.164 value. */
  onSave: (next: string) => Promise<void>
  ariaLabel?: string
}

export function InlinePhoneField({
  value,
  placeholder = 'Add a phone number',
  onSave,
  ariaLabel,
}: InlinePhoneFieldProps) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState<string>(value ?? '')
  const [displayed, setDisplayed] = React.useState<string | null>(value)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!editing) {
      setDisplayed(value)
      setDraft(value ?? '')
    }
  }, [value, editing])

  async function commit() {
    const next = draft.trim()
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
    setDraft(displayed ?? '')
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex w-full items-center gap-1">
        <div className="min-w-0 flex-1">
          <PhoneInput value={draft} onChange={setDraft} aria-label={ariaLabel} />
        </div>
        <InlineEditActions
          saving={saving}
          onSave={() => void commit()}
          onCancel={cancel}
        />
      </div>
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
      )}
      title="Click to edit"
      aria-label={ariaLabel}
    >
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-[12.5px]',
          empty ? 'italic text-text-tertiary' : 'text-text-primary',
        )}
      >
        {empty ? placeholder : formatPhoneDisplay(displayed)}
      </span>
      <Pencil className="h-3 w-3 shrink-0 text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  )
}
