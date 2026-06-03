'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  CalendarCheck2,
  CalendarX2,
  Check,
  Plus,
  Settings2,
  Trash2,
} from 'lucide-react'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { deleteIntegration } from '@/app/(dashboard)/integrations/actions'
import { updateSchedulingPreferences } from '@/app/(dashboard)/scheduling/_actions/scheduling-profile'
import { cn } from '@/lib/utils'

type SyncMode = 'one_way' | 'two_way'

interface Integration {
  id: string
  key_hint: string | null
  config: { google_email?: string } | null
  is_active: boolean
  health_status: string | null
}

interface Props {
  integration: Integration | null
  syncMode: SyncMode
}

function GoogleCalendarLogo() {
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] overflow-hidden border border-border-subtle bg-bg-secondary">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="https://www.gstatic.com/images/branding/productlogos/calendar_2026_03/v2/png/calendar_2026_03_96dp.png"
        alt="Google Calendar"
        width={28}
        height={28}
        className="object-contain"
      />
    </div>
  )
}

export function CalendarConnections({ integration, syncMode: initialSyncMode }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [syncOpen, setSyncOpen] = useState(false)
  const [syncMode, setSyncMode] = useState<SyncMode>(initialSyncMode)
  const [draftSyncMode, setDraftSyncMode] = useState<SyncMode>(initialSyncMode)

  const email =
    (integration?.config as { google_email?: string } | null)?.google_email ??
    integration?.key_hint ??
    null

  function handleDisconnect() {
    if (!integration) return
    startTransition(async () => {
      const result = await deleteIntegration(integration.id)
      if (result && 'error' in result && result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Google Calendar disconnected')
      router.refresh()
    })
  }

  function handleSyncSave() {
    startTransition(async () => {
      const result = await updateSchedulingPreferences({ sync_mode: draftSyncMode })
      if (!result.ok) { toast.error(result.error); return }
      setSyncMode(draftSyncMode)
      setSyncOpen(false)
      toast.success('Sync preferences saved')
    })
  }

  return (
    <div className="space-y-6">
      {/* ── Connected calendars ───────────────────────────────────── */}
      <section className="rounded-[14px] border border-border bg-bg-secondary overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
          <h2 className="text-[14px] font-semibold text-text-primary">Connected calendars</h2>
          <Button
            asChild
            size="sm"
            variant="default"
            className="gap-1.5"
          >
            <a href="/api/google/calendar-oauth">
              <Plus className="h-3.5 w-3.5" />
              Add new
            </a>
          </Button>
        </div>

        {integration ? (
          <div className="flex items-center gap-3 px-5 py-4">
            <GoogleCalendarLogo />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-[13.5px] font-medium text-text-primary">Google calendar</p>
                <Check className="h-3.5 w-3.5 text-emerald-500" />
              </div>
              {email && (
                <p className="text-[12px] text-text-tertiary">{email}</p>
              )}
            </div>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={isPending}
              className="h-8 w-8 flex items-center justify-center rounded-[8px] text-text-tertiary hover:bg-bg-tertiary hover:text-destructive transition-colors"
              aria-label="Disconnect Google Calendar"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-10 px-5 text-center">
            <CalendarX2 className="h-8 w-8 text-text-tertiary" />
            <div>
              <p className="text-[13px] font-medium text-text-primary">No calendar connected</p>
              <p className="text-[12px] text-text-tertiary mt-0.5">
                Connect Google Calendar to sync bookings and check availability.
              </p>
            </div>
            <Button asChild size="sm" variant="outline">
              <a href="/api/google/calendar-oauth">Connect Google Calendar</a>
            </Button>
          </div>
        )}
      </section>

      {/* ── Calendar configuration ───────────────────────────────── */}
      {integration && (
        <section className="rounded-[14px] border border-border bg-bg-secondary overflow-hidden">
          <div className="px-5 py-4 border-b border-border-subtle">
            <h2 className="text-[14px] font-semibold text-text-primary">Calendar configuration</h2>
          </div>

          {/* Linked calendar */}
          <div className="px-5 py-4 border-b border-border-subtle">
            <div className="flex items-start gap-4">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-indigo-500/10">
                <CalendarCheck2 className="h-5 w-5 text-indigo-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13.5px] font-semibold text-text-primary">Linked calendar</p>
                <p className="text-[12px] text-text-tertiary mt-0.5">
                  Sync bookings with your linked calendar
                </p>
              </div>
              {email && (
                <div className="flex items-center gap-3 min-w-0">
                  <div className="rounded-[10px] border border-border-subtle bg-bg-primary px-3 py-2 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <GoogleCalendarLogo />
                      <span className="text-[12.5px] font-medium text-text-primary truncate">{email}</span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <CalendarCheck2 className="h-3.5 w-3.5 text-text-tertiary shrink-0" />
                      <span className="text-[11.5px] text-text-tertiary truncate">{email}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setDraftSyncMode(syncMode)
                      setSyncOpen(true)
                    }}
                    className="text-[12.5px] font-medium text-accent hover:underline shrink-0"
                  >
                    Edit
                  </button>
                </div>
              )}
            </div>
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setDraftSyncMode(syncMode)
                  setSyncOpen(true)
                }}
                className="flex items-center gap-1.5 text-[12px] text-accent hover:underline"
              >
                <Settings2 className="h-3.5 w-3.5" />
                Advanced settings
              </button>
            </div>
          </div>

          {/* Conflict calendars */}
          <div className="px-5 py-4">
            <div className="flex items-start gap-4">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-orange-500/10">
                <CalendarX2 className="h-5 w-5 text-orange-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13.5px] font-semibold text-text-primary">Conflict calendars</p>
                <p className="text-[12px] text-text-tertiary mt-0.5">
                  Add additional calendars to be checked to prevent double bookings
                </p>
              </div>
              {email && (
                <div className="rounded-[10px] border border-border-subtle bg-bg-primary px-3 py-2 min-w-[200px]">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <GoogleCalendarLogo />
                      <span className="text-[12.5px] font-medium text-text-primary truncate">{email}</span>
                    </div>
                  </div>
                  <p className="text-[11.5px] text-text-tertiary mt-1">
                    All events in this calendar are checked for conflicts.
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── Sync preferences dialog ──────────────────────────────── */}
      <Dialog open={syncOpen} onOpenChange={setSyncOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Sync preferences</DialogTitle>
            <p className="text-[13px] text-text-tertiary mt-1">
              How would you like to sync your linked calendar events?
            </p>
          </DialogHeader>

          {/* Visual diagram */}
          <div className="flex items-center justify-center gap-6 rounded-[12px] border border-border bg-bg-secondary px-6 py-5">
            <div className="flex flex-col items-center gap-2">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-500/10">
                <CalendarCheck2 className="h-6 w-6 text-indigo-400" />
              </div>
              <p className="text-[11px] text-text-secondary text-center leading-tight">
                Linked Calendar<br />Events
              </p>
            </div>
            <div className="flex items-center gap-1">
              <div className="h-0.5 w-10 bg-indigo-400" />
              <div className="h-0 w-0 border-y-4 border-l-8 border-y-transparent border-l-indigo-400" />
            </div>
            <div className="flex flex-col items-center gap-2">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-orange-500/10">
                <CalendarX2 className="h-6 w-6 text-orange-400" />
              </div>
              <p className="text-[11px] text-text-secondary text-center leading-tight">
                Treated as<br />Blocked Slots
              </p>
            </div>
          </div>

          {/* Options */}
          <div className="space-y-3">
            {[
              {
                value: 'one_way' as SyncMode,
                label: 'Default sync (one-way sync)',
                badge: 'Recommended',
                description:
                  'Events from the linked calendar are synced as blocked slots, and no Contacts are created for the guests.',
              },
              {
                value: 'two_way' as SyncMode,
                label: 'Two-way sync',
                badge: null,
                description:
                  'Contacts are created for guests found in linked calendar events, and these events are turned into system appointments.',
              },
            ].map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setDraftSyncMode(opt.value)}
                className={cn(
                  'w-full text-left rounded-[10px] border p-4 transition-colors',
                  draftSyncMode === opt.value
                    ? 'border-accent bg-accent/5'
                    : 'border-border bg-bg-secondary hover:border-border-subtle',
                )}
              >
                <div className="flex items-center justify-between gap-3 mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-text-primary">{opt.label}</span>
                    {opt.badge && (
                      <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-[10.5px] font-medium text-indigo-400">
                        {opt.badge}
                      </span>
                    )}
                  </div>
                  <div
                    className={cn(
                      'h-4 w-4 rounded-full border-2 shrink-0',
                      draftSyncMode === opt.value
                        ? 'border-accent bg-accent'
                        : 'border-border',
                    )}
                  >
                    {draftSyncMode === opt.value && (
                      <div className="h-full w-full flex items-center justify-center">
                        <div className="h-1.5 w-1.5 rounded-full bg-white" />
                      </div>
                    )}
                  </div>
                </div>
                <p className="text-[12px] text-text-tertiary leading-relaxed">{opt.description}</p>
              </button>
            ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSyncOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button onClick={handleSyncSave} disabled={isPending}>
              {isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
