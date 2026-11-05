'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import { FlagImage, type CountryIso2 } from 'react-international-phone'

import { PHONE_COUNTRIES } from '@/lib/auth/phone'
import { cn } from '@/lib/utils'

// The country next to the phone number field. A native <select> cannot show a
// flag inside its options, so this is a small listbox. The list is portalled
// to <body>: the sign-in box clips its overflow (for the gradient line) and
// would cut a list drawn inside it.

const POPUP_GAP = 6
const VIEWPORT_GAP = 8
const POPUP_WIDTH = 224
const POPUP_ID = 'country-code-picker-popup'

/** Marker the dialog looks for so a tap in the list does not count as "outside". */
export const COUNTRY_PICKER_POPUP_ATTR = 'data-country-code-picker-popup'

type PopupPosition = Pick<CSSProperties, 'left' | 'top' | 'width' | 'maxHeight'>

/** The part of the screen the phone keyboard leaves visible. */
function visibleViewport() {
  const vv = typeof window === 'undefined' ? null : window.visualViewport
  const top = vv?.offsetTop ?? 0
  const height = vv?.height ?? (typeof window === 'undefined' ? 0 : window.innerHeight)
  return { top, bottom: top + height }
}

export function CountryCodePicker({
  value,
  onChange,
  label,
  disabled = false,
  className,
}: {
  value: string
  onChange: (code: string) => void
  label: string
  disabled?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [popupPosition, setPopupPosition] = useState<PopupPosition | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const current = PHONE_COUNTRIES.find((c) => c.code === value) ?? PHONE_COUNTRIES[0]

  const positionPopup = useCallback(() => {
    const trigger = rootRef.current
    if (!trigger) return

    const rect = trigger.getBoundingClientRect()
    const desiredHeight = Math.min(PHONE_COUNTRIES.length * 44 + 8, 280)
    // Measured against what the keyboard leaves visible, so the list never opens behind it.
    const view = visibleViewport()
    const spaceBelow = view.bottom - rect.bottom - VIEWPORT_GAP - POPUP_GAP
    const spaceAbove = rect.top - view.top - VIEWPORT_GAP - POPUP_GAP
    const placeBelow = spaceBelow >= Math.min(desiredHeight, 176) || spaceBelow >= spaceAbove
    const availableHeight = placeBelow ? spaceBelow : spaceAbove
    const maxHeight = Math.max(120, Math.min(desiredHeight, availableHeight))
    const width = Math.min(POPUP_WIDTH, window.innerWidth - VIEWPORT_GAP * 2)
    const left = Math.max(VIEWPORT_GAP, Math.min(rect.left, window.innerWidth - width - VIEWPORT_GAP))
    const top = placeBelow
      ? rect.bottom + POPUP_GAP
      : Math.max(view.top + VIEWPORT_GAP, rect.top - POPUP_GAP - maxHeight)

    setPopupPosition({ left, top, width, maxHeight })
  }, [])

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      const target = e.target as Node
      if (!rootRef.current?.contains(target) && !listRef.current?.contains(target)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  useEffect(() => {
    if (!open) return
    positionPopup()
    window.addEventListener('resize', positionPopup)
    window.addEventListener('scroll', positionPopup, true)
    window.visualViewport?.addEventListener('resize', positionPopup)
    window.visualViewport?.addEventListener('scroll', positionPopup)
    return () => {
      window.removeEventListener('resize', positionPopup)
      window.removeEventListener('scroll', positionPopup, true)
      window.visualViewport?.removeEventListener('resize', positionPopup)
      window.visualViewport?.removeEventListener('scroll', positionPopup)
    }
  }, [open, positionPopup])

  useEffect(() => {
    if (!open) return
    listRef.current
      ?.querySelector<HTMLElement>(`#country-${PHONE_COUNTRIES[active].code}`)
      ?.scrollIntoView?.({ block: 'nearest' })
  }, [active, open])

  // Escape closes the list, not the dialog around it. Radix listens for Escape
  // on the document in the capture phase, before any handler on this element
  // runs, so stopping the event here is too late; a window capture listener
  // runs first and keeps it.
  useEffect(() => {
    if (!open) return
    const onEscape = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      e.preventDefault()
      setOpen(false)
      rootRef.current?.querySelector('button')?.focus()
    }
    window.addEventListener('keydown', onEscape, { capture: true })
    return () => window.removeEventListener('keydown', onEscape, { capture: true })
  }, [open])

  // Never leave a list hanging open over a locked form.
  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  const show = () => {
    setActive(Math.max(0, PHONE_COUNTRIES.findIndex((c) => c.code === current.code)))
    positionPopup()
    setOpen(true)
  }

  const pick = (code: string) => {
    onChange(code)
    setOpen(false)
    rootRef.current?.querySelector('button')?.focus()
  }

  const onTriggerKey = (e: KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      show()
      return
    }
    if (!open) return

    const last = PHONE_COUNTRIES.length - 1
    if (e.key === 'ArrowDown') setActive((i) => (i >= last ? 0 : i + 1))
    else if (e.key === 'ArrowUp') setActive((i) => (i <= 0 ? last : i - 1))
    else if (e.key === 'Home') setActive(0)
    else if (e.key === 'End') setActive(last)
    else if (e.key === 'Enter' || e.key === ' ') pick(PHONE_COUNTRIES[active].code)
    else if (e.key === 'Tab') {
      setOpen(false)
      return
    } else return
    e.preventDefault()
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onTriggerKey}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={POPUP_ID}
        aria-activedescendant={open ? `country-${PHONE_COUNTRIES[active].code}` : undefined}
        aria-label={`${label}: ${current.label} +${current.code}`}
        data-testid="select-country-code"
        className={cn(
          'flex h-12 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-base text-[#FAFAFA] transition-colors',
          'hover:border-white/20 hover:bg-white/[0.07] focus-visible:outline-none focus-visible:border-indigo-500/60 focus-visible:ring-2 focus-visible:ring-indigo-500/40',
          'disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm',
          className,
        )}
      >
        <FlagImage iso2={current.iso.toLowerCase() as CountryIso2} size={20} />
        <span className="tabular-nums">+{current.code}</span>
        <ChevronDown
          className={cn('h-4 w-4 text-white/40 transition-transform', open && 'rotate-180')}
        />
      </button>
      {open &&
        popupPosition &&
        typeof document !== 'undefined' &&
        createPortal(
          <ul
            ref={listRef}
            id={POPUP_ID}
            role="listbox"
            aria-label={label}
            {...{ [COUNTRY_PICKER_POPUP_ATTR]: '' }}
            style={popupPosition}
            // pointer-events-auto: Radix's modal dialog turns them off for everything outside it.
            className="pointer-events-auto fixed z-[100] overflow-y-auto rounded-xl border border-white/10 bg-[#0F1013] p-1 shadow-[0_12px_32px_rgba(0,0,0,0.6)] outline-none"
          >
            {PHONE_COUNTRIES.map((c, i) => (
              <li
                key={c.code}
                id={`country-${c.code}`}
                role="option"
                aria-selected={c.code === current.code}
                onPointerEnter={() => setActive(i)}
                // Keep focus where it is so tapping an option does not blur the trigger first.
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => pick(c.code)}
                className={cn(
                  'flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm text-[#FAFAFA]',
                  i === active && 'bg-white/10',
                )}
              >
                <FlagImage iso2={c.iso.toLowerCase() as CountryIso2} size={20} />
                <span className="flex-1">{c.label}</span>
                <span className="tabular-nums text-white/50">+{c.code}</span>
                {c.code === current.code ? (
                  <Check className="h-4 w-4 text-indigo-300" />
                ) : (
                  <span className="h-4 w-4" />
                )}
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </div>
  )
}
