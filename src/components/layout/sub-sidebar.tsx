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
  /** Compact action buttons rendered in the collapsed rail. */
  collapsedActions?: React.ReactNode
  /** The main page content. */
  children: React.ReactNode
  /** localStorage key used to persist expanded/collapsed state. */
  storageKey: string
  /** Optional title shown in the sidebar header. */
  title?: string
  defaultExpanded?: boolean
  /** Expanded sidebar width in pixels. */
  expandedWidth?: number
  /** When set, expanded/collapsed follows the route: expanded on the section
   *  index, collapsed once an item is open. See provider. */
  autoCollapseBasePath?: string
}

/**
 * Full-page layout that adds a collapsible secondary sidebar to the left.
 * - `expanded`: 240px column, pushes page content.
 * - `collapsed`: a slim 40px rail with a button to expand it again.
 * Expand/collapse is button-driven only (no hover behavior).
 */
export function SubSidebarLayout({
  nav,
  collapsedActions,
  children,
  storageKey,
  title,
  defaultExpanded = true,
  expandedWidth = 240,
  autoCollapseBasePath,
}: SubSidebarLayoutProps) {
  return (
    <SubSidebarProvider
      storageKey={storageKey}
      defaultMode={defaultExpanded ? 'expanded' : 'collapsed'}
      autoCollapseBasePath={autoCollapseBasePath}
    >
      <SubSidebarLayoutInner
        nav={nav}
        collapsedActions={collapsedActions}
        title={title}
        expandedWidth={expandedWidth}
      >
        {children}
      </SubSidebarLayoutInner>
    </SubSidebarProvider>
  )
}

// ─── Inner layout (reads context) ────────────────────────────────────────────

function SubSidebarLayoutInner({
  nav,
  collapsedActions,
  title,
  expandedWidth,
  children,
}: {
  nav: React.ReactNode
  collapsedActions?: React.ReactNode
  title?: string
  expandedWidth: number
  children: React.ReactNode
}) {
  const { mode, hydrated, expand, collapse } = useSubSidebar()
  const isExpanded = mode === 'expanded'

  return (
    <div className="relative flex h-full overflow-hidden">
      {/* Backdrop scrim: only on mobile while the panel is expanded. On small
          screens the expanded panel overlays the content (see `aside` below)
          instead of squeezing it, so we dim + cover the content and let a tap
          collapse the panel. Hidden from md up where the panel is in-flow. */}
      {isExpanded && (
        <button
          type="button"
          aria-label="Collapse sidebar"
          onClick={collapse}
          className="absolute inset-0 z-20 bg-black/40 md:hidden"
        />
      )}

      {/* Sidebar: full panel when expanded, slim rail when collapsed. The width
          transition is only enabled after hydration so it doesn't animate the
          initial state on page load. On mobile the expanded panel is absolutely
          positioned so it floats over the content; from md up it returns to the
          normal flow and pushes the content. */}
      <aside
        className={cn(
          'z-30 flex shrink-0 flex-col overflow-hidden border-r border-border-subtle md:relative md:z-20',
          hydrated &&
            'transition-[width] duration-[250ms] [transition-timing-function:cubic-bezier(0.2,0,0,1)]',
          !isExpanded && 'relative w-10 bg-bg-secondary/50',
          // Expanded: solid bg + overlay on mobile, translucent + in-flow on md+.
          isExpanded && 'absolute inset-y-0 left-0 bg-bg-secondary md:bg-bg-secondary/50',
        )}
        style={isExpanded ? { width: expandedWidth } : undefined}
      >
        {isExpanded ? (
          <div className="flex h-full flex-col" style={{ width: expandedWidth }}>
            <SubSidebarHeader title={title} />
            <div className="flex min-h-0 flex-1 flex-col overflow-x-hidden">{nav}</div>
          </div>
        ) : (
          <CollapsedRail onExpand={expand} actions={collapsedActions} />
        )}
      </aside>

      {/* Main content ----------------------------------------------------- */}
      <div className="flex min-w-0 flex-1 flex-col overflow-auto">{children}</div>
    </div>
  )
}

// ─── Collapsed rail ───────────────────────────────────────────────────────────

function CollapsedRail({
  onExpand,
  actions,
}: {
  onExpand: () => void
  actions?: React.ReactNode
}) {
  return (
    <div className="flex h-full w-10 flex-col items-center py-2">
      <Button
        variant="ghost"
        size="icon-sm"
        className="h-7 w-7 text-text-tertiary hover:text-text-primary"
        onClick={onExpand}
        aria-label="Expand sidebar"
        title="Expand sidebar"
      >
        <PanelLeftOpen className="h-4 w-4" />
      </Button>
      {actions && (
        <div className="mt-3 flex flex-col items-center gap-1.5 border-t border-border-subtle pt-3">
          {actions}
        </div>
      )}
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
        aria-label={isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
        title={isExpanded ? 'Collapse' : 'Expand'}
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
