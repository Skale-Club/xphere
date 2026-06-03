'use client'

import { useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  getGoogleCalendarList,
  updateSchedulingPreferences,
} from '@/app/(dashboard)/scheduling/_actions/scheduling-profile'
import type { GoogleCalendarEntry } from '@/lib/scheduling/google-calendar'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** ID of the linked (primary) calendar — always checked, not toggleable. */
  linkedCalendarId: string
  /** Email shown as the account header. */
  accountEmail: string
  /** Currently saved conflict calendar IDs. */
  initialSelected: string[]
  onSaved: (ids: string[]) => void
}

export function ConflictCalendarsDialog({
  open,
  onOpenChange,
  linkedCalendarId,
  accountEmail,
  initialSelected,
  onSaved,
}: Props) {
  const [isPending, startTransition] = useTransition()
  const [loading, setLoading] = useState(false)
  const [calendars, setCalendars] = useState<GoogleCalendarEntry[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelected))

  // Fetch calendar list when the dialog opens.
  useEffect(() => {
    if (!open) return
    setSelected(new Set(initialSelected))
    setLoading(true)
    getGoogleCalendarList()
      .then((res) => {
        if (res.ok) setCalendars(res.data)
        else toast.error('Could not load calendars: ' + res.error)
      })
      .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function toggleCalendar(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleSave() {
    startTransition(async () => {
      const ids = Array.from(selected)
      const result = await updateSchedulingPreferences({ conflict_calendar_ids: ids })
      if (!result.ok) { toast.error(result.error); return }
      toast.success('Conflict calendars saved')
      onSaved(ids)
      onOpenChange(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Conflict calendars</DialogTitle>
          <p className="text-[13px] text-text-tertiary mt-1">
            Add additional calendars to be checked to prevent double bookings
          </p>
        </DialogHeader>

        {/* Account header */}
        <div className="flex items-center gap-2.5 rounded-[10px] border border-border bg-bg-secondary px-3 py-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://www.gstatic.com/images/branding/productlogos/calendar_2026_03/v2/png/calendar_2026_03_96dp.png"
            alt="Google Calendar"
            width={24}
            height={24}
            className="object-contain shrink-0"
          />
          <span className="text-[13px] font-medium text-text-primary">{accountEmail}</span>
        </div>

        {/* Calendar list */}
        <div>
          <p className="text-[12px] font-semibold text-text-secondary mb-2">
            Check these calendars for conflicts
          </p>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" />
            </div>
          ) : calendars.length === 0 ? (
            <p className="text-[12.5px] text-text-tertiary py-4 text-center">
              No calendars found
            </p>
          ) : (
            <div className="max-h-64 overflow-y-auto -mx-1 px-1 space-y-0.5">
              {calendars.map((cal) => {
                const isLinked = cal.id === linkedCalendarId || cal.primary
                const isChecked = isLinked || selected.has(cal.id)

                return (
                  <label
                    key={cal.id}
                    className="flex items-start gap-3 rounded-[8px] px-2 py-2 hover:bg-bg-tertiary/60 transition-colors cursor-pointer"
                  >
                    <Checkbox
                      id={`cal-${cal.id}`}
                      checked={isChecked}
                      disabled={isLinked}
                      onCheckedChange={() => !isLinked && toggleCalendar(cal.id)}
                      className="mt-0.5 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <span
                        className={
                          isLinked
                            ? 'text-[13px] text-text-tertiary'
                            : 'text-[13px] text-text-primary'
                        }
                      >
                        {cal.summary}
                      </span>
                      {isLinked && (
                        <p className="text-[11.5px] text-text-tertiary mt-0.5">
                          Linked calendar is checked for conflict by default
                        </p>
                      )}
                    </div>
                    {cal.backgroundColor && !isLinked && (
                      <span
                        className="mt-1 h-3 w-3 rounded-full shrink-0"
                        style={{ backgroundColor: cal.backgroundColor }}
                      />
                    )}
                  </label>
                )
              })}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isPending || loading}>
            {isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
