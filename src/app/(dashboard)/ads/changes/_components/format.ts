// Display helpers shared by the Ads Control Plane "Changes" views.

import type { ChangeStatus } from '@/lib/ads/commands/types'
import type { BadgeProps } from '@/components/ui/badge'

export const STATUS_LABEL: Record<ChangeStatus, string> = {
  draft: 'Draft',
  validating: 'Validating',
  awaiting_approval: 'Awaiting approval',
  queued: 'Queued',
  executing: 'Executing',
  verifying: 'Verifying',
  succeeded: 'Succeeded',
  failed: 'Failed',
  drifted: 'Drifted',
  cancelled: 'Cancelled',
  expired: 'Expired',
}

export const STATUS_BADGE_VARIANT: Record<ChangeStatus, NonNullable<BadgeProps['variant']>> = {
  draft: 'outline',
  validating: 'info',
  awaiting_approval: 'warning',
  queued: 'info',
  executing: 'info',
  verifying: 'info',
  succeeded: 'success',
  failed: 'danger',
  drifted: 'warning',
  cancelled: 'outline',
  expired: 'outline',
}

// ChangeView.risk_level comes back as a plain `number` (JSON round-trip), so
// these are keyed loosely and fall back for anything outside 1-4.
const RISK_LABELS: Record<number, string> = {
  1: 'Reversible',
  2: 'Targeting',
  3: 'Strategy',
  4: 'Structural',
}

const RISK_VARIANTS: Record<number, NonNullable<BadgeProps['variant']>> = {
  1: 'outline',
  2: 'info',
  3: 'warning',
  4: 'danger',
}

export function riskLabel(risk: number): string {
  return RISK_LABELS[risk] ?? `Risk ${risk}`
}

export function riskBadgeVariant(risk: number): NonNullable<BadgeProps['variant']> {
  return RISK_VARIANTS[risk] ?? 'outline'
}

export function platformLabel(platform: 'meta' | 'google'): string {
  return platform === 'meta' ? 'Meta' : 'Google'
}

export function platformBadgeClass(platform: 'meta' | 'google'): string {
  return platform === 'meta' ? 'bg-blue-500/10 text-blue-400' : 'bg-[#4285F4]/10 text-[#4285F4]'
}

/** Compact "3 minutes ago" / "in 2 hours" style relative time. */
export function formatRelativeTime(iso: string | null): string {
  if (!iso) return '—'
  const diffMs = new Date(iso).getTime() - Date.now()
  const diffSec = Math.round(diffMs / 1000)
  const abs = Math.abs(diffSec)

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ]
  for (const [unit, secs] of units) {
    if (abs >= secs) {
      const value = Math.round(diffSec / secs)
      return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(value, unit)
    }
  }
  return diffSec === 0 ? 'just now' : new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(diffSec, 'second')
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Whether an actor label reads as AI/machine-originated vs. a human. */
export function isMachineActor(actorType: string): boolean {
  return actorType !== 'user'
}
