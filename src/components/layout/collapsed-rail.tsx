'use client'

import * as React from 'react'
import { PanelLeftOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

/**
 * Width shared by every collapsed rail in the app (sub-sidebars, the email
 * block palette, the email inspector panel). Phase 7 (email-builder
 * hardening) found the three collapse implementations had drifted to
 * different widths (w-10 vs w-9) — import this instead of hardcoding a
 * value so they can't drift again.
 */
export const COLLAPSED_RAIL_WIDTH = 'w-10'

interface CollapsedRailProps {
  /** Expands the rail. CollapsedRail owns the toggle button itself (icon,
   *  size, color, hover state) — callers only supply the handler. */
  onToggle: () => void
  /** Accessible label (and tooltip) for the toggle button, e.g. "Expand
   *  sidebar" / "Expand blocks panel". Defaults to a generic label. */
  ariaLabelExpand?: string
  /** Optional compact action buttons/chips rendered below a divider. */
  actions?: React.ReactNode
  className?: string
}

/**
 * Shared geometry AND toggle button for every collapsed rail in the app.
 *
 * Phase 7 standardized the geometry (width, padding, actions-area scroll
 * behavior) but still let each caller bring its own toggle button — that
 * left the button's icon/size/color free to drift between rails (h-6 vs h-7
 * buttons, h-3.5 vs h-4 icons, `text-muted-foreground` vs `text-text-tertiary`).
 * A Phase 7 visual-QA follow-up found exactly that: the three rails
 * (sub-sidebar, email block palette, email inspector panel) rendered visibly
 * different toggle buttons. CollapsedRail now owns the toggle outright —
 * callers pass `onToggle` + a label, nothing else — so there is exactly one
 * place that can define its appearance.
 *
 * `h-full` here is load-bearing for height parity with the expanded panel —
 * see the comment on `SubSidebarLayoutInner`'s `aside` for the ancestor
 * chain that makes this a definite height, not an intrinsic/content one.
 *
 * Each call site still owns its own `<aside>` (width, border, background,
 * positioning) — this only standardizes what goes INSIDE it, so the three
 * independent collapsed rails read as one visual system instead of three
 * drifted implementations.
 */
export function CollapsedRail({
  onToggle,
  ariaLabelExpand = 'Expand panel',
  actions,
  className,
}: CollapsedRailProps) {
  return (
    <div className={cn('flex h-full flex-col items-center py-2', COLLAPSED_RAIL_WIDTH, className)}>
      <Button
        variant="ghost"
        size="icon-sm"
        className="h-7 w-7 text-text-tertiary hover:text-text-primary"
        onClick={onToggle}
        aria-label={ariaLabelExpand}
        title={ariaLabelExpand}
      >
        <PanelLeftOpen className="h-4 w-4" />
      </Button>
      {actions && (
        <div className="mt-3 flex min-h-0 flex-1 flex-col items-center gap-1.5 overflow-y-auto border-t border-border-subtle pt-3">
          {actions}
        </div>
      )}
    </div>
  )
}
