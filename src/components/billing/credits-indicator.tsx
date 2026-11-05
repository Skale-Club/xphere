'use client'

import * as React from 'react'
import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { fetchCopilotBalance } from '@/app/(dashboard)/billing-poll-actions'
import { usePolling } from '@/hooks/use-polling'
import { POLL_CREDITS_MS } from '@/lib/polling/intervals'
import { cn } from '@/lib/utils'
import { getCreditsVisualState } from '@/lib/billing/credits-visibility'
import { toCredits } from '@/components/billing/credits-card'

interface CreditsIndicatorProps {
  orgId: string | null
  initialBalance: {
    includedUsd: number
    topupUsd: number
    totalUsd: number
    includedAllowanceUsd: number
  } | null
}

export function CreditsIndicator({ orgId, initialBalance }: CreditsIndicatorProps) {
  const [balance, setBalance] = React.useState(initialBalance)
  const [open, setOpen] = React.useState(false)
  // Poll the balance so it updates without a page reload (replaces the
  // Realtime UPDATE subscription). Skips the state write when nothing changed.
  usePolling(
    async () => {
      if (!orgId) return
      const next = await fetchCopilotBalance(orgId)
      if (!next) return
      setBalance((prev) =>
        prev &&
        prev.includedUsd === next.includedUsd &&
        prev.topupUsd === next.topupUsd &&
        prev.includedAllowanceUsd === next.includedAllowanceUsd
          ? prev
          : next,
      )
    },
    { intervalMs: POLL_CREDITS_MS, enabled: Boolean(orgId), immediate: false },
  )

  // Defensive second guard — the real CRB-03 gate lives in the parent's
  // conditional render (hasCreditsPlan), this just avoids rendering with no data.
  if (!orgId || !balance) return null

  const visualState = getCreditsVisualState(balance.totalUsd, balance.includedAllowanceUsd)
  const credits = toCredits(balance.totalUsd)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/* Credits pill: shows the live balance inline so the number — not a bare
            icon — is what reads. The whole pill tints (neutral → amber → red) as
            the wallet runs low, like a fuel gauge, instead of an alarm-style dot. */}
        <button
          type="button"
          aria-label={`Copilot credits: ${credits}`}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-[8px] border px-2.5',
            'text-[12.5px] font-medium leading-none tabular-nums motion-fast',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
            visualState === 'zero'
              ? 'border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/15 [&>svg]:text-destructive'
              : visualState === 'low'
                ? 'border-amber-500/30 bg-amber-500/10 text-amber-600 hover:bg-amber-500/15 dark:text-amber-400 [&>svg]:text-amber-500'
                : 'border-border-subtle bg-bg-secondary text-text-secondary hover:border-border hover:bg-bg-tertiary hover:text-text-primary [&>svg]:text-accent',
          )}
        >
          <Sparkles className="h-3.5 w-3.5 shrink-0" />
          <span>{credits}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-80 p-0">
        <div className="p-4 space-y-3">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-accent" />
            <span className="text-sm font-medium text-text-primary">Copilot credits</span>
          </div>
          <div>
            <p
              className={cn(
                'text-xl font-semibold tabular-nums',
                visualState === 'zero'
                  ? 'text-destructive'
                  : visualState === 'low'
                    ? 'text-amber-500'
                    : 'text-text-primary',
              )}
            >
              {toCredits(balance.totalUsd)} <span className="text-sm font-normal text-text-tertiary">credits</span>
            </p>
            <p className="text-xs text-text-secondary mt-0.5">
              {toCredits(balance.includedUsd)} from your plan · {toCredits(balance.topupUsd)} purchased
            </p>
          </div>
          {visualState !== 'healthy' && (
            <p className="text-xs text-text-tertiary">
              {visualState === 'zero' ? "You're out of credits." : 'Running low on credits.'}
            </p>
          )}
          <Link
            href="/settings/billing"
            onClick={() => setOpen(false)}
            className="inline-block text-xs font-medium text-accent hover:underline"
          >
            Manage billing
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  )
}
