'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

const STAGE_LABEL: Record<string, string> = {
  setup: 'Reading robots.txt and sitemap…',
  crawl: 'Crawling pages…',
  finalize: 'Analyzing results…',
}

/**
 * Progress line for an active audit. While mounted it refreshes the server
 * component every few seconds, so the page fills in as the cron advances.
 */
export function AuditProgress({
  status,
  stage,
  crawled,
  discovered,
  compact = false,
}: {
  status: 'pending' | 'running'
  stage: string
  crawled: number
  discovered: number
  compact?: boolean
}) {
  const router = useRouter()
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 5000)
    return () => clearInterval(id)
  }, [router])

  const label = status === 'pending' ? 'Queued — starts within a minute' : (STAGE_LABEL[stage] ?? 'Running…')
  const pct = discovered > 0 ? Math.min(100, Math.round((crawled / discovered) * 100)) : 0

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-sm text-text-secondary">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span>{label}</span>
        {stage === 'crawl' && (
          <span className="ml-auto tabular-nums text-text-tertiary">
            {crawled} / {discovered} pages
          </span>
        )}
      </div>
      {!compact && stage === 'crawl' && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-tertiary">
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  )
}
