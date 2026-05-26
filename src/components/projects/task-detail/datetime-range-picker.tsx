'use client'

// DateTimeRangePicker | renders Start–End as a single popover-driven control.
//
// Replaces the 4 separate <Input type="date"> + <Select time> blocks of the
// old sidebar. The trigger is a pill that summarizes the current range
// ("May 8 09:00 → May 29 17:00" or "Add dates"). Inside the popover the
// user gets two compact rows (Start / End) with native date input + a 30-min
// time picker.

import * as React from 'react'
import { Calendar } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'

const DEFAULT_START_TIME = '09:00'
const DEFAULT_END_TIME = '17:00'

const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const hours = Math.floor(i / 2)
  const minutes = i % 2 === 0 ? '00' : '30'
  return `${String(hours).padStart(2, '0')}:${minutes}`
})

function toHHMM(time: string | null | undefined) {
  return time?.slice(0, 5) ?? ''
}

function formatSummary(
  startDate: string | null,
  startTime: string | null,
  endDate: string | null,
  endTime: string | null,
): string {
  if (!startDate && !endDate) return 'Add dates'
  const fmt = (d: string | null, t: string | null) => {
    if (!d) return '—'
    const date = new Date(`${d}T${toHHMM(t) || '00:00'}:00`)
    const day = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    return t ? `${day} ${toHHMM(t)}` : day
  }
  return `${fmt(startDate, startTime)} → ${fmt(endDate, endTime)}`
}

export interface DateRangePatch {
  start_date?: string | null
  start_time?: string | null
  end_date?: string | null
  end_time?: string | null
}

interface Props {
  startDate: string | null
  startTime: string | null
  endDate: string | null
  endTime: string | null
  onChange: (patch: DateRangePatch) => void
}

export function DateTimeRangePicker({
  startDate,
  startTime,
  endDate,
  endTime,
  onChange,
}: Props) {
  const [open, setOpen] = React.useState(false)
  const summary = formatSummary(startDate, startTime, endDate, endTime)
  const hasAny = !!(startDate || endDate)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg-primary',
            hasAny
              ? 'bg-bg-tertiary/50 hover:bg-bg-tertiary text-text-primary'
              : 'hover:bg-bg-tertiary/40 text-text-tertiary',
          )}
        >
          <Calendar className="h-3.5 w-3.5 text-text-tertiary shrink-0" />
          <span className={hasAny ? 'font-medium' : ''}>{summary}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-3 space-y-3" align="start">
        <DateRow
          label="Start"
          date={startDate}
          time={startTime}
          onDateChange={(d) =>
            onChange({
              start_date: d || null,
              start_time: d ? (startTime ?? DEFAULT_START_TIME) : null,
            })
          }
          onTimeChange={(t) => onChange({ start_time: t })}
          defaultTime={DEFAULT_START_TIME}
        />
        <DateRow
          label="End"
          date={endDate}
          time={endTime}
          onDateChange={(d) =>
            onChange({
              end_date: d || null,
              end_time: d ? (endTime ?? DEFAULT_END_TIME) : null,
            })
          }
          onTimeChange={(t) => onChange({ end_time: t })}
          defaultTime={DEFAULT_END_TIME}
        />
        {hasAny && (
          <div className="pt-1 flex justify-end">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[11px] text-text-tertiary hover:text-destructive"
              onClick={() =>
                onChange({
                  start_date: null,
                  start_time: null,
                  end_date: null,
                  end_time: null,
                })
              }
            >
              Clear dates
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

interface RowProps {
  label: string
  date: string | null
  time: string | null
  onDateChange: (d: string) => void
  onTimeChange: (t: string) => void
  defaultTime: string
}

function DateRow({ label, date, time, onDateChange, onTimeChange, defaultTime }: RowProps) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">
        {label}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-2">
        <Input
          type="date"
          className="h-8 text-xs"
          value={date ?? ''}
          onChange={(e) => onDateChange(e.target.value)}
        />
        <Select
          value={toHHMM(time) || defaultTime}
          onValueChange={onTimeChange}
          disabled={!date}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIME_OPTIONS.map((t) => (
              <SelectItem key={t} value={t} className="text-xs">
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
