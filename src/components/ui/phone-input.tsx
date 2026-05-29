'use client'

import * as React from 'react'
import {
  defaultCountries,
  parseCountry,
  usePhoneInput,
  FlagImage,
  type CountryIso2,
  type ParsedCountry,
} from 'react-international-phone'
import { ChevronDown, Search } from 'lucide-react'

import { cn } from '@/lib/utils'

interface PhoneInputProps {
  value: string
  onChange: (value: string) => void
  defaultCountry?: CountryIso2
  /** Allowed countries | defaults to the full list. */
  preferredCountries?: CountryIso2[]
  placeholder?: string
  disabled?: boolean
  name?: string
  id?: string
  className?: string
  /** Aria invalid (for form error highlighting). */
  'aria-invalid'?: boolean
  'aria-label'?: string
}

/**
 * International phone input with a searchable flag dropdown + per-country mask.
 *
 * Default country is US (`us`). Phone values are stored in E.164 format
 * (e.g. `+14155551234`). Use this everywhere a user enters a phone number
 * | never a plain text input.
 *
 * Built on react-international-phone's `usePhoneInput` hook so we own the
 * country selector: it has a search box and high-contrast list styling.
 */
export function PhoneInput({
  value,
  onChange,
  defaultCountry = 'us',
  preferredCountries,
  placeholder,
  disabled,
  name,
  id,
  className,
  ...rest
}: PhoneInputProps) {
  const ariaInvalid = rest['aria-invalid']
  const ariaLabel = rest['aria-label']

  // Restrict / reorder the country list if `preferredCountries` is passed |
  // otherwise show all 250+ countries (default).
  const countries = React.useMemo(() => {
    if (!preferredCountries?.length) return defaultCountries
    const set = new Set(preferredCountries)
    const preferred = defaultCountries.filter((c) => set.has(parseCountry(c).iso2))
    const rest = defaultCountries.filter((c) => !set.has(parseCountry(c).iso2))
    return [...preferred, ...rest]
  }, [preferredCountries])

  const { inputValue, country, setCountry, handlePhoneValueChange, inputRef } =
    usePhoneInput({
      defaultCountry,
      value,
      countries,
      onChange: (data) => onChange(data.phone),
    })

  const [open, setOpen] = React.useState(false)
  const wrapperRef = React.useRef<HTMLDivElement | null>(null)

  // Close on outside click.
  React.useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  // Close the dropdown while keeping focus inside the wrapper. The inline
  // editors commit-and-exit on any blur that leaves the wrapper, so we must
  // move focus to the phone input *before* the dropdown (and its focused
  // search box) unmounts | otherwise focus drops to <body> and the editor
  // closes out from under the user.
  function closeAndFocus() {
    inputRef.current?.focus()
    setOpen(false)
  }

  function handleSelect(iso2: CountryIso2) {
    setCountry(iso2)
    closeAndFocus()
  }

  return (
    <div
      ref={wrapperRef}
      className={cn('vo-phone-input', className)}
      aria-invalid={ariaInvalid ? 'true' : undefined}
    >
      <button
        type="button"
        className="vo-phone-input__button"
        disabled={disabled}
        aria-label="Select country"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <FlagImage iso2={country.iso2} size={22} />
        <ChevronDown className="vo-phone-input__chevron" />
      </button>

      <input
        ref={inputRef}
        id={id}
        name={name}
        type="tel"
        className="vo-phone-input__input"
        value={inputValue}
        onChange={handlePhoneValueChange}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={ariaInvalid}
        aria-label={ariaLabel}
      />

      {open ? (
        <CountryDropdown
          countries={countries}
          selectedIso2={country.iso2}
          onSelect={handleSelect}
          onClose={closeAndFocus}
        />
      ) : null}
    </div>
  )
}

function CountryDropdown({
  countries,
  selectedIso2,
  onSelect,
  onClose,
}: {
  countries: typeof defaultCountries
  selectedIso2: CountryIso2
  onSelect: (iso2: CountryIso2) => void
  onClose: () => void
}) {
  const [query, setQuery] = React.useState('')
  const [activeIndex, setActiveIndex] = React.useState(0)
  const searchRef = React.useRef<HTMLInputElement | null>(null)
  const listRef = React.useRef<HTMLUListElement | null>(null)

  React.useEffect(() => {
    searchRef.current?.focus()
  }, [])

  const parsed = React.useMemo<ParsedCountry[]>(
    () => countries.map((c) => parseCountry(c)),
    [countries],
  )

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return parsed
    const digits = q.replace(/\D/g, '')
    return parsed.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (digits.length > 0 && c.dialCode.includes(digits)),
    )
  }, [parsed, query])

  // Keep the active row within bounds as the filtered list changes.
  React.useEffect(() => {
    setActiveIndex(0)
  }, [query])

  // Scroll the active row into view.
  React.useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${activeIndex}"]`,
    )
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  function handleKeyDown(e: React.KeyboardEvent) {
    // Stop bubbling for every key we own | the inline editors treat
    // Enter/Escape on their wrapper as commit/cancel, which would close the
    // editor when the user is only navigating the country list.
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      e.stopPropagation()
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      setActiveIndex((i) => Math.max(i - 1, 0))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      const c = filtered[activeIndex]
      if (c) onSelect(c.iso2)
    }
  }

  return (
    <div className="vo-phone-input__dropdown" onKeyDown={handleKeyDown}>
      <div className="vo-phone-input__search">
        <Search className="vo-phone-input__search-icon" />
        <input
          ref={searchRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search country or code"
          className="vo-phone-input__search-input"
          aria-label="Search country"
        />
      </div>
      <ul ref={listRef} className="vo-phone-input__list" role="listbox">
        {filtered.length === 0 ? (
          <li className="vo-phone-input__empty">No matches</li>
        ) : (
          filtered.map((c, i) => {
            const selected = c.iso2 === selectedIso2
            const active = i === activeIndex
            return (
              <li
                key={c.iso2}
                data-index={i}
                role="option"
                aria-selected={selected}
                className={cn(
                  'vo-phone-input__list-item',
                  active && 'vo-phone-input__list-item--active',
                  selected && 'vo-phone-input__list-item--selected',
                )}
                onMouseEnter={() => setActiveIndex(i)}
                onMouseDown={(e) => {
                  // Prevent the search input from losing focus before click fires.
                  e.preventDefault()
                  onSelect(c.iso2)
                }}
              >
                <FlagImage iso2={c.iso2} size={20} />
                <span className="vo-phone-input__list-name">{c.name}</span>
                <span className="vo-phone-input__list-dial">+{c.dialCode}</span>
              </li>
            )
          })
        )}
      </ul>
    </div>
  )
}
