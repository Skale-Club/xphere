'use client'

import * as React from 'react'

interface SidebarStateValue {
  collapsed: boolean
  toggle: () => void
  setCollapsed: (v: boolean) => void
  mobileOpen: boolean
  setMobileOpen: (v: boolean) => void
}

const SidebarContext = React.createContext<SidebarStateValue | null>(null)

const STORAGE_KEY = 'operator:sidebar:collapsed'

export function SidebarStateProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsedState] = React.useState(false)
  const [mobileOpen, setMobileOpen] = React.useState(false)

  // Hydrate from localStorage on mount. If the user has never set a
  // preference on this device, default to collapsed on mobile (<1024px)
  // and expanded on desktop. The choice still persists on toggle.
  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      if (stored !== null) {
        setCollapsedState(stored === '1')
      } else if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) {
        setCollapsedState(true)
      }
    } catch {}
  }, [])

  const setCollapsed = React.useCallback((v: boolean) => {
    setCollapsedState(v)
    try {
      window.localStorage.setItem(STORAGE_KEY, v ? '1' : '0')
    } catch {}
  }, [])

  const toggle = React.useCallback(() => {
    setCollapsedState((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
      } catch {}
      return next
    })
  }, [])

  // Cmd/Ctrl+B keyboard shortcut
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

  return (
    <SidebarContext.Provider value={{ collapsed, toggle, setCollapsed, mobileOpen, setMobileOpen }}>
      {children}
    </SidebarContext.Provider>
  )
}

export function useSidebarState() {
  const ctx = React.useContext(SidebarContext)
  if (!ctx) throw new Error('useSidebarState must be used within SidebarStateProvider')
  return ctx
}

export { SidebarContext }
