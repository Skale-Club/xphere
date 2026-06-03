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
}

/**
 * Full-page layout that adds a collapsible secondary sidebar to the left.
 * - `expanded`: 240px column, pushes page content.
 * - `collapsed`: 0px, page content takes full width. A 16px invisible hover
 *   zone on the left triggers the "peek" overlay.
 * - `peek`: sidebar slides in as an absolute overlay without shifting content.
 */
export function SubSidebarLayout({
  nav,
  children,
  storageKey,
  title,
  defaultExpanded = true,
}: SubSidebarLayoutProps) {
  return (
    <SubSidebarProvider
      storageKey={storageKey}
      defaultMode={defaultExpanded ? 'expanded' : 'collapsed'}
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
  const { mode, isPeeking, startPeek, endPeek } = useSubSidebar()
  const isExpanded = mode === 'expanded'
  const showOverlay = !isExpanded && isPeeking

  return (
    <div className="relative flex flex-1 overflow-hidden">
      {/* Hover-zone: thin strip at left edge when collapsed */}
      {!isExpanded && !isPeeking && (
        <div
          className="absolute left-0 top-0 z-30 h-full w-4"
          onMouseEnter={startPeek}
        />
      )}

      {/* Sidebar panel ---------------------------------------------------- */}
      <aside
        className={cn(
          'flex flex-col border-r border-border-subtle bg-bg-secondary/50',
          'transition-[width] duration-[250ms] [transition-timing-function:cubic-bezier(0.2,0,0,1)]',
          'overflow-hidden shrink-0',
          isExpanded ? 'w-[240px]' : 'w-0',
          showOverlay &&
            'absolute left-0 top-0 z-40 h-full w-[240px] shadow-[4px_0_24px_rgba(0,0,0,0.18)]',
        )}
        onMouseLeave={isPeeking ? endPeek : undefined}
        onMouseEnter={isPeeking ? () => {} : undefined}
      >
        {/* Content is always rendered at full width inside the 0-width parent
            so animation doesn't clip the text during transition */}
        <div className="flex h-full w-[240px] flex-col">
          <SubSidebarHeader title={title} />
          <div className="flex-1 overflow-y-auto overflow-x-hidden">{nav}</div>
        </div>
      </aside>

      {/* Main content ----------------------------------------------------- */}
      <div className="flex min-w-0 flex-1 flex-col overflow-auto">{children}</div>
    </div>
  )
}

// ─── Header strip ─────────────────────────────────────────────────────────────

function SubSidebarHeader({ title }: { title?: string }) {
  const { mode, collapse, expand, isPeeking } = useSubSidebar()
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
        aria-label={isExpanded ? 'Collapse sidebar' : 'Pin sidebar'}
        title={isExpanded ? 'Collapse (click to hide)' : 'Pin open'}
      >
        {isExpanded || isPeeking ? (
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
