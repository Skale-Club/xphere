'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Width shared by every collapsed rail in the app (sub-sidebars, the email
 * block palette, the email inspector panel). Phase 7 (email-builder
 * hardening) found the three collapse implementations had drifted to
 * different widths (w-10 vs w-9) — import this instead of hardcoding a
 * value so they can't drift again.
 */
export const COLLAPSED_RAIL_WIDTH = 'w-10'

interface CollapsedRailProps {
  /** The expand/toggle button, rendered at the top of the rail. */
  toggle: React.ReactNode
  /** Optional compact action buttons/chips rendered below a divider. */
  children?: React.ReactNode
  className?: string
}

/**
 * Shared geometry for a collapsed rail's INSIDE: fixed width, identical top
 * padding, a toggle slot, and an optional scrollable actions area below a
 * divider (border pattern lifted from the original `sub-sidebar.tsx`
 * `CollapsedRail`). `h-full` here is load-bearing for height parity with
 * the expanded panel — see the comment on `SubSidebarLayoutInner`'s `aside`
 * for the ancestor chain that makes this a definite height, not an
 * intrinsic/content one.
 *
 * Each call site still owns its own `<aside>` (width, border, background,
 * positioning) — this only standardizes what goes INSIDE it, so the three
 * independent collapsed rails (sub-sidebar, block palette, inspector panel)
 * read as one visual system instead of three drifted implementations.
 */
export function CollapsedRail({ toggle, children, className }: CollapsedRailProps) {
  return (
    <div className={cn('flex h-full flex-col items-center py-2', COLLAPSED_RAIL_WIDTH, className)}>
      {toggle}
      {children && (
        <div className="mt-3 flex min-h-0 flex-1 flex-col items-center gap-1.5 overflow-y-auto border-t border-border-subtle pt-3">
          {children}
        </div>
      )}
    </div>
  )
}
