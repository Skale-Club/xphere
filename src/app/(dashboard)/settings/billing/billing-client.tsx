'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CreditCard, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'

import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { createCheckoutSession, createPortalSession } from '@/lib/billing/actions'
import { trackEvent } from '@/lib/tracking/events'

interface Subscription {
  status: string
  stripe_price_id: string | null
  cancel_at_period_end: boolean
  current_period_end: string | null
}

interface Props {
  isAdmin: boolean
  subscription: Subscription | null
  plans: string[]
  checkoutResult: 'success' | 'cancel' | null
  checkoutSessionId: string | null
}

// Stripe subscription status → human label + badge tone.
const STATUS_META: Record<string, { label: string; variant: BadgeProps['variant'] }> = {
  active: { label: 'Active', variant: 'success' },
  trialing: { label: 'Trialing', variant: 'info' },
  past_due: { label: 'Past due', variant: 'warning' },
  unpaid: { label: 'Unpaid', variant: 'danger' },
  paused: { label: 'Paused', variant: 'warning' },
  canceled: { label: 'Canceled', variant: 'secondary' },
  incomplete: { label: 'Incomplete', variant: 'warning' },
  incomplete_expired: { label: 'Expired', variant: 'secondary' },
}

// Mirrors the page's ACTIVE_STATUSES: a live/recoverable subscription is managed
// through the Stripe Customer Portal rather than a new checkout.
const ACTIVE_STATUSES = new Set(['trialing', 'active', 'past_due', 'unpaid', 'paused'])

function formatPlanKey(key: string): string {
  return key
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function BillingClient({ isAdmin, subscription, plans, checkoutResult, checkoutSessionId }: Props) {
  const router = useRouter()
  // Tracks which action is in flight (e.g. 'portal' or `checkout:pro`) so only
  // the clicked button shows a spinner while every button is disabled.
  const [pending, setPending] = React.useState<string | null>(null)

  // Surface the Stripe redirect outcome once, then strip the query param so a
  // refresh doesn't replay the toast. "success" only means the user returned —
  // entitlement is granted by the webhook, never by this redirect.
  React.useEffect(() => {
    if (!checkoutResult) return
    if (checkoutResult === 'success') {
      toast.success('Checkout complete — your subscription will activate once payment is confirmed.')
      // Dedupe against sessionStorage so a page refresh (or the router.replace
      // below re-rendering before the URL updates) doesn't double-fire the
      // conversion event for the same Stripe Checkout Session.
      const dedupeKey = checkoutSessionId ? `purchase_tracked_${checkoutSessionId}` : null
      if (!dedupeKey || !window.sessionStorage.getItem(dedupeKey)) {
        trackEvent('purchase', { session_id: checkoutSessionId ?? undefined })
        if (dedupeKey) window.sessionStorage.setItem(dedupeKey, '1')
      }
    } else {
      toast('Checkout canceled. No changes were made.')
    }
    router.replace('/settings/billing')
  }, [checkoutResult, checkoutSessionId, router])

  async function startCheckout(planKey: string) {
    setPending(`checkout:${planKey}`)
    try {
      const res = await createCheckoutSession(planKey)
      if (res.ok) {
        trackEvent('checkout_started', { plan: planKey })
        window.location.assign(res.data.url) // redirect to Stripe Hosted Checkout
        return // keep the spinner: the page is navigating away
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
        window.location.assign(res.data.url) // redirect to Stripe Customer Portal
        return
      }
      toast.error(res.error)
    } catch {
      toast.error('Could not open the billing portal. Please try again.')
    }
    setPending(null)
  }

  const hasActive = subscription != null && ACTIVE_STATUSES.has(subscription.status)
  const statusMeta = subscription
    ? STATUS_META[subscription.status] ?? { label: subscription.status, variant: 'secondary' as const }
    : null
  const periodEnd = formatDate(subscription?.current_period_end ?? null)
  const busy = pending !== null

  return (
    <div className="space-y-6">
      {/* Current subscription */}
      <div className="rounded-lg border border-border p-4 space-y-4">
        <div className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">Current subscription</h2>
        </div>

        {subscription && statusMeta ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
              {subscription.cancel_at_period_end && (
                <Badge variant="warning">Cancels at period end</Badge>
              )}
            </div>
            {periodEnd && (
              <p className="text-sm text-muted-foreground">
                {subscription.cancel_at_period_end
                  ? `Access ends on ${periodEnd}.`
                  : `Renews on ${periodEnd}.`}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Your organization doesn&rsquo;t have an active subscription yet.
          </p>
        )}

        {hasActive && (
          <Button
            variant="outline"
            size="sm"
            onClick={openPortal}
            disabled={!isAdmin || busy}
            loading={pending === 'portal'}
          >
            Manage subscription
            <ExternalLink className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Plan picker — only when there's nothing live to manage */}
      {!hasActive && (
        <div className="rounded-lg border border-border p-4 space-y-4">
          <h2 className="text-sm font-medium">{subscription ? 'Resubscribe' : 'Choose a plan'}</h2>

          {plans.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No plans are available yet. Please check back soon.
            </p>
          ) : (
            <div className="space-y-2">
              {plans.map((key) => (
                <div
                  key={key}
                  className="flex items-center justify-between rounded-md border border-border-subtle bg-bg-secondary px-3 py-2.5"
                >
                  <span className="text-sm font-medium text-text-primary">{formatPlanKey(key)}</span>
                  <Button
                    size="sm"
                    onClick={() => startCheckout(key)}
                    disabled={!isAdmin || busy}
                    loading={pending === `checkout:${key}`}
                  >
                    Subscribe
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!isAdmin && (
        <p className="text-xs text-muted-foreground">
          Only organization admins can change billing. Contact an admin to manage your subscription.
        </p>
      )}
    </div>
  )
}
