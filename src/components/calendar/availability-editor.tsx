'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Plus, Trash2, Copy } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { saveAvailability } from '@/app/(dashboard)/calendar/_actions/availability'
import type { AvailabilityRow } from '@/app/(dashboard)/calendar/_actions/availability'

const DAYS = [
  { dow: 0, label: 'Sun' },
  { dow: 1, label: 'Mon' },
  { dow: 2, label: 'Tue' },
  { dow: 3, label: 'Wed' },
  { dow: 4, label: 'Thu' },
  { dow: 5, label: 'Fri' },
  { dow: 6, label: 'Sat' },
]

interface TimeSlot {
  start: string // HH:MM
  end: string   // HH:MM
}

interface DayState {
  enabled: boolean
  slots: TimeSlot[]
}

const DEFAULT_SLOT: TimeSlot = { start: '08:00', end: '17:00' }

function toHHMM(t: string): string {
  return t.slice(0, 5)
}

interface AvailabilityEditorProps {
  initialAvailability: AvailabilityRow[]
}

export function AvailabilityEditor({ initialAvailability }: AvailabilityEditorProps) {
  const [isPending, startTransition] = useTransition()

  const [days, setDays] = useState<Record<number, DayState>>(() => {
    const map: Record<number, DayState> = {}
    for (const d of DAYS) {
      const existing = initialAvailability.filter((a) => a.day_of_week === d.dow)
      if (existing.length > 0) {
        map[d.dow] = {
          enabled: true,
          slots: existing.map((a) => ({
            start: toHHMM(a.start_time),
            end: toHHMM(a.end_time),
          })),
        }
      } else {
        map[d.dow] = { enabled: false, slots: [{ ...DEFAULT_SLOT }] }
      }
    }
    return map
  })

  function setDay(dow: number, patch: Partial<DayState>) {
    setDays((prev) => ({ ...prev, [dow]: { ...prev[dow], ...patch } }))
  }

  function toggleDay(dow: number, enabled: boolean) {
    setDay(dow, {
      enabled,
      slots: enabled && days[dow].slots.length === 0
        ? [{ ...DEFAULT_SLOT }]
        : days[dow].slots,
    })
  }

  function updateSlot(dow: number, idx: number, patch: Partial<TimeSlot>) {
    setDays((prev) => {
      const slots = [...prev[dow].slots]
      slots[idx] = { ...slots[idx], ...patch }
      return { ...prev, [dow]: { ...prev[dow], slots } }
    })
  }

  function addSlot(dow: number) {
    const last = days[dow].slots[days[dow].slots.length - 1]
    // Default new slot to 1h after the last one ends, capped to end-of-day
    const [h, m] = (last?.end ?? '17:00').split(':').map(Number)
    const newStart = `${String(Math.min(h + 1, 22)).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    const newEnd = `${String(Math.min(h + 2, 23)).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    setDays((prev) => ({
      ...prev,
      [dow]: { ...prev[dow], slots: [...prev[dow].slots, { start: newStart, end: newEnd }] },
    }))
  }

  function removeSlot(dow: number, idx: number) {
    setDays((prev) => {
      const slots = prev[dow].slots.filter((_, i) => i !== idx)
      // If all slots removed, disable the day
      if (slots.length === 0) return { ...prev, [dow]: { enabled: false, slots: [{ ...DEFAULT_SLOT }] } }
      return { ...prev, [dow]: { ...prev[dow], slots } }
    })
  }

  function copyToAll(dow: number) {
    const source = days[dow].slots
    setDays((prev) => {
      const next = { ...prev }
      for (const d of DAYS) {
        if (d.dow !== dow && next[d.dow].enabled) {
          next[d.dow] = { ...next[d.dow], slots: source.map((s) => ({ ...s })) }
        }
      }
      return next
    })
    toast.success('Copied to all enabled days')
  }

  function handleSave() {
    // Validate
    for (const d of DAYS) {
      const state = days[d.dow]
      if (!state.enabled) continue
      for (const [i, slot] of state.slots.entries()) {
        if (slot.end <= slot.start) {
          toast.error(`${d.label} slot ${i + 1}: end time must be after start time`)
          return
        }
      }
    }

    startTransition(async () => {
      const items: { day_of_week: number; enabled: boolean; start_time: string; end_time: string }[] = []
      for (const d of DAYS) {
        const state = days[d.dow]
        if (state.enabled) {
          for (const slot of state.slots) {
            items.push({
              day_of_week: d.dow,
              enabled: true,
              start_time: slot.start + ':00',
              end_time: slot.end + ':00',
            })
          }
        }
      }
      const result = await saveAvailability(items)
      if (!result.ok) { toast.error(result.error); return }
      toast.success('Availability saved')
    })
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-[15px] font-semibold text-text-primary">Weekly working hours</h2>
        <p className="mt-1 text-[12.5px] text-text-tertiary">
          Set working days and hours here to determine when availability appears on calendars
        </p>
      </div>

      <div className="rounded-[12px] border border-border divide-y divide-border-subtle overflow-hidden">
        {DAYS.map((d) => {
          const state = days[d.dow]
          return (
            <div key={d.dow} className="px-4 py-3 flex items-start gap-3">
              {/* Checkbox + day label */}
              <div className="flex items-center gap-2.5 w-16 shrink-0 pt-0.5">
                <Checkbox
                  id={`day-${d.dow}`}
                  checked={state.enabled}
                  onCheckedChange={(v) => toggleDay(d.dow, Boolean(v))}
                />
                <label
                  htmlFor={`day-${d.dow}`}
                  className="text-[13px] font-medium text-text-primary cursor-pointer select-none"
                >
                  {d.label}
                </label>
              </div>

              {/* Slots or Unavailable */}
              {state.enabled ? (
                <div className="flex flex-col gap-2.5 flex-1 min-w-0">
                  {state.slots.map((slot, idx) => (
                    <div key={idx} className="flex items-end gap-2 flex-wrap">
                      {/* Start time */}
                      <div className="flex flex-col gap-1 min-w-0">
                        {idx === 0 && (
                          <span className="text-[11px] text-text-tertiary font-medium">Start time</span>
                        )}
                        <div className="relative">
                          <input
                            type="time"
                            value={slot.start}
                            onChange={(e) => updateSlot(d.dow, idx, { start: e.target.value })}
                            className="w-[130px] rounded-[8px] border border-border bg-bg-secondary px-3 py-1.5 text-[13px] text-text-primary tabular-nums focus:outline-none focus:ring-1 focus:ring-accent"
                          />
                        </div>
                      </div>

                      {/* End time */}
                      <div className="flex flex-col gap-1 min-w-0">
                        {idx === 0 && (
                          <span className="text-[11px] text-text-tertiary font-medium">End time</span>
                        )}
                        <div className="relative">
                          <input
                            type="time"
                            value={slot.end}
                            onChange={(e) => updateSlot(d.dow, idx, { end: e.target.value })}
                            className="w-[130px] rounded-[8px] border border-border bg-bg-secondary px-3 py-1.5 text-[13px] text-text-primary tabular-nums focus:outline-none focus:ring-1 focus:ring-accent"
                          />
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-1 pb-0.5">
                        <button
                          type="button"
                          onClick={() => addSlot(d.dow)}
                          className="h-8 w-8 flex items-center justify-center rounded-[6px] text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary transition-colors"
                          aria-label="Add time slot"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeSlot(d.dow, idx)}
                          disabled={state.slots.length === 1}
                          className="h-8 w-8 flex items-center justify-center rounded-[6px] text-text-tertiary hover:bg-bg-tertiary hover:text-destructive transition-colors disabled:opacity-30 disabled:pointer-events-none"
                          aria-label="Remove time slot"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                        {idx === 0 && (
                          <button
                            type="button"
                            onClick={() => copyToAll(d.dow)}
                            className="h-8 w-8 flex items-center justify-center rounded-[6px] text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary transition-colors"
                            aria-label="Copy to all enabled days"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-[13px] text-text-tertiary pt-0.5">Unavailable</span>
              )}
            </div>
          )
        })}
      </div>

      <Button onClick={handleSave} disabled={isPending} size="sm">
        {isPending ? 'Saving…' : 'Save availability'}
      </Button>
    </div>
  )
}
