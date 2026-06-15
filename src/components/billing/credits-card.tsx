'use client'

// Copilot credit wallet UI for Settings → Billing: shows the balance, lets admins
// buy top-up packages, and lists recent credit activity. Credits are presented as
// round numbers (1 credit = CREDIT_USD_RATE) while accounting stays in USD.
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { createCreditTopUpSession } from '@/lib/billing/actions'
import { CREDIT_USD_RATE } from '@/lib/billing/catalog'

interface Pkg {
  key: string
  name: string
  creditsUsd: number
}
interface LedgerEntry {
  id: string
  kind: string
  amountUsd: number
  balanceAfter: number
  note: string | null
  createdAt: string
}
interface Props {
  totalUsd: number
  includedUsd: number
  topupUsd: number
  packages: Pkg[]
  ledger: LedgerEntry[]
  isAdmin: boolean
  topupResult: 'success' | 'cancel' | null
}

function toCredits(usd: number): string {
  return Math.round(usd / CREDIT_USD_RATE).toLocaleString()
}

const KIND_LABEL: Record<string, string> = {
  monthly_reset: 'Monthly refresh',
  topup: 'Top-up purchase',
  grant: 'Granted',
  debit: 'Copilot usage',
}

export function CreditsCard({
  totalUsd,
  includedUsd,
  topupUsd,
  packages,
  ledger,
  isAdmin,
  topupResult,
}: Props) {
  const router = useRouter()
  const [pending, setPending] = React.useState<string | null>(null)
  const busy = pending !== null

  // Surface the top-up redirect outcome once, then strip the query param.
  React.useEffect(() => {
    if (!topupResult) return
    if (topupResult === 'success') {
      toast.success('Credits added — they may take a moment to appear.')
    } else {
      toast('Top-up canceled. No charge was made.')
    }
    router.replace('/settings/billing')
  }, [topupResult, router])

  async function buy(pkgKey: string) {
    setPending(pkgKey)
    try {
      const res = await createCreditTopUpSession(pkgKey)
      if (res.ok) {
        window.location.assign(res.data.url)
        return
      }
      toast.error(res.error)
    } catch {
      toast.error('Could not start checkout. Please try again.')
    }
    setPending(null)
  }

  return (
    <div className="rounded-lg border border-border p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Copilot credits</h2>
      </div>

      <div>
        <p className="text-2xl font-semibold text-text-primary tabular-nums">
          {toCredits(totalUsd)} <span className="text-sm font-normal text-text-tertiary">credits</span>
        </p>
        <p className="text-xs text-text-tertiary mt-0.5">
          {toCredits(includedUsd)} from your plan · {toCredits(topupUsd)} purchased
        </p>
      </div>

      {/* Top-up packages */}
      {packages.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-text-secondary">Buy more credits</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {packages.map((pkg) => (
              <Button
                key={pkg.key}
                variant="outline"
                size="sm"
                disabled={!isAdmin || busy}
                loading={pending === pkg.key}
                onClick={() => buy(pkg.key)}
              >
                +{toCredits(pkg.creditsUsd)}
              </Button>
            ))}
          </div>
          {!isAdmin && (
            <p className="text-xs text-text-tertiary">Only org admins can buy credits.</p>
          )}
        </div>
      ) : (
        <p className="text-xs text-text-tertiary">Credit top-ups aren&rsquo;t available yet.</p>
      )}

      {/* Recent activity */}
      {ledger.length > 0 && (
        <div className="space-y-1.5 border-t border-border-subtle pt-3">
          <p className="text-xs font-medium text-text-secondary">Recent activity</p>
          <ul className="space-y-1">
            {ledger.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-text-secondary truncate">
                  {KIND_LABEL[e.kind] ?? e.kind}
                </span>
                <span
                  className={`tabular-nums shrink-0 ${e.amountUsd < 0 ? 'text-text-tertiary' : 'text-emerald-500'}`}
                >
                  {e.amountUsd < 0 ? '−' : '+'}
                  {toCredits(Math.abs(e.amountUsd))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
