'use client'

import * as React from 'react'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { SubSidebarProvider, useSubSidebar } from './sub-sidebar-context'

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

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
  /** Narrowest the sidebar can be dragged to; past this it collapses. */
  minWidth?: number
  /** Widest the sidebar can be dragged to. */
  maxWidth?: number
  /** When set, expanded/collapsed follows the route: expanded on the section
   *  index, collapsed once an item is open. See provider. */
  autoCollapseBasePath?: string
}

/**
 * Full-page layout that adds a collapsible secondary sidebar to the left.
 * - `expanded`: resizable column (drag the right edge, clamped to
 *   [minWidth, maxWidth]; dragging past minWidth collapses it instead).
 * - `collapsed`: a slim 40px rail with a button to expand it again.
 * Expand/collapse is otherwise button-driven only (no hover behavior).
 */
export function SubSidebarLayout({
  nav,
  collapsedActions,
  children,
  storageKey,
  title,
  defaultExpanded = true,
  expandedWidth = 240,
  minWidth = 160,
  maxWidth = 420,
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
        minWidth={minWidth}
        maxWidth={maxWidth}
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
  minWidth,
  maxWidth,
  children,
}: {
  nav: React.ReactNode
  collapsedActions?: React.ReactNode
  title?: string
  expandedWidth: number
  minWidth: number
  maxWidth: number
  children: React.ReactNode
}) {
  const { mode, hydrated, expand, collapse } = useSubSidebar()
  const isExpanded = mode === 'expanded'

  const [width, setWidth] = React.useState(expandedWidth)
  const [isResizing, setIsResizing] = React.useState(false)

  const handleResizeStart = React.useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault()

      const startX = event.clientX
      const startWidth = width
      const previousCursor = document.body.style.cursor
      const previousUserSelect = document.body.style.userSelect

      setIsResizing(true)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const handleMove = (moveEvent: PointerEvent) => {
        const nextWidth = startWidth + moveEvent.clientX - startX
        // Dragging past the floor collapses the panel instead of stopping at
        // minWidth — mirrors a rail you can shrink until it tucks away.
        if (nextWidth < minWidth) {
          handleUp()
          collapse()
          return
        }
        setWidth(Math.min(nextWidth, maxWidth))
      }

      const handleUp = () => {
        setIsResizing(false)
        document.body.style.cursor = previousCursor
        document.body.style.userSelect = previousUserSelect
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleUp)
      }

      window.addEventListener('pointermove', handleMove)
      window.addEventListener('pointerup', handleUp)
    },
    [width, minWidth, maxWidth, collapse],
  )

  const handleResizeKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      const delta = event.key === 'ArrowLeft' ? -16 : 16
      setWidth((current) => clamp(current + delta, minWidth, maxWidth))
    },
    [minWidth, maxWidth],
  )

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
          initial state on page load, and suspended while actively dragging so
          the edge tracks the pointer instead of easing behind it. On mobile the
          expanded panel is absolutely positioned so it floats over the content;
          from md up it returns to the normal flow and pushes the content. */}
      <aside
        className={cn(
          'z-30 flex shrink-0 flex-col overflow-hidden border-r border-border-subtle md:relative md:z-20',
          hydrated &&
            !isResizing &&
            'transition-[width] duration-[250ms] [transition-timing-function:cubic-bezier(0.2,0,0,1)]',
          !isExpanded && 'relative w-10 bg-bg-secondary/50',
          // Expanded: solid bg + overlay on mobile, translucent + in-flow on md+.
          isExpanded && 'absolute inset-y-0 left-0 bg-bg-secondary md:bg-bg-secondary/50',
        )}
        style={isExpanded ? { width } : undefined}
      >
        {isExpanded ? (
          <div className="flex h-full flex-col" style={{ width }}>
            <SubSidebarHeader title={title} />
            <div className="flex min-h-0 flex-1 flex-col overflow-x-hidden">{nav}</div>
          </div>
        ) : (
          <CollapsedRail onExpand={expand} actions={collapsedActions} />
        )}
      </aside>

      {/* Resize handle: desktop-only, expanded-only. A slim hit target that
          overlaps the sidebar's own border-r (via -ml-px) so it reads as part
          of the seam until hovered/focused. */}
      {isExpanded && (
        <button
          type="button"
          aria-label="Resize sidebar"
          title="Resize sidebar"
          onPointerDown={handleResizeStart}
          onKeyDown={handleResizeKeyDown}
          className="group relative z-20 hidden h-full w-1 -ml-px shrink-0 cursor-col-resize touch-none md:block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <span className="absolute inset-y-0 left-0 w-px bg-transparent transition-colors group-hover:bg-accent/70 group-focus-visible:bg-accent" />
        </button>
      )}

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
        <div className="mt-3 flex min-h-0 flex-1 flex-col items-center gap-1.5 overflow-y-auto border-t border-border-subtle pt-3">
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
