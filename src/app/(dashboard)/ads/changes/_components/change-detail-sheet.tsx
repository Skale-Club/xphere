'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import type { ChangeView } from '@/lib/ads/commands/engine'
import type { Database } from '@/types/database'
import {
  formatDateTime,
  isMachineActor,
  platformLabel,
  riskBadgeVariant,
  riskLabel,
  STATUS_BADGE_VARIANT,
  STATUS_LABEL,
} from './format'

type ChangeEventRow = Database['public']['Tables']['ads_change_events']['Row']

export function ChangeDetailSheet({
  changeId,
  onOpenChange,
}: {
  changeId: string | null
  onOpenChange: (open: boolean) => void
}) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{ change: ChangeView; events: ChangeEventRow[] } | null>(null)

  const loadDetail = useCallback(async (id: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/ads/changes/${id}`)
      const json = (await res.json()) as { change: ChangeView; events: ChangeEventRow[] }
      setData(json)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!changeId) return
    void loadDetail(changeId)
  }, [changeId, loadDetail])

  const change = data?.change

  return (
    <Sheet open={!!changeId} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[560px]">
        {loading || !change ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-text-tertiary" />
          </div>
        ) : (
          <div className="space-y-5">
            <SheetHeader>
              <SheetTitle>{change.label}</SheetTitle>
              <SheetDescription>
                {platformLabel(change.platform)} · {change.resource_name ?? change.resource_id ?? change.ad_account_id}
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={STATUS_BADGE_VARIANT[change.status]}>{STATUS_LABEL[change.status]}</Badge>
              <Badge variant={riskBadgeVariant(change.risk_level)}>{riskLabel(change.risk_level)}</Badge>
              <span className="text-[12px] text-text-tertiary">
                {isMachineActor(change.actor_type) ? 'AI' : 'Human'} · {change.actor_label ?? change.actor_type}
              </span>
            </div>

            {change.diff.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-[12px] font-medium uppercase tracking-wide text-text-tertiary">Change</h3>
                <div className="rounded-lg border border-border-subtle overflow-hidden">
                  <table className="w-full text-[12.5px]">
                    <thead>
                      <tr className="border-b border-border-subtle bg-bg-secondary">
                        <th className="px-3 py-2 text-left font-medium text-text-tertiary">Field</th>
                        <th className="px-3 py-2 text-left font-medium text-text-tertiary">Before</th>
                        <th className="px-3 py-2 text-left font-medium text-text-tertiary">After</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-subtle">
                      {change.diff.map((d, i) => (
                        <tr key={i}>
                          <td className="px-3 py-2 text-text-secondary">{d.label}</td>
                          <td className="px-3 py-2 text-text-primary">{d.beforeDisplay}</td>
                          <td className="px-3 py-2 font-medium text-text-primary">{d.afterDisplay}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {change.approval_reasons.length > 0 && (
              <section className="space-y-1.5">
                <h3 className="text-[12px] font-medium uppercase tracking-wide text-text-tertiary">Approval reasons</h3>
                <ul className="space-y-1 text-[12.5px] text-text-secondary">
                  {change.approval_reasons.map((r, i) => <li key={i}>· {r.message}</li>)}
                </ul>
              </section>
            )}

            {change.warnings.length > 0 && (
              <section className="space-y-1.5">
                <h3 className="text-[12px] font-medium uppercase tracking-wide text-text-tertiary">Warnings</h3>
                <ul className="space-y-1 text-[12.5px] text-text-secondary">
                  {change.warnings.map((w, i) => <li key={i}>· {w}</li>)}
                </ul>
              </section>
            )}

            {change.error_message && (
              <section className="space-y-1.5">
                <h3 className="text-[12px] font-medium uppercase tracking-wide text-text-tertiary">Error</h3>
                <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[12.5px] text-red-400">
                  {change.error_code ? `${change.error_code}: ` : ''}{change.error_message}
                </p>
              </section>
            )}

            <section className="space-y-2">
              <h3 className="text-[12px] font-medium uppercase tracking-wide text-text-tertiary">Timeline</h3>
              <ul className="space-y-3">
                {data.events.map((event) => (
                  <li key={event.id} className="flex gap-3 text-[12.5px]">
                    <div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-text-tertiary" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-text-primary">{event.event_type.replace(/_/g, ' ')}</span>
                        <span className="shrink-0 text-[11px] text-text-tertiary">{formatDateTime(event.created_at)}</span>
                      </div>
                      <div className="text-text-tertiary">
                        {event.to_status && <span>→ {STATUS_LABEL[event.to_status as keyof typeof STATUS_LABEL] ?? event.to_status} · </span>}
                        {isMachineActor(event.actor_type) ? 'AI' : 'Human'}: {event.actor_label ?? event.actor_type}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
