'use client'

import * as React from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { cn } from '@/lib/utils'

type Option = { id: string; name: string }

/**
 * Searchable ad-account picker. Replaces the native <select> — there can be
 * many accounts with near-identical names, so search (by name or id) matters.
 */
export function AccountSelector({
  value,
  options,
  onSelect,
}: {
  value: string
  options: Option[]
  onSelect: (id: string) => void
}) {
  const [open, setOpen] = React.useState(false)
  const current = options.find((o) => o.id === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className="flex items-center gap-2 rounded-lg border border-border-subtle bg-bg-secondary px-3 py-1.5 text-[12.5px] font-medium text-text-primary transition-colors hover:bg-bg-tertiary focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <span className="max-w-[200px] truncate">{current?.name ?? 'Select account'}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search accounts..." />
          <CommandList>
            <CommandEmpty>No accounts found</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.id}
                  // Include the id so accounts with duplicate names stay searchable/distinct.
                  value={`${o.name} ${o.id}`}
                  onSelect={() => {
                    onSelect(o.id)
                    setOpen(false)
                  }}
                >
                  <Check
                    className={cn('mr-2 h-3.5 w-3.5 shrink-0', o.id === value ? 'opacity-100' : 'opacity-0')}
                  />
                  <span className="truncate">{o.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
