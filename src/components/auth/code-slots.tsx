'use client'

import * as React from 'react'
import { useState } from 'react'

import { cn } from '@/lib/utils'

const LENGTH = 6

interface CodeSlotsProps extends Omit<React.ComponentProps<'input'>, 'value' | 'onChange' | 'type'> {
  value: string
  onChange: (value: string) => void
  invalid?: boolean
}

/**
 * Six separate boxes over one real input, not six inputs: the phone's SMS autofill and a
 * pasted "123 456" arrive as a single value, and Backspace needs no focus juggling.
 * The input is invisible and covers the boxes, so a tap anywhere opens the keyboard.
 */
export function CodeSlots({ value, onChange, invalid, readOnly, className, ...inputProps }: CodeSlotsProps) {
  const [focused, setFocused] = useState(false)
  const activeIndex = Math.min(value.length, LENGTH - 1)

  // Digits are only ever added or removed at the end, so the cursor must stay there.
  const keepCursorAtEnd = (input: HTMLInputElement) => {
    const end = input.value.length
    input.setSelectionRange(end, end)
  }

  return (
    <div className={cn('relative', className)}>
      <div className="grid grid-cols-6 gap-2" aria-hidden="true">
        {Array.from({ length: LENGTH }, (_, index) => {
          const digit = value[index]
          const active = focused && !readOnly && index === activeIndex
          return (
            <div
              key={index}
              data-slot="code-box"
              className={cn(
                'flex h-14 items-center justify-center rounded-lg border bg-white/[0.04] text-2xl font-medium text-[#FAFAFA] transition-colors',
                invalid ? 'border-red-500/50' : 'border-white/10',
                active && !invalid && 'border-indigo-500/70 ring-2 ring-indigo-500/40',
                readOnly && 'opacity-60',
              )}
            >
              {digit ?? (active ? <span className="h-6 w-px animate-pulse bg-[#A1A1AA]" /> : null)}
            </div>
          )
        })}
      </div>
      <input
        {...inputProps}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        readOnly={readOnly}
        inputMode="numeric"
        autoComplete="one-time-code"
        onFocus={(event) => {
          setFocused(true)
          keepCursorAtEnd(event.currentTarget)
        }}
        onBlur={() => setFocused(false)}
        onSelect={(event) => keepCursorAtEnd(event.currentTarget)}
        // 16px keeps iOS from zooming the page when the field takes focus.
        className="absolute inset-0 h-full w-full cursor-text bg-transparent text-base text-transparent caret-transparent outline-none selection:bg-transparent"
      />
    </div>
  )
}
