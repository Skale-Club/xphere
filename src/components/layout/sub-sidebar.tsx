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
      <SubSidebarLayoutInner nav={nav} title={title} expandedWidth={expandedWidth}>
        {children}
      </SubSidebarLayoutInner>
    </SubSidebarProvider>
  )
}

// ─── Inner layout (reads context) ────────────────────────────────────────────

function SubSidebarLayoutInner({
  nav,
  title,
  expandedWidth,
  children,
}: {
  nav: React.ReactNode
  title?: string
  expandedWidth: number
  children: React.ReactNode
}) {
  const { mode, hydrated, expand } = useSubSidebar()
  const isExpanded = mode === 'expanded'

  return (
    <div className="relative flex h-full overflow-hidden">
      {/* Sidebar: full panel when expanded, slim rail when collapsed. The width
          transition is only enabled after hydration so it doesn't animate the
          initial state on page load. */}
      <aside
        className={cn(
          'relative z-20 flex shrink-0 flex-col overflow-hidden border-r border-border-subtle bg-bg-secondary/50',
          hydrated &&
            'transition-[width] duration-[250ms] [transition-timing-function:cubic-bezier(0.2,0,0,1)]',
          !isExpanded && 'w-10',
        )}
        style={isExpanded ? { width: expandedWidth } : undefined}
      >
        {isExpanded ? (
          <div className="flex h-full flex-col" style={{ width: expandedWidth }}>
            <SubSidebarHeader title={title} />
            <div className="flex min-h-0 flex-1 flex-col overflow-x-hidden">{nav}</div>
          </div>
        ) : (
          <CollapsedRail onExpand={expand} />
        )}
      </aside>

      {/* Main content ----------------------------------------------------- */}
      <div className="flex min-w-0 flex-1 flex-col overflow-auto">{children}</div>
    </div>
  )
}

// ─── Collapsed rail ───────────────────────────────────────────────────────────

function CollapsedRail({ onExpand }: { onExpand: () => void }) {
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
