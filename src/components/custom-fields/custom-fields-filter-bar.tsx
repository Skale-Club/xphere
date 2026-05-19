'use client'

import * as React from 'react'
import { X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { CustomFieldDefinitionRow } from '@/app/(dashboard)/settings/custom-fields/actions'

interface CustomFieldsFilterBarProps {
  filterableDefs: CustomFieldDefinitionRow[]
  activeFilters: Record<string, string>
  onChange: (key: string, value: string | null) => void
}

interface SelectOption {
  value: string
  label: string
}

function getOptions(def: CustomFieldDefinitionRow): SelectOption[] {
  if (!def.options) return []
  try {
    const opts = def.options as SelectOption[]
    return Array.isArray(opts) ? opts : []
  } catch {
    return []
  }
}

export function CustomFieldsFilterBar({
  filterableDefs,
  activeFilters,
  onChange,
}: CustomFieldsFilterBarProps) {
  if (filterableDefs.length === 0) return null

  const hasActive = Object.keys(activeFilters).some((k) => filterableDefs.some((d) => d.key === k))

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-wide text-text-tertiary">Custom filters</span>
        {hasActive && (
          <button
            type="button"
            onClick={() => filterableDefs.forEach((d) => onChange(d.key, null))}
            className="text-[10.5px] text-text-tertiary hover:text-text-primary flex items-center gap-1"
          >
            <X className="h-3 w-3" /> Clear all
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {filterableDefs.map((def) => (
          <FilterControl
            key={def.id}
            def={def}
            value={activeFilters[def.key] ?? ''}
            onChange={(v) => onChange(def.key, v || null)}
          />
        ))}
      </div>
    </div>
  )
}

function FilterControl({
  def,
  value,
  onChange,
}: {
  def: CustomFieldDefinitionRow
  value: string
  onChange: (v: string) => void
}) {
  const label = def.label

  switch (def.type) {
    case 'boolean':
      return (
        <Select value={value || 'all'} onValueChange={(v) => onChange(v === 'all' ? '' : v)}>
          <SelectTrigger className="h-8 w-[140px] text-[12px]">
            <SelectValue placeholder={label} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{label}: All</SelectItem>
            <SelectItem value="true">Yes</SelectItem>
            <SelectItem value="false">No</SelectItem>
          </SelectContent>
        </Select>
      )

    case 'select': {
      const opts = getOptions(def)
      return (
        <Select value={value || 'all'} onValueChange={(v) => onChange(v === 'all' ? '' : v)}>
          <SelectTrigger className="h-8 w-[160px] text-[12px]">
            <SelectValue placeholder={label} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{label}: All</SelectItem>
            {opts.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    }

    case 'date':
    case 'datetime':
      return (
        <Input
          type={def.type === 'date' ? 'date' : 'datetime-local'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-[160px] text-[12px]"
          placeholder={label}
          title={label}
        />
      )

    case 'number':
    case 'integer':
      return (
        <Input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-[120px] text-[12px]"
          placeholder={label}
          title={label}
        />
      )

    default:
      // text, long_text, url, email, phone
      return (
        <Input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-[160px] text-[12px]"
          placeholder={label}
          title={label}
        />
      )
  }
}
