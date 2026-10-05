'use client'

import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MAX_PAGES_OPTIONS, SCHEDULE_LABELS } from '@/lib/seo/constants'

export type Schedule = keyof typeof SCHEDULE_LABELS

/** Schedule + page-limit pickers shared by the add-site and settings dialogs. */
export function SiteCrawlFields({
  schedule,
  maxPages,
  onScheduleChange,
  onMaxPagesChange,
}: {
  schedule: Schedule
  maxPages: number
  onScheduleChange: (v: Schedule) => void
  onMaxPagesChange: (v: number) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1.5">
        <Label>Automatic audits</Label>
        <Select value={schedule} onValueChange={(v) => onScheduleChange(v as Schedule)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(SCHEDULE_LABELS) as Schedule[]).map((k) => (
              <SelectItem key={k} value={k}>
                {SCHEDULE_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>Pages per audit</Label>
        <Select value={String(maxPages)} onValueChange={(v) => onMaxPagesChange(Number(v))}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MAX_PAGES_OPTIONS.map((n) => (
              <SelectItem key={n} value={String(n)}>
                Up to {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
