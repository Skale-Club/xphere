'use client'

import * as React from 'react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  getDefinitions,
  type CustomFieldDefinitionRow,
} from '@/app/(dashboard)/settings/custom-fields/actions'
import type { CustomFieldEntity } from '@/types/database'

interface CustomFieldsFormProps {
  entity: CustomFieldEntity
  value: Record<string, unknown>
  onChange: (v: Record<string, unknown>) => void
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

function getCurrencyCode(def: CustomFieldDefinitionRow): string {
  try {
    const v = def.validation as { currency_code?: string } | null
    return v?.currency_code ?? 'USD'
  } catch {
    return 'USD'
  }
}

function groupDefinitions(defs: CustomFieldDefinitionRow[]): Array<{ group: string | null; items: CustomFieldDefinitionRow[] }> {
  const groups = new Map<string | null, CustomFieldDefinitionRow[]>()
  for (const def of defs) {
    const key = def.group_name ?? null
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(def)
  }
  const named: Array<{ group: string | null; items: CustomFieldDefinitionRow[] }> = []
  const ungrouped: Array<{ group: string | null; items: CustomFieldDefinitionRow[] }> = []
  for (const [group, items] of groups) {
    if (group === null) ungrouped.push({ group, items })
    else named.push({ group, items })
  }
  return [...named, ...ungrouped]
}

export function CustomFieldsForm({ entity, value, onChange }: CustomFieldsFormProps) {
  const [definitions, setDefinitions] = React.useState<CustomFieldDefinitionRow[]>([])

  React.useEffect(() => {
    getDefinitions({ entity, includeArchived: false }).then((res) => {
      if (res.ok) setDefinitions(res.data)
    })
  }, [entity])

  if (definitions.length === 0) return null

  function set(key: string, val: unknown) {
    onChange({ ...value, [key]: val })
  }

  const groups = groupDefinitions(definitions)

  return (
    <div className="space-y-4">
      <div className="text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
        Custom Fields
      </div>

      {groups.map(({ group, items }) => (
        <div key={group ?? '__ungrouped'} className="space-y-3">
          {group && (
            <div className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide border-b border-border-subtle pb-1">
              {group}
            </div>
          )}
          {items.map((def) => (
            <FieldInput
              key={def.id}
              def={def}
              value={value[def.key]}
              onChange={(v) => set(def.key, v)}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

function FieldInput({
  def,
  value,
  onChange,
}: {
  def: CustomFieldDefinitionRow
  value: unknown
  onChange: (v: unknown) => void
}) {
  const labelEl = (
    <Label className="text-[12px] font-medium text-text-secondary">
      {def.label}
      {def.required && <span className="ml-0.5 text-rose-400">*</span>}
    </Label>
  )

  switch (def.type) {
    case 'boolean':
      return (
        <div className="flex items-center gap-2">
          <Checkbox
            id={`cf-${def.key}`}
            checked={Boolean(value)}
            onCheckedChange={(checked) => onChange(Boolean(checked))}
          />
          <Label htmlFor={`cf-${def.key}`} className="text-[12px] font-medium text-text-secondary cursor-pointer">
            {def.label}
            {def.required && <span className="ml-0.5 text-rose-400">*</span>}
          </Label>
          {def.help_text && (
            <span className="text-[11px] text-text-tertiary">{def.help_text}</span>
          )}
        </div>
      )

    case 'long_text':
      return (
        <div className="flex flex-col gap-1.5">
          {labelEl}
          {def.help_text && <p className="text-[11px] text-text-tertiary">{def.help_text}</p>}
          <Textarea
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
            rows={3}
            placeholder={def.label}
          />
        </div>
      )

    case 'select': {
      const opts = getOptions(def)
      return (
        <div className="flex flex-col gap-1.5">
          {labelEl}
          {def.help_text && <p className="text-[11px] text-text-tertiary">{def.help_text}</p>}
          <Select
            value={typeof value === 'string' ? value : ''}
            onValueChange={onChange}
          >
            <SelectTrigger>
              <SelectValue placeholder={`Select ${def.label}`} />
            </SelectTrigger>
            <SelectContent>
              {opts.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )
    }

    case 'multi_select': {
      const opts = getOptions(def)
      const selected = Array.isArray(value) ? (value as string[]) : []
      return (
        <div className="flex flex-col gap-1.5">
          {labelEl}
          {def.help_text && <p className="text-[11px] text-text-tertiary">{def.help_text}</p>}
          <div className="flex flex-wrap gap-2">
            {opts.map((o) => {
              const checked = selected.includes(o.value)
              return (
                <label
                  key={o.value}
                  className="flex items-center gap-1.5 cursor-pointer"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(c) => {
                      if (c) onChange([...selected, o.value])
                      else onChange(selected.filter((v) => v !== o.value))
                    }}
                  />
                  <span className="text-[12.5px] text-text-primary">{o.label}</span>
                </label>
              )
            })}
          </div>
        </div>
      )
    }

    case 'currency': {
      const curr = value as { amount?: number; currency?: string } | undefined
      const defCode = getCurrencyCode(def)
      return (
        <div className="flex flex-col gap-1.5">
          {labelEl}
          {def.help_text && <p className="text-[11px] text-text-tertiary">{def.help_text}</p>}
          <div className="flex gap-2">
            <Input
              type="number"
              step="0.01"
              placeholder="0.00"
              value={curr?.amount ?? ''}
              onChange={(e) =>
                onChange({ currency: curr?.currency ?? defCode, amount: parseFloat(e.target.value) || 0 })
              }
              className="flex-1"
            />
            <Input
              value={curr?.currency ?? defCode}
              onChange={(e) =>
                onChange({ amount: curr?.amount ?? 0, currency: e.target.value.toUpperCase().slice(0, 3) })
              }
              maxLength={3}
              className="w-16 uppercase"
              placeholder="USD"
            />
          </div>
        </div>
      )
    }

    case 'number':
    case 'integer':
      return (
        <div className="flex flex-col gap-1.5">
          {labelEl}
          {def.help_text && <p className="text-[11px] text-text-tertiary">{def.help_text}</p>}
          <Input
            type="number"
            step={def.type === 'integer' ? '1' : 'any'}
            value={typeof value === 'number' ? value : ''}
            onChange={(e) => onChange(def.type === 'integer' ? parseInt(e.target.value, 10) : parseFloat(e.target.value))}
            placeholder={def.label}
          />
        </div>
      )

    case 'date':
      return (
        <div className="flex flex-col gap-1.5">
          {labelEl}
          {def.help_text && <p className="text-[11px] text-text-tertiary">{def.help_text}</p>}
          <Input
            type="date"
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      )

    case 'datetime':
      return (
        <div className="flex flex-col gap-1.5">
          {labelEl}
          {def.help_text && <p className="text-[11px] text-text-tertiary">{def.help_text}</p>}
          <Input
            type="datetime-local"
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      )

    default:
      // text, long_text (handled above), url, email, phone
      return (
        <div className="flex flex-col gap-1.5">
          {labelEl}
          {def.help_text && <p className="text-[11px] text-text-tertiary">{def.help_text}</p>}
          <Input
            type={def.type === 'url' ? 'url' : def.type === 'email' ? 'email' : def.type === 'phone' ? 'tel' : 'text'}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={def.label}
          />
        </div>
      )
  }
}
