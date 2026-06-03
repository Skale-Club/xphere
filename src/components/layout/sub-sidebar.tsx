'use client'

import * as React from 'react'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { SubSidebarProvider, useSubSidebar } from './sub-sidebar-context'

// ─── Public layout wrapper ────────────────────────────────────────────────────

interface SubSidebarLayoutProps {
  /** The nav/tree content rendered inside the sidebar panel. */
  nav: React.ReactNode
  /** The main page content. */
  children: React.ReactNode
  /** localStorage key used to persist expanded/collapsed state. */
  storageKey: string
  /** Optional title shown in the sidebar header. */
  title?: string
  defaultExpanded?: boolean
  /** When set, expanded/collapsed follows the route: expanded on the section
   *  index, collapsed (peek on hover) once an item is open. See provider. */
  autoCollapseBasePath?: string
}

/**
 * Full-page layout that adds a collapsible secondary sidebar to the left.
 * - `expanded`: 240px column, pushes page content.
 * - `collapsed`: a slim 40px rail with a visible "expand" button. Hovering the
 *   rail triggers the "peek" overlay.
 * - `peek`: the full sidebar slides in as an absolute overlay on top of the
 *   rail, without shifting the page content.
 */
export function SubSidebarLayout({
  nav,
  children,
  storageKey,
  title,
  defaultExpanded = true,
  autoCollapseBasePath,
}: SubSidebarLayoutProps) {
  return (
    <SubSidebarProvider
      storageKey={storageKey}
      defaultMode={defaultExpanded ? 'expanded' : 'collapsed'}
      autoCollapseBasePath={autoCollapseBasePath}
    >
      <SubSidebarLayoutInner nav={nav} title={title}>
        {children}
      </SubSidebarLayoutInner>
    </SubSidebarProvider>
  )
}

// ─── Inner layout (reads context) ────────────────────────────────────────────

function SubSidebarLayoutInner({
  nav,
  title,
  children,
}: {
  nav: React.ReactNode
  title?: string
  children: React.ReactNode
}) {
  const { mode, isPeeking, hydrated, startPeek, endPeek, expand } = useSubSidebar()
  const isExpanded = mode === 'expanded'
  const showOverlay = !isExpanded && isPeeking

  const panelInner = (
    <div className="flex h-full w-[240px] flex-col">
      <SubSidebarHeader title={title} />
      <div className="flex min-h-0 flex-1 flex-col overflow-x-hidden">{nav}</div>
    </div>
  )

  return (
    <div className="relative flex h-full overflow-hidden">
      {/* In-flow panel: full when expanded, slim rail when collapsed. The width
          transition is only enabled after hydration so it doesn't animate the
          initial collapsed/expanded state on page load. */}
      <aside
        className={cn(
          'relative z-20 flex shrink-0 flex-col overflow-hidden border-r border-border-subtle bg-bg-secondary/50',
          hydrated &&
            'transition-[width] duration-[250ms] [transition-timing-function:cubic-bezier(0.2,0,0,1)]',
          isExpanded ? 'w-[240px]' : 'w-10',
        )}
      >
        {isExpanded ? panelInner : <CollapsedRail onExpand={expand} onPeek={startPeek} />}
      </aside>

      {/* Peek overlay: rendered above the rail and page content, so it never
          shifts the layout. Hovering keeps it open; leaving dismisses it. */}
      {showOverlay && (
        <aside
          className="absolute left-0 top-0 z-40 flex h-full w-[240px] flex-col border-r border-border-subtle bg-bg-secondary shadow-[4px_0_24px_rgba(0,0,0,0.18)]"
          onMouseEnter={startPeek}
          onMouseLeave={endPeek}
        >
          {panelInner}
        </aside>
      )}

      {/* Main content ----------------------------------------------------- */}
      <div className="flex min-w-0 flex-1 flex-col overflow-auto">{children}</div>
    </div>
  )
}

// ─── Collapsed rail ───────────────────────────────────────────────────────────

function CollapsedRail({
  onExpand,
  onPeek,
}: {
  onExpand: () => void
  onPeek: () => void
}) {
  return (
    <div className="flex h-full w-10 flex-col items-center py-2">
      {/* Expand button — peek is intentionally NOT triggered here, so the button
          stays clickable instead of the overlay sliding in over it. */}
      <Button
        variant="ghost"
        size="icon-sm"
        className="h-7 w-7 shrink-0 text-text-tertiary hover:text-text-primary"
        onClick={onExpand}
        aria-label="Expand sidebar"
        title="Expand sidebar (hover below to peek)"
      >
        <PanelLeftOpen className="h-4 w-4" />
      </Button>

      {/* Inactive buffer below the button so an approaching cursor has room to
          reach the button without tripping the peek overlay. */}
      <div className="h-16 w-full shrink-0" />

      {/* The rest of the rail is the hover-to-peek zone. */}
      <div className="w-full flex-1" onMouseEnter={onPeek} />
    </div>
  )
}

// ─── Header strip ─────────────────────────────────────────────────────────────

function SubSidebarHeader({ title }: { title?: string }) {
  const { mode, collapse, expand } = useSubSidebar()
  const isExpanded = mode === 'expanded'

  return (
    <div className="flex h-10 shrink-0 items-center justify-between border-b border-border-subtle px-3">
      {title && (
        <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
          {title}
        </span>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        className="ml-auto h-6 w-6 shrink-0 text-text-tertiary hover:text-text-primary"
        onClick={isExpanded ? collapse : expand}
        aria-label={isExpanded ? 'Collapse sidebar' : 'Pin sidebar open'}
        title={isExpanded ? 'Collapse (click to hide)' : 'Pin open'}
      >
        {isExpanded ? (
          <PanelLeftClose className="h-3.5 w-3.5" />
        ) : (
          <PanelLeftOpen className="h-3.5 w-3.5" />
        )}
      </Button>
    </div>
  )
}

// ─── Re-export context hook for nav components ────────────────────────────────

export { useSubSidebar } from './sub-sidebar-context'
