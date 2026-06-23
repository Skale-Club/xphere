'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ShieldAlert } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { updateDailyCostCap } from '@/lib/billing/actions'

interface Props {
  isAdmin: boolean
  /** Current on/off state of the cap (organizations.daily_cost_cap_enabled). */
  enabled: boolean
  /** Custom override in USD, or null to use the platform default. */
  amountUsd: number | null
  /** Platform default ($) shown as the placeholder when no custom amount is set. */
  platformDefaultUsd: number
}

export function CostCapCard({ isAdmin, enabled, amountUsd, platformDefaultUsd }: Props) {
  const router = useRouter()
  const [baseline, setBaseline] = React.useState({
    enabled,
    amount: amountUsd != null ? String(amountUsd) : '',
  })
  const [enabledInput, setEnabledInput] = React.useState(baseline.enabled)
  const [amountInput, setAmountInput] = React.useState(baseline.amount)
  const [saving, setSaving] = React.useState(false)

  const dirty =
    enabledInput !== baseline.enabled || amountInput.trim() !== baseline.amount

  async function handleSave() {
    const amount =
      amountInput.trim() === '' ? null : parseFloat(amountInput)
    if (amount != null && Number.isNaN(amount)) {
      toast.error('Enter a valid amount or leave it blank for the platform default.')
      return
    }

    setSaving(true)
    try {
      const result = await updateDailyCostCap({ enabled: enabledInput, amountUsd: amount })
      if (!result.ok) {
        toast.error(result.error ?? 'Failed to save cost cap')
        return
      }
      setBaseline({ enabled: enabledInput, amount: amountInput.trim() })
      toast.success('Daily cost cap saved')
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border border-border p-4 space-y-4">
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Daily AI cost cap</h2>
      </div>

      <p className="text-sm text-muted-foreground">
        Cap how much your agents can spend on AI per day. Once the limit is reached, agent
        requests are blocked until the next 24-hour window. Turn this off to allow unlimited spend.
      </p>

      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-text-primary">Enforce daily cost cap</p>
          <p className="text-xs text-text-tertiary">
            {enabledInput ? 'A daily spend limit is enforced.' : 'No limit — agents can spend without restriction.'}
          </p>
        </div>
        <Switch
          checked={enabledInput}
          onCheckedChange={setEnabledInput}
          disabled={!isAdmin || saving}
          aria-label="Enforce daily cost cap"
        />
      </div>

      {enabledInput && (
        <div className="space-y-1.5">
          <label className="text-xs text-text-secondary">Daily limit (USD)</label>
          <div className="flex items-center gap-2 max-w-xs">
            <span className="text-text-tertiary text-sm">$</span>
            <Input
              type="number"
              min={0}
              max={10000}
              step={1}
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              placeholder={`Platform default ($${platformDefaultUsd})`}
              disabled={!isAdmin || saving}
              className="max-w-[180px]"
            />
          </div>
          <p className="text-xs text-text-tertiary">
            Leave blank to use the platform default of ${platformDefaultUsd}/day.
          </p>
        </div>
      )}

      {isAdmin ? (
        <Button size="sm" onClick={handleSave} disabled={!dirty || saving} loading={saving}>
          Save
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">
          Only organization admins can change the cost cap.
        </p>
      )}
    </div>
  )
}
