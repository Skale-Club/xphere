'use client'

// Full-screen paywall shown (in place of the requested page) when an org's trial
// has lapsed and there's no active subscription. Rendered by the dashboard layout
// instead of {children}, so it can't loop and the user can subscribe right here.
import * as React from 'react'
import { Sparkles, Check } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { createCheckoutSession, createPortalSession } from '@/lib/billing/actions'

export interface PaywallPlan {
  key: string
  name: string
  features: string[]
}

interface Props {
  plans: PaywallPlan[]
  /** true = trial lapsed; false = never provisioned. Only changes the copy. */
  trialEnded: boolean
  /** Only org admins/owners can start checkout. */
  isAdmin: boolean
}

export function BillingPaywall({ plans, trialEnded, isAdmin }: Props) {
  const [pending, setPending] = React.useState<string | null>(null)
  const busy = pending !== null

  async function subscribe(planKey: string) {
    setPending(`checkout:${planKey}`)
    try {
      const res = await createCheckoutSession(planKey)
      if (res.ok) {
        window.location.assign(res.data.url)
        return // navigating away — keep the spinner
      }
      toast.error(res.error)
    } catch {
      toast.error('Could not start checkout. Please try again.')
    }
    setPending(null)
  }

  async function openPortal() {
    setPending('portal')
    try {
      const res = await createPortalSession()
      if (res.ok) {
        window.location.assign(res.data.url)
        return
      }
      toast.error(res.error)
    } catch {
      toast.error('Could not open the billing portal. Please try again.')
    }
    setPending(null)
  }

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-3xl space-y-6 text-center">
        <div className="space-y-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent-muted">
            <Sparkles className="h-6 w-6 text-accent" />
          </div>
          <h1 className="text-2xl font-semibold text-text-primary">
            {trialEnded ? 'Your free trial has ended' : 'Choose a plan to get started'}
          </h1>
          <p className="text-sm text-text-secondary">
            {isAdmin
              ? 'Pick a plan to keep using your workspace. You can change or cancel anytime.'
              : 'Your workspace needs an active plan. Contact an organization admin to subscribe.'}
          </p>
        </div>

        {plans.length === 0 ? (
          <p className="text-sm text-text-tertiary">
            No plans are available yet. Please contact support.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3 text-left">
            {plans.map((plan) => (
              <div
                key={plan.key}
                className="flex flex-col rounded-xl border border-border bg-bg-secondary p-5"
              >
                <div className="text-base font-semibold text-text-primary">{plan.name}</div>
                <ul className="mt-3 flex-1 space-y-1.5">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-xs text-text-secondary">
                      <Check className="h-3.5 w-3.5 shrink-0 text-accent" />
                      <span className="capitalize">{f.replace(/_/g, ' ')}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  className="mt-4 w-full"
                  size="sm"
                  onClick={() => subscribe(plan.key)}
                  disabled={!isAdmin || busy}
                  loading={pending === `checkout:${plan.key}`}
                >
                  Subscribe
                </Button>
              </div>
            ))}
          </div>
        )}

        {isAdmin && (
          <button
            type="button"
            onClick={openPortal}
            disabled={busy}
            className="text-xs text-text-tertiary underline-offset-4 hover:underline disabled:opacity-50"
          >
            Already subscribed? Manage billing
          </button>
        )}
      </div>
    </div>
  )
}
