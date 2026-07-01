'use client'

import * as React from 'react'
import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { createClient } from '@/lib/supabase/client'
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
  const instanceId = React.useId().replace(/:/g, '')

  // Realtime subscription: live-update the balance on UPDATE without a page
  // reload (CRB-02). Mirrors NotificationBell's channel-subscribe/cleanup effect.
  React.useEffect(() => {
    if (!orgId) return

    const supabase = createClient()
    const channel = supabase.channel(`copilot-credits:${orgId}:${instanceId}`)

    channel.on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'copilot_credit_balances',
        filter: `org_id=eq.${orgId}`,
      },
      (payload) => {
        // CRITICAL: payload.new carries raw snake_case DB column names, NOT
        // the camelCase CopilotBalance shape — see RESEARCH.md Pitfall 3.
        const row = payload.new as {
          included_balance_usd: string | number
          topup_balance_usd: string | number
          included_allowance_usd: string | number
        }
        const includedUsd = Number(row.included_balance_usd)
        const topupUsd = Number(row.topup_balance_usd)
        setBalance({
          includedUsd,
          topupUsd,
          totalUsd: includedUsd + topupUsd,
          includedAllowanceUsd: Number(row.included_allowance_usd),
        })
      },
    )

    channel.subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [instanceId, orgId])

  // Defensive second guard — the real CRB-03 gate lives in the parent's
  // conditional render (hasCreditsPlan), this just avoids rendering with no data.
  if (!orgId || !balance) return null

  const visualState = getCreditsVisualState(balance.totalUsd, balance.includedAllowanceUsd)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Credit balance"
          className={cn(
            'relative',
            visualState === 'zero'
              ? 'text-destructive hover:text-destructive'
              : visualState === 'low'
                ? 'text-amber-500 hover:text-amber-500'
                : 'text-text-secondary hover:text-text-primary',
          )}
        >
          <Sparkles className="h-[15px] w-[15px]" />
          {visualState !== 'healthy' && (
            <span
              className={cn(
                'absolute -right-0.5 -top-0.5 h-4 min-w-4 rounded-full ring-2 ring-bg-primary',
                visualState === 'low' ? 'bg-amber-500' : 'bg-destructive',
              )}
              aria-hidden="true"
            />
          )}
        </Button>
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
