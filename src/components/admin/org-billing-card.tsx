'use client'

// Agency billing controls on the org detail page: see the effective plan + Copilot
// credit balance, assign/clear a plan override, grant credits, and extend the trial.
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import {
  setOrgPlanOverride,
  grantCopilotCredits,
  extendTrial,
} from '@/app/(admin)/admin/_actions/billing-actions'
import type { OrgBilling } from '@/app/(admin)/admin/_actions/get-org-detail'
import { PLAN_CATALOG } from '@/lib/billing/catalog'

const ASSIGNABLE_PLANS = Object.values(PLAN_CATALOG).map((p) => ({ key: p.key, name: p.name }))

const STATUS_TONE: Record<string, string> = {
  active: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  trialing: 'bg-sky-500/10 text-sky-500 border-sky-500/20',
  past_due: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  expired: 'bg-bg-tertiary text-text-tertiary border-border',
  none: 'bg-bg-tertiary text-text-tertiary border-border',
}

function usd(n: number): string {
  return `$${n.toFixed(2)}`
}

export function OrgBillingCard({
  orgId,
  billing,
}: {
  orgId: string
  billing: OrgBilling
}) {
  const plans = ASSIGNABLE_PLANS
  const [planSel, setPlanSel] = useState(billing.planOverride ?? '')
  const [creditAmount, setCreditAmount] = useState('')
  const [trialDays, setTrialDays] = useState('')
  const [isPending, startTransition] = useTransition()

  function run(label: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const res = await fn()
      if (res.ok) toast.success(`${label} updated`)
      else toast.error(res.error ?? `Failed to update ${label.toLowerCase()}`)
    })
  }

  return (
    <Card>
      <CardHeader className="pb-3 pt-4 px-4">
        <p className="text-sm font-semibold text-text-primary">Billing &amp; Plan</p>
      </CardHeader>
      <Separator className="bg-border-subtle" />
      <CardContent className="p-4 space-y-4">
        {/* Effective state */}
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {billing.effectivePlanName ?? 'No plan'}
            </Badge>
            <Badge variant="outline" className={`text-xs capitalize ${STATUS_TONE[billing.status] ?? ''}`}>
              {billing.status}
            </Badge>
            <span className="text-xs text-text-tertiary">via {billing.source}</span>
          </div>
          {billing.trialEndsAt && (
            <p className="text-xs text-text-tertiary">
              Trial ends {new Date(billing.trialEndsAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
            </p>
          )}
          <p className="text-xs text-text-tertiary">
            Copilot credits: <span className="text-text-secondary tabular-nums">{usd(billing.copilotTotalUsd)}</span>
            {' '}<span className="text-text-tertiary">(incl {usd(billing.copilotIncludedUsd)} · top-up {usd(billing.copilotTopupUsd)})</span>
          </p>
        </div>

        <Separator className="bg-border-subtle" />

        {/* Plan override */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-secondary">Plan override</label>
          <div className="flex gap-2">
            <select
              value={planSel}
              onChange={(e) => setPlanSel(e.target.value)}
              disabled={isPending}
              className="flex-1 h-9 rounded-md border border-border bg-bg-secondary px-2 text-sm text-text-primary"
            >
              <option value="">No override (auto)</option>
              {plans.map((p) => (
                <option key={p.key} value={p.key}>{p.name}</option>
              ))}
            </select>
            <Button
              size="sm"
              variant="outline"
              disabled={isPending || planSel === (billing.planOverride ?? '')}
              onClick={() => run('Plan override', () => setOrgPlanOverride(orgId, planSel || null))}
            >
              Apply
            </Button>
          </div>
        </div>

        {/* Grant credits */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-secondary">Grant Copilot credits (USD)</label>
          <div className="flex gap-2">
            <Input
              type="number"
              min="0"
              step="0.01"
              placeholder="10.00"
              value={creditAmount}
              onChange={(e) => setCreditAmount(e.target.value)}
              disabled={isPending}
              className="flex-1 h-9"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={isPending || !(Number(creditAmount) > 0)}
              onClick={() => {
                run('Credits', () => grantCopilotCredits(orgId, Number(creditAmount)))
                setCreditAmount('')
              }}
            >
              Grant
            </Button>
          </div>
        </div>

        {/* Extend trial */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-secondary">Extend trial (days)</label>
          <div className="flex gap-2">
            <Input
              type="number"
              step="1"
              placeholder="14"
              value={trialDays}
              onChange={(e) => setTrialDays(e.target.value)}
              disabled={isPending}
              className="flex-1 h-9"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={isPending || !Number.isFinite(Number(trialDays)) || Number(trialDays) === 0}
              onClick={() => run('Trial', () => extendTrial(orgId, Number(trialDays)))}
            >
              Extend
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
