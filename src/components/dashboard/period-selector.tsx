'use client'

/**
 * PeriodSelector — small Select chip in the dashboard hero (bottom-right)
 * that drives the date range every period-aware widget on /dashboard reads
 * from.
 *
 * Source of truth is the URL: `?range=<period>`. Picking an option calls
 * router.replace so the server re-renders the page with the new
 * searchParam, and each Server Component widget reads the same value via
 * its props (no client-side state, no refetch hooks).
 *
 * The Select primitive matches the style used by the existing analytics
 * dashboard selector so the two don't look like they came from different
 * apps.
 */

import * as React from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { CalendarRange } from 'lucide-react'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PERIODS, type Period, parsePeriod } from '@/lib/dashboard/period'

export function PeriodSelector() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const current = parsePeriod(searchParams.get('range'))

  const handleChange = (next: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (next === '7d') {
      // '7d' is the default — drop the param so the URL stays clean.
      params.delete('range')
    } else {
      params.set('range', next as Period)
    }
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  return (
    <div className="flex items-center gap-2">
      <CalendarRange className="h-3.5 w-3.5 text-text-tertiary" aria-hidden />
      <Select value={current} onValueChange={handleChange}>
        <SelectTrigger className="h-8 w-[150px] text-[12px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          {PERIODS.map((p) => (
            <SelectItem key={p.value} value={p.value} className="text-[12.5px]">
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
