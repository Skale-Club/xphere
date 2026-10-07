'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, CalendarClock, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import {
  createAlertRule,
  createSchedule,
  deleteAlertRule,
  deleteSchedule,
  setScheduleActive,
} from '@/app/(dashboard)/seo/local/actions'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

export type ScheduleItem = {
  id: string
  frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly'
  weekday: number
  dayOfMonth: number
  hourUtc: number
  keywordCount: number
  nextRunAt: string
  lastRunAt: string | null
  lastError: string | null
  isActive: boolean
}

export type AlertRuleItem = {
  id: string
  metric: 'solv' | 'arp' | 'atrp' | 'found_pct'
  direction: 'worse' | 'better' | 'any'
  threshold: number
  allLocations: boolean
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const METRIC_LABEL = { solv: 'SoLV', arp: 'Average rank', atrp: 'ATRP', found_pct: 'Found %' } as const
const DIRECTION_LABEL = { worse: 'gets worse', better: 'improves', any: 'changes' } as const

function describeSchedule(s: ScheduleItem): string {
  const time = `${String(s.hourUtc).padStart(2, '0')}:00 UTC`
  if (s.frequency === 'daily') return `Every day at ${time}`
  if (s.frequency === 'weekly') return `Every ${WEEKDAYS[s.weekday]} at ${time}`
  if (s.frequency === 'biweekly') return `Every other ${WEEKDAYS[s.weekday]} at ${time}`
  return `Monthly on day ${s.dayOfMonth} at ${time}`
}

export function TrackingSettings({
  locationId,
  schedules,
  rules,
  pointsPerRun,
  canManage,
}: {
  locationId: string
  schedules: ScheduleItem[]
  rules: AlertRuleItem[]
  /** Points one run of a schedule spends (grid points x keywords), for the hint. */
  pointsPerRun: number
  canManage: boolean
}) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [frequency, setFrequency] = useState<ScheduleItem['frequency']>('weekly')
  const [weekday, setWeekday] = useState(1)
  const [dayOfMonth, setDayOfMonth] = useState(1)
  const [hourUtc, setHourUtc] = useState(9)
  const [metric, setMetric] = useState<AlertRuleItem['metric']>('solv')
  const [direction, setDirection] = useState<AlertRuleItem['direction']>('worse')
  const [threshold, setThreshold] = useState(10)

  const runsPerMonth = { daily: 30, weekly: 4.3, biweekly: 2.15, monthly: 1 }[frequency]

  function act(fn: () => Promise<{ error: string } | object>, ok?: string) {
    start(async () => {
      const res = await fn()
      if ('error' in res) toast.error((res as { error: string }).error)
      else {
        if (ok) toast.success(ok)
        router.refresh()
      }
    })
  }

  return (
    <div className="grid max-w-5xl gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarClock className="h-4 w-4" /> Scheduled scans
          </CardTitle>
          <CardDescription>Scan every keyword of this location on a fixed rhythm to build trends.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {schedules.length === 0 && <p className="text-sm text-text-secondary">No schedule yet.</p>}
          {schedules.map((s) => (
            <div key={s.id} className="flex items-start justify-between gap-3 rounded-lg border border-border-subtle p-3">
              <div className="min-w-0 text-[13px]">
                <div className="font-medium text-text-primary">{describeSchedule(s)}</div>
                <div className="text-text-tertiary">
                  {s.keywordCount ? `${s.keywordCount} keywords` : 'All keywords'} · next{' '}
                  {new Date(s.nextRunAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                </div>
                {s.lastError && <div className="mt-1 text-danger">Last run: {s.lastError}</div>}
              </div>
              {canManage && (
                <div className="flex shrink-0 items-center gap-2">
                  <Switch checked={s.isActive} disabled={busy} onCheckedChange={(v) => act(() => setScheduleActive(s.id, locationId, v))} />
                  <button
                    type="button"
                    onClick={() => act(() => deleteSchedule(s.id, locationId))}
                    className="rounded p-1 text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary"
                    aria-label="Delete schedule"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          ))}
          {canManage && (
            <div className="space-y-3 border-t border-border-subtle pt-4">
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1.5">
                  <Label>Frequency</Label>
                  <Select value={frequency} onValueChange={(v) => setFrequency(v as ScheduleItem['frequency'])}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="biweekly">Every 2 weeks</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>{frequency === 'monthly' ? 'Day' : 'Weekday'}</Label>
                  {frequency === 'monthly' ? (
                    <Input type="number" min={1} max={28} value={dayOfMonth} onChange={(e) => setDayOfMonth(Number(e.target.value))} />
                  ) : (
                    <Select value={String(weekday)} disabled={frequency === 'daily'} onValueChange={(v) => setWeekday(Number(v))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {WEEKDAYS.map((d, i) => (
                          <SelectItem key={d} value={String(i)}>
                            {d}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>Hour (UTC)</Label>
                  <Input type="number" min={0} max={23} value={hourUtc} onChange={(e) => setHourUtc(Number(e.target.value))} />
                </div>
              </div>
              <p className="text-xs text-text-tertiary">
                About {Math.round(pointsPerRun * runsPerMonth).toLocaleString()} points a month at the current grid and keywords.
              </p>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => act(() => createSchedule(locationId, { frequency, weekday, dayOfMonth, hourUtc }), 'Schedule added')}
              >
                <Plus className="h-4 w-4" />
                Add schedule
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="h-4 w-4" /> Alerts
          </CardTitle>
          <CardDescription>
            Compared with the previous scan of the same grid. Alerts reach the team in-app; route them to email, Slack or
            Telegram with a workflow on <code className="text-[12px]">local_seo.rank_changed</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {rules.length === 0 && <p className="text-sm text-text-secondary">No alert rules yet.</p>}
          {rules.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle p-3 text-[13px]">
              <span className="text-text-primary">
                {METRIC_LABEL[r.metric]} {DIRECTION_LABEL[r.direction]} by {r.threshold}
                {r.metric === 'solv' || r.metric === 'found_pct' ? ' pp' : ''}
                {r.allLocations && <span className="ml-2 text-xs text-text-tertiary">all locations</span>}
              </span>
              {canManage && (
                <button
                  type="button"
                  onClick={() => act(() => deleteAlertRule(r.id, locationId))}
                  className="rounded p-1 text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary"
                  aria-label="Delete alert rule"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
          {canManage && (
            <div className="space-y-3 border-t border-border-subtle pt-4">
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1.5">
                  <Label>Metric</Label>
                  <Select value={metric} onValueChange={(v) => setMetric(v as AlertRuleItem['metric'])}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(METRIC_LABEL).map(([k, l]) => (
                        <SelectItem key={k} value={k}>
                          {l}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>When it</Label>
                  <Select value={direction} onValueChange={(v) => setDirection(v as AlertRuleItem['direction'])}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="worse">Gets worse</SelectItem>
                      <SelectItem value="better">Improves</SelectItem>
                      <SelectItem value="any">Changes</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>By at least</Label>
                  <Input type="number" min={0.1} step={0.5} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
                </div>
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy || !(threshold > 0)}
                onClick={() => act(() => createAlertRule(locationId, { metric, direction, threshold }), 'Alert added')}
              >
                <Plus className="h-4 w-4" />
                Add alert
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
