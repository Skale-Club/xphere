'use client'

import * as React from 'react'
import { Check, ChevronsUpDown, Globe } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

// IANA timezone list from the runtime when available; small fallback otherwise.
const TIMEZONES: string[] = (() => {
  const intl = Intl as { supportedValuesOf?: (k: string) => string[] }
  if (typeof intl.supportedValuesOf === 'function') {
    try {
      return intl.supportedValuesOf('timeZone')
    } catch {
      /* fall through */
    }
  }
  return ['UTC', 'America/Sao_Paulo', 'America/New_York', 'Europe/London', 'Europe/Lisbon']
})()

/** "America/Sao_Paulo" → "America / Sao Paulo" — swaps separators for display. */
function prettyTz(tz: string): string {
  return tz.replace(/_/g, ' ').replace(/\//g, ' / ')
}

interface TimezoneSelectProps {
  value: string
  onChange: (tz: string) => void
  id?: string
  className?: string
}

export function TimezoneSelect({ value, onChange, id, className }: TimezoneSelectProps) {
  const [open, setOpen] = React.useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            'h-9 w-full justify-between bg-bg-secondary px-2.5 text-[13.5px] font-normal',
            !value && 'text-text-tertiary',
            className,
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <Globe className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
            <span className="truncate">{value ? prettyTz(value) : 'Select timezone…'}</span>
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
      >
        <Command>
          <CommandInput placeholder="Search timezone…" />
          <CommandList>
            <CommandEmpty>No timezone found.</CommandEmpty>
            <CommandGroup>
              {TIMEZONES.map((tz) => (
                <CommandItem
                  key={tz}
                  value={tz}
                  onSelect={() => {
                    onChange(tz)
                    setOpen(false)
                  }}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4 shrink-0',
                      value === tz ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <span className="truncate">{prettyTz(tz)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
