'use client'

import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface EventRow {
  event_name: string
  event_id: string
  status: string
  attempts: number
  last_error: string | null
  fb_trace_id: string | null
  created_at: string
  sent_at: string | null
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  sent: 'default',
  pending: 'secondary',
  failed: 'outline',
  dead: 'destructive',
}

export function CapiEventsTable({ events }: { events: EventRow[] }) {
  return (
    <Card className="p-5">
      <h2 className="text-[13px] font-medium text-text-primary">Eventos recentes</h2>
      {events.length === 0 ? (
        <p className="mt-2 text-[12px] text-text-secondary">Nenhum evento na fila ainda.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="text-text-secondary">
              <tr className="border-b border-border-subtle text-left">
                <th className="py-1.5 pr-3 font-medium">Evento</th>
                <th className="py-1.5 pr-3 font-medium">Status</th>
                <th className="py-1.5 pr-3 font-medium">Tent.</th>
                <th className="py-1.5 pr-3 font-medium">Criado</th>
                <th className="py-1.5 pr-3 font-medium">Detalhe</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={`${e.event_name}-${e.event_id}`} className="border-b border-border-subtle/50">
                  <td className="py-1.5 pr-3 font-medium text-text-primary">{e.event_name}</td>
                  <td className="py-1.5 pr-3">
                    <Badge variant={STATUS_VARIANT[e.status] ?? 'secondary'}>{e.status}</Badge>
                  </td>
                  <td className="py-1.5 pr-3 text-text-secondary">{e.attempts}</td>
                  <td className="py-1.5 pr-3 text-text-secondary">
                    {new Date(e.created_at).toLocaleString()}
                  </td>
                  <td className="py-1.5 pr-3 text-text-secondary">
                    {e.last_error
                      ? <span className="text-red-500">{e.last_error}</span>
                      : e.fb_trace_id
                      ? <span>trace {e.fb_trace_id}</span>
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
