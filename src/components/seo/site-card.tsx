import { formatDistanceToNow } from 'date-fns'
import { ArrowDownRight, ArrowUpRight, Globe } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { AuditProgress } from '@/components/seo/audit-progress'
import { ScoreBadge } from '@/components/seo/score-badge'
import { cn } from '@/lib/utils'

export type SiteCardData = {
  name: string
  host: string
  score: number | null
  /** Score change against the previous completed audit. */
  delta: number | null
  severity: { error: number; warning: number; notice: number } | null
  pagesCrawled: number | null
  auditedAt: string | null
  /** Search Console clicks over the last 30 days; null when GSC isn't linked. */
  clicks30: number | null
  running: { status: 'pending' | 'running'; stage: string; crawled: number; discovered: number } | null
}

const SEVERITIES = [
  { key: 'error', label: 'Errors', dot: 'bg-danger' },
  { key: 'warning', label: 'Warnings', dot: 'bg-warning' },
  { key: 'notice', label: 'Notices', dot: 'bg-text-tertiary' },
] as const

export function SiteCard({ data }: { data: SiteCardData }) {
  return (
    <Card className="h-full transition-colors group-hover:border-accent/40">
      <CardContent className="flex h-full flex-col gap-4 p-5">
        <div className="flex items-center gap-4">
          <ScoreBadge score={data.score} />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[15px] font-semibold text-text-primary">{data.name}</h3>
            <p className="flex items-center gap-1 truncate text-[12.5px] text-text-tertiary">
              <Globe className="h-3 w-3 shrink-0" />
              <span className="truncate">{data.host}</span>
            </p>
            {data.delta !== null && data.delta !== 0 && (
              <p className={cn('mt-0.5 flex items-center gap-0.5 text-[12px]', data.delta > 0 ? 'text-success' : 'text-danger')}>
                {data.delta > 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                {Math.abs(data.delta)} since last audit
              </p>
            )}
          </div>
        </div>

        {data.running ? (
          <AuditProgress
            status={data.running.status}
            stage={data.running.stage}
            crawled={data.running.crawled}
            discovered={data.running.discovered}
            compact
          />
        ) : data.severity ? (
          <div className="grid grid-cols-3 divide-x divide-border-subtle rounded-lg border border-border-subtle bg-bg-tertiary/40">
            {SEVERITIES.map((s) => {
              const n = data.severity![s.key]
              return (
                <div key={s.key} className="px-3 py-2.5">
                  <div className={cn('text-base font-semibold tabular-nums sm:text-lg', n > 0 ? 'text-text-primary' : 'text-text-tertiary')}>
                    {n.toLocaleString()}
                  </div>
                  <div className="flex items-center gap-1.5 text-[11.5px] text-text-tertiary">
                    <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
                    {s.label}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border-subtle px-3 py-4 text-center text-[12.5px] text-text-tertiary">
            The first audit starts within a minute.
          </div>
        )}

        <div className="mt-auto flex items-center justify-between gap-3 border-t border-border-subtle pt-3 text-[12px] text-text-tertiary">
          <span className="truncate">
            {data.pagesCrawled !== null && <>{data.pagesCrawled.toLocaleString()} pages</>}
            {data.clicks30 !== null && <> · {data.clicks30.toLocaleString()} clicks (30d)</>}
          </span>
          {data.auditedAt && (
            <span className="shrink-0">Audited {formatDistanceToNow(new Date(data.auditedAt), { addSuffix: true })}</span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
