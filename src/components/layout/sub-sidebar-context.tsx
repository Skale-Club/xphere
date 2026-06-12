'use client'

import * as React from 'react'
import { usePathname } from 'next/navigation'

type SubSidebarMode = 'expanded' | 'collapsed'

interface SubSidebarContextValue {
  mode: SubSidebarMode
  /** True once the initial mode has settled. Used to gate the width transition
   *  so the sidebar doesn't animate on first paint. */
  hydrated: boolean
  collapse: () => void
  expand: () => void
  toggle: () => void
  /** Called by nav links on navigation. No-op kept for API stability (the
   *  hover-to-peek behavior was removed). */
  onNavigate: () => void
}

const SubSidebarContext = React.createContext<SubSidebarContextValue | null>(null)

interface SubSidebarProviderProps {
  children: React.ReactNode
  storageKey: string
  defaultMode?: SubSidebarMode
  /**
   * When set, the expanded/collapsed state follows the route instead of a
   * persisted preference:
   *  - On the section index (nothing open) the sidebar is expanded and only
   *    collapses when the user clicks the collapse button.
   *  - Once an item is open (path is deeper than the base) it collapses to the
   *    slim rail by default.
   * A manual toggle sticks until the next time the "an item is open" state
   * flips (i.e. opening an item or returning to the index).
   */
  autoCollapseBasePath?: string
}

export function SubSidebarProvider({
  children,
  storageKey,
  defaultMode = 'expanded',
  autoCollapseBasePath,
}: SubSidebarProviderProps) {
  const pathname = usePathname()
  const routeDriven = Boolean(autoCollapseBasePath)
  const itemOpen = routeDriven
    ? pathname.startsWith(autoCollapseBasePath + '/')
    : false

  const [mode, setMode] = React.useState<SubSidebarMode>(
    routeDriven ? (itemOpen ? 'collapsed' : 'expanded') : defaultMode,
  )
  const [hydrated, setHydrated] = React.useState(false)

  // Persisted-preference mode (settings): read the stored value after mount.
  // Route-driven mode skips storage entirely. Either way, flip `hydrated` so
  // the consumer can enable transitions without animating the initial state.
  React.useEffect(() => {
    if (routeDriven) {
      setHydrated(true)
      return
    }
    try {
      const stored = localStorage.getItem(storageKey)
      if (stored === 'collapsed' || stored === 'expanded') setMode(stored)
    } catch {}
    setHydrated(true)
  }, [storageKey, routeDriven])

  // Route-driven mode: follow the "an item is open" state. Only fires on an
  // actual transition, so a manual toggle survives until the next navigation
  // that changes openness.
  const prevItemOpen = React.useRef<boolean | null>(null)
  React.useEffect(() => {
    if (!routeDriven) return
    if (prevItemOpen.current === itemOpen) return
    prevItemOpen.current = itemOpen
    setMode(itemOpen ? 'collapsed' : 'expanded')
  }, [routeDriven, itemOpen])

  const persist = React.useCallback(
    (next: SubSidebarMode) => {
      if (routeDriven) return
      try {
        localStorage.setItem(storageKey, next)
      } catch {}
    },
    [storageKey, routeDriven],
  )

  const collapse = React.useCallback(() => {
    setMode('collapsed')
    persist('collapsed')
  }, [persist])

  const expand = React.useCallback(() => {
    setMode('expanded')
    persist('expanded')
  }, [persist])

  const toggle = React.useCallback(() => {
    setMode((prev) => {
      const next = prev === 'expanded' ? 'collapsed' : 'expanded'
      persist(next)
      return next
    })
  }, [persist])

  // On mobile the expanded panel overlays the content, so collapsing it after a
  // nav click reveals the page the user just opened. On md+ it's in-flow and
  // stays put. Matches the `md` breakpoint used by the layout (768px).
  const onNavigate = React.useCallback(() => {
    if (typeof window === 'undefined') return
    if (window.matchMedia('(max-width: 767px)').matches) collapse()
  }, [collapse])

  return (
    <SubSidebarContext.Provider
      value={{ mode, hydrated, collapse, expand, toggle, onNavigate }}
    >
      {children}
    </SubSidebarContext.Provider>
  )
}

export function useSubSidebar() {
  const ctx = React.useContext(SubSidebarContext)
  if (!ctx) throw new Error('useSubSidebar must be used within SubSidebarProvider')
  return ctx
}
