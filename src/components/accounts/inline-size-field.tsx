'use client'

/**
 * Inline company-size selector for the company modal. A compact ghost-styled
 * Select over the fixed ACCOUNT_SIZES buckets that commits the moment a value
 * is picked (optimistic, with rollback on failure). Includes a "Clear" option
 * to null the field.
 */

import * as React from 'react'
import { toast } from 'sonner'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ACCOUNT_SIZES } from '@/lib/accounts'

const CLEAR = '__clear__'

interface InlineSizeFieldProps {
  value: string | null
  /** Resolves to ok or rejects → component rolls back. */
  onSave: (next: string) => Promise<void>
  ariaLabel?: string
}

export function InlineSizeField({ value, onSave, ariaLabel }: InlineSizeFieldProps) {
  const [displayed, setDisplayed] = React.useState<string | null>(value)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    setDisplayed(value)
  }, [value])

  async function handleChange(next: string) {
    const resolved = next === CLEAR ? '' : next
    const previous = displayed
    setDisplayed(resolved || null)
    setSaving(true)
    try {
      await onSave(resolved)
      toast.success('Saved')
    } catch (e) {
      setDisplayed(previous)
      toast.error(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Select value={displayed ?? undefined} onValueChange={handleChange} disabled={saving}>
      <SelectTrigger
        aria-label={ariaLabel}
        className="h-7 w-full border-transparent bg-transparent px-1.5 text-[12.5px] hover:bg-bg-tertiary focus:ring-1 focus:ring-accent/40 data-[placeholder]:text-text-tertiary data-[placeholder]:italic"
      >
        <SelectValue placeholder="Select company size" />
      </SelectTrigger>
      <SelectContent>
        {ACCOUNT_SIZES.map((s) => (
          <SelectItem key={s} value={s}>
            {s}
          </SelectItem>
        ))}
        {displayed && (
          <>
            <SelectSeparator />
            <SelectItem value={CLEAR} className="text-text-tertiary">
              Clear
            </SelectItem>
          </>
        )}
      </SelectContent>
    </Select>
  )
}
