'use client'

import * as React from 'react'
import {
  PhoneInput as BasePhoneInput,
  defaultCountries,
  parseCountry,
  type CountryIso2,
} from 'react-international-phone'
import 'react-international-phone/style.css'

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
}

/**
 * International phone input with flag dropdown + per-country mask.
 *
 * Default country is US (`us`). Phone values are stored in E.164 format
 * (e.g. `+14155551234`). Use this everywhere a user enters a phone number
 * | never a plain text input.
 *
 * Styling is fully Tailwind-driven via design tokens; the underlying lib
 * (react-international-phone) is wrapped to match `<Input>` height and
 * focus ring exactly.
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
  // Restrict the country list if `preferredCountries` is passed | otherwise
  // show all 250+ countries (default).
  const countries = React.useMemo(() => {
    if (!preferredCountries?.length) return defaultCountries
    const set = new Set(preferredCountries)
    // Move preferred to the top, keep the rest below for completeness
    const preferred = defaultCountries.filter((c) => set.has(parseCountry(c).iso2))
    const rest = defaultCountries.filter((c) => !set.has(parseCountry(c).iso2))
    return [...preferred, ...rest]
  }, [preferredCountries])

  return (
    <BasePhoneInput
      defaultCountry={defaultCountry}
      value={value}
      onChange={onChange}
      countries={countries}
      placeholder={placeholder}
      disabled={disabled}
      name={name}
      inputProps={{ id, 'aria-invalid': rest['aria-invalid'] }}
      className={cn('vo-phone-input', className)}
      // Always render the flag selector
      countrySelectorStyleProps={{
        buttonClassName:
          'vo-phone-input__button',
        dropdownStyleProps: {
          className: 'vo-phone-input__dropdown',
          listItemClassName: 'vo-phone-input__list-item',
        },
      }}
      inputClassName="vo-phone-input__input"
    />
  )
}
