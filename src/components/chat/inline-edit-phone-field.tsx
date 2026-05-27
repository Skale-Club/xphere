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
import { toast } from 'sonner'
import {
  defaultCountries,
  guessCountryByPartialPhoneNumber,
  type CountryIso2,
} from 'react-international-phone'

import { cn } from '@/lib/utils'
import { PhoneInput } from '@/components/ui/phone-input'
import { formatPhoneDisplay } from '@/lib/phone-numbers/format'
import { prefillDialPad } from '@/components/calls/dial-pad-context'
import { useDialpadAvailable } from '@/components/phone/dialpad-availability-context'
import { InlineEditActions } from './inline-edit-field'
import { Phone } from 'lucide-react'

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
        className={cn('flex w-full items-center gap-1', className)}
      >
        <div className="min-w-0 flex-1">
          <PhoneInput
            value={draft}
            onChange={setDraft}
            defaultCountry={editorCountry}
            placeholder={placeholder}
            disabled={saving}
            aria-invalid={false}
          />
        </div>
        <InlineEditActions saving={saving} onSave={() => void commit(draft)} onCancel={cancel} />
      </div>
    )
  }

  const empty = !displayed
  const dialpadAvailable = useDialpadAvailable()
  const formatted = displayed ? formatPhoneDisplay(displayed) : ''

  // Empty state: the whole row enters edit mode on click (there's no number
  // to call, so we don't need to split call vs edit affordances).
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

  // Populated state: the value is clickable to enter edit mode; a separate
  // action button on the right fires call (dialpad or tel:). Both always
  // visible — no more hover-revealed pencil.
  return (
    <div className={cn('inline-flex w-full items-center gap-1.5', className)}>
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={ariaLabel ?? 'Edit phone'}
        className={cn(
          'min-w-0 flex-1 truncate rounded-[6px] px-1.5 py-0.5 text-left text-[12.5px] text-text-primary tabular-nums',
          'hover:bg-bg-tertiary transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        )}
        title="Click to edit"
      >
        {formatted}
      </button>
      {dialpadAvailable ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            prefillDialPad(displayed!)
          }}
          aria-label="Call"
          title={`Call ${displayed}`}
          className="shrink-0 rounded p-1 text-text-tertiary hover:text-accent hover:bg-bg-tertiary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <Phone className="h-3 w-3" />
        </button>
      ) : (
        <a
          href={`tel:${displayed}`}
          onClick={(e) => e.stopPropagation()}
          aria-label="Call"
          title={`Call ${displayed}`}
          className="shrink-0 rounded p-1 text-text-tertiary hover:text-accent hover:bg-bg-tertiary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <Phone className="h-3 w-3" />
        </a>
      )}
    </div>
  )
}
