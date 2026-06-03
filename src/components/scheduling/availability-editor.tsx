'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { saveAvailability } from '@/app/(dashboard)/scheduling/_actions/availability'
import type { AvailabilityRow } from '@/app/(dashboard)/scheduling/_actions/availability'

const DAYS = [
  { dow: 0, label: 'Sunday' },
  { dow: 1, label: 'Monday' },
  { dow: 2, label: 'Tuesday' },
  { dow: 3, label: 'Wednesday' },
  { dow: 4, label: 'Thursday' },
  { dow: 5, label: 'Friday' },
  { dow: 6, label: 'Saturday' },
]

interface DayState {
  enabled: boolean
  start: string
  end: string
}

function toHHMM(t: string): string {
  return t.slice(0, 5)
}

interface AvailabilityEditorProps {
  initialAvailability: AvailabilityRow[]
}

export function AvailabilityEditor({ initialAvailability }: AvailabilityEditorProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [days, setDays] = useState<Record<number, DayState>>(() => {
    const map: Record<number, DayState> = {}
    for (const d of DAYS) {
      const existing = initialAvailability.find((a) => a.day_of_week === d.dow)
      map[d.dow] = {
        enabled: !!existing,
        start: existing ? toHHMM(existing.start_time) : '09:00',
        end: existing ? toHHMM(existing.end_time) : '17:00',
      }
    }
    return map
  })

  function setDay(dow: number, patch: Partial<DayState>) {
    setDays((prev) => ({ ...prev, [dow]: { ...prev[dow], ...patch } }))
  }

  function handleSave() {
    // Validate enabled days have end > start
    for (const d of DAYS) {
      const state = days[d.dow]
      if (state.enabled && state.end <= state.start) {
        toast.error(`${d.label}: end time must be after start time`)
        return
      }
    }

    startTransition(async () => {
      const items = DAYS.map((d) => ({
        day_of_week: d.dow,
        enabled: days[d.dow].enabled,
        start_time: days[d.dow].start + ':00',
        end_time: days[d.dow].end + ':00',
      }))
      const result = await saveAvailability(items)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success('Availability saved')
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border divide-y divide-border">
        {DAYS.map((d) => {
          const state = days[d.dow]
          return (
            <div key={d.dow} className="flex items-center gap-4 px-4 py-3">
              <Switch
                checked={state.enabled}
                onCheckedChange={(v) => setDay(d.dow, { enabled: v })}
                className="data-[state=checked]:bg-indigo-600"
              />
              <span className="w-24 text-sm font-medium">{d.label}</span>
              {state.enabled ? (
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={state.start}
                    onChange={(e) => setDay(d.dow, { start: e.target.value })}
                    className="rounded border border-border bg-background px-2 py-1 text-sm tabular-nums"
                  />
                  <span className="text-muted-foreground text-xs">to</span>
                  <input
                    type="time"
                    value={state.end}
                    onChange={(e) => setDay(d.dow, { end: e.target.value })}
                    className="rounded border border-border bg-background px-2 py-1 text-sm tabular-nums"
                  />
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">Unavailable</span>
              )}
            </div>
          )
        })}
      </div>
      <Button onClick={handleSave} disabled={isPending}>
        {isPending ? 'Saving…' : 'Save availability'}
      </Button>
    </div>
  )
}
