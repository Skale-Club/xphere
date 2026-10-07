import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { ArrowDownRight, ArrowUpRight, ChevronRight } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { ScoreBadge } from '@/components/seo/score-badge'
import { cn } from '@/lib/utils'

export type SiteRow = {
  id: string
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
  running: { crawled: number; discovered: number } | null
}

// Site | Errors | Warnings | Notices | Pages | Clicks | Last audit | ›
const COLS = '@3xl:grid-cols-[minmax(0,2.4fr)_repeat(5,minmax(0,0.75fr))_minmax(0,1.1fr)_16px]'

const SEVERITIES = [
  { key: 'error', label: 'Errors', dot: 'bg-danger' },
  { key: 'warning', label: 'Warnings', dot: 'bg-warning' },
  { key: 'notice', label: 'Notices', dot: 'bg-text-tertiary' },
] as const

function Num({ value, muted }: { value: string; muted?: boolean }) {
  return <span className={cn('tabular-nums', muted ? 'text-text-tertiary' : 'text-text-primary')}>{value}</span>
}

/** Audited sites as one table-like list: one row per site, columns aligned. */
export function SiteList({ rows }: { rows: SiteRow[] }) {
  return (
    <Card className="@container overflow-hidden p-0">
      <div className={cn('hidden gap-4 border-b border-border-subtle px-5 py-2.5 text-[11px] font-medium uppercase tracking-wide text-text-tertiary @3xl:grid', COLS)}>
        <span>Site</span>
        {SEVERITIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
            {s.label}
          </span>
        ))}
        <span>Pages</span>
        <span title="Search Console clicks, last 30 days">Clicks</span>
        <span>Last audit</span>
        <span />
      </div>

      <div className="divide-y divide-border-subtle">
        {rows.map((r) => (
          <Link
            key={r.id}
            href={`/seo/website/${r.id}`}
            className={cn('group grid items-center gap-x-4 gap-y-2 px-5 py-3.5 text-[13px] transition-colors hover:bg-bg-tertiary/40', COLS)}
          >
            <div className="flex min-w-0 items-center gap-3">
              <ScoreBadge score={r.score} size="sm" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold text-text-primary">{r.name}</span>
                  {r.delta !== null && r.delta !== 0 && (
                    <span
                      className={cn('flex shrink-0 items-center text-[11.5px] font-medium', r.delta > 0 ? 'text-success' : 'text-danger')}
                      title="Change since the previous audit"
                    >
                      {r.delta > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                      {Math.abs(r.delta)}
                    </span>
                  )}
                </div>
                <div className="truncate text-[12px] text-text-tertiary">{r.host}</div>
              </div>
            </div>

            {SEVERITIES.map((s) => {
              const n = r.severity?.[s.key] ?? null
              return (
                <div key={s.key} className="hidden @3xl:block">
                  <Num value={n === null ? '—' : n.toLocaleString()} muted={!n} />
                </div>
              )
            })}
            <div className="hidden @3xl:block">
              <Num value={r.pagesCrawled === null ? '—' : r.pagesCrawled.toLocaleString()} muted={r.pagesCrawled === null} />
            </div>
            <div className="hidden @3xl:block">
              {r.clicks30 === null ? (
                <span className="text-[12px] text-text-tertiary" title="Search Console is not linked to this site">
                  Not linked
                </span>
              ) : (
                <Num value={r.clicks30.toLocaleString()} muted={r.clicks30 === 0} />
              )}
            </div>

            {/* Phone: the columns above fold into one line. */}
            <div className="flex items-center gap-3 text-[12px] text-text-tertiary @3xl:hidden">
              {r.severity &&
                SEVERITIES.map((s) => (
                  <span key={s.key} className="flex items-center gap-1">
                    <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
                    <span className="tabular-nums">{r.severity![s.key]}</span>
                  </span>
                ))}
            </div>

            <div className="text-[12px] text-text-secondary">
              {r.running ? (
                <span className="flex items-center gap-1.5 text-accent">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                  Auditing · {r.running.crawled}
                  {r.running.discovered > 0 && `/${r.running.discovered}`} pages
                </span>
              ) : r.auditedAt ? (
                formatDistanceToNow(new Date(r.auditedAt), { addSuffix: true })
              ) : (
                <span className="text-text-tertiary">Starting soon</span>
              )}
            </div>
            <ChevronRight className="hidden h-4 w-4 text-text-tertiary transition-transform group-hover:translate-x-0.5 group-hover:text-text-primary @3xl:block" />
          </Link>
        ))}
      </div>
    </Card>
  )
}
