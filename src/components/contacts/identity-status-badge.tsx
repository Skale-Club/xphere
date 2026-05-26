'use client'

/**
 * IdentityStatusBadge (Phase 110, CID-14 + CID-15, D-07 + D-07a).
 *
 * Renders a 5-state visual badge for `contacts.identity_status`:
 *
 *   - channel_only       → info "Channel only" (Link2 icon)
 *   - identified         → success "Identified" (no icon)
 *   - verified           → success "Verified" (CheckCircle2)
 *   - merge_conflict     → warning "Conflict" (AlertTriangle) +
 *                          wraps Link to /admin/contacts/conflicts
 *   - archived_duplicate → default "Archived" (Archive) — admin-only,
 *                          gated by `showAdminStates` (default false)
 *
 * Effective state derivation:
 *   When `status === 'identified'` and `isVerified === true`, renders
 *   the 'verified' variant instead. This lets the panel show "Verified"
 *   without requiring the DB-side status bump to have happened yet
 *   (and is the source-of-truth when reading from `contact_verifications`).
 *
 * Pitfall 1: defensively returns null for null/unknown status to avoid
 * `Cannot read properties of undefined (reading 'variant')` if an
 * old row pre-1056 sneaks through.
 *
 * Standalone — not embedded in any panel — so the upcoming /contacts/[id]
 * detail page can reuse it unchanged (D-03).
 */

import * as React from 'react'
import Link from 'next/link'
import { CheckCircle2, AlertTriangle, Link2, Archive } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { ContactIdentityStatus } from '@/types/database'

export interface IdentityStatusBadgeProps {
  status: ContactIdentityStatus | null
  /** Show admin-only states (archived_duplicate). Default false. */
  showAdminStates?: boolean
  /**
   * Derived from `EXISTS (SELECT 1 FROM contact_verifications ...)`.
   * Used for the 'identified' → 'verified' effective-state promotion.
   */
  isVerified?: boolean
}

type BadgeVariant = 'default' | 'success' | 'warning' | 'info'

interface BadgeConfig {
  variant: BadgeVariant
  label: string
  icon: React.ComponentType<{ className?: string }> | null
  tooltip: string
  href?: string
}

const CONFIG: Record<ContactIdentityStatus, BadgeConfig> = {
  channel_only: {
    variant: 'info',
    label: 'Channel only',
    icon: Link2,
    tooltip: 'Reachable on a messaging channel but missing phone and email.',
  },
  identified: {
    variant: 'success',
    label: 'Identified',
    icon: null,
    tooltip: 'Has a phone or email but no manual verification yet.',
  },
  verified: {
    variant: 'success',
    label: 'Verified',
    icon: CheckCircle2,
    tooltip: 'Phone or email verified by an admin or response.',
  },
  merge_conflict: {
    variant: 'warning',
    label: 'Conflict',
    icon: AlertTriangle,
    tooltip:
      'Phone matched one contact, email matched another. Resolve in /admin/contacts/conflicts.',
    href: '/admin/contacts/conflicts',
  },
  archived_duplicate: {
    variant: 'default',
    label: 'Archived',
    icon: Archive,
    tooltip: 'Merged into another contact.',
  },
}

export function IdentityStatusBadge({
  status,
  showAdminStates = false,
  isVerified = false,
}: IdentityStatusBadgeProps) {
  // Pitfall 1: defend against null/unknown status.
  if (!status) return null
  if (status === 'archived_duplicate' && !showAdminStates) return null

  // D-07 sub-state derivation: identified + verification row present → verified.
  const effective: ContactIdentityStatus =
    status === 'identified' && isVerified ? 'verified' : status
  const cfg = CONFIG[effective]
  if (!cfg) return null

  const Icon = cfg.icon
  const badge = (
    <Badge variant={cfg.variant}>
      {Icon ? <Icon className="h-3 w-3" /> : null}
      <span>{cfg.label}</span>
    </Badge>
  )

  const wrapped = cfg.href ? (
    <Link href={cfg.href} aria-label={cfg.tooltip}>
      {badge}
    </Link>
  ) : (
    badge
  )

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>{wrapped}</TooltipTrigger>
        <TooltipContent side="bottom">{cfg.tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
