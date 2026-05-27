'use client'

/**
 * InlineEditPhoneField.
 *
 * Click-to-edit phone field for the chat contact info panel. Mirrors the UX
 * of `InlineEditField` (click to enter edit mode, blur or Enter to save,
 * Escape to cancel, optimistic + rollback + toast), but uses the proper
 * `PhoneInput` (react-international-phone) in edit mode so the user gets a
 * country flag selector and per-country masking. Always emits E.164 to the
 * server, which avoids the silent normalisation-to-null bug that the plain
 * `<input type="tel">` suffered from.
 */

import * as React from 'react'
import { Pencil } from 'lucide-react'
import { toast } from 'sonner'
import {
  defaultCountries,
  guessCountryByPartialPhoneNumber,
  type CountryIso2,
} from 'react-international-phone'

import { cn } from '@/lib/utils'
import { PhoneInput } from '@/components/ui/phone-input'

interface InlineEditPhoneFieldProps {
  /** Current value in E.164 (or null when unset). */
  value: string | null
  placeholder?: string
  /** Receives the new E.164 value (empty string when cleared). */
  onSave: (next: string) => Promise<void>
  ariaLabel?: string
  className?: string
}

/**
 * Best-effort country inference from a stored E.164 number. Falls back to
 * `us` so the editor always opens with a valid default.
 */
function inferCountry(value: string | null): CountryIso2 {
  if (!value) return 'us'
  try {
    const guess = guessCountryByPartialPhoneNumber({
      phone: value,
      countries: defaultCountries,
      currentCountryIso2: undefined,
    })
    return (guess?.country?.iso2 as CountryIso2 | undefined) ?? 'us'
  } catch {
    return 'us'
  }
}

export function InlineEditPhoneField({
  value,
  placeholder = 'Add phone',
  onSave,
  ariaLabel,
  className,
}: InlineEditPhoneFieldProps) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState<string>(value ?? '')
  const [displayed, setDisplayed] = React.useState<string | null>(value)
  const [saving, setSaving] = React.useState(false)
  const skipBlurRef = React.useRef(false)
  const wrapperRef = React.useRef<HTMLDivElement | null>(null)
  const editorCountry = React.useMemo(() => inferCountry(displayed), [displayed])

  // Keep local state in sync with external updates while not editing.
  React.useEffect(() => {
    if (!editing) {
      setDisplayed(value)
      setDraft(value ?? '')
    }
  }, [value, editing])

  // When entering edit mode, focus the first input inside the PhoneInput.
  React.useEffect(() => {
    if (!editing) return
    // PhoneInput renders a button + input; we want focus on the input.
    const inputEl = wrapperRef.current?.querySelector<HTMLInputElement>('input')
    inputEl?.focus()
    if (inputEl) {
      const len = inputEl.value.length
      try {
        inputEl.setSelectionRange(len, len)
      } catch {
        /* some input types don't support selection */
      }
    }
  }, [editing])

  async function commit(next: string) {
    const trimmed = next.trim()
    const current = displayed ?? ''
    // An empty editor returns the country's dial prefix (e.g. "+55") — treat
    // anything that has no digits beyond the prefix as a clear.
    const digitsOnly = trimmed.replace(/\D/g, '')
    const normalised = digitsOnly.length === 0 ? '' : trimmed

    if (normalised === current) {
      setEditing(false)
      return
    }

    const previous = displayed
    setDisplayed(normalised || null)
    setEditing(false)
    setSaving(true)
    try {
      await onSave(normalised)
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

  function handleKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      void commit(draft)
    }
  }

  // PhoneInput renders an internal button (flag dropdown trigger) and an
  // input — focus moves between them when opening the country list. We must
  // ignore blurs whose `relatedTarget` is still inside our wrapper.
  function handleBlur(e: React.FocusEvent<HTMLDivElement>) {
    if (skipBlurRef.current) {
      skipBlurRef.current = false
      return
    }
    const next = e.relatedTarget as Node | null
    if (next && e.currentTarget.contains(next)) {
      // Focus moved to the flag dropdown (still inside the editor) — keep editing.
      return
    }
    void commit(draft)
  }

  if (editing) {
    return (
      <div
        ref={wrapperRef}
        onKeyDown={handleKey}
        onBlur={handleBlur}
        className={cn('w-full', className)}
      >
        <PhoneInput
          value={draft}
          onChange={setDraft}
          defaultCountry={editorCountry}
          placeholder={placeholder}
          disabled={saving}
          aria-invalid={false}
        />
      </div>
    )
  }

  const empty = !displayed
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
