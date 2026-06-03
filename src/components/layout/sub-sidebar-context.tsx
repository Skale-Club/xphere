'use client'

import * as React from 'react'

type SubSidebarMode = 'expanded' | 'collapsed'

interface SubSidebarContextValue {
  mode: SubSidebarMode
  isPeeking: boolean
  collapse: () => void
  expand: () => void
  toggle: () => void
  startPeek: () => void
  endPeek: () => void
}

const SubSidebarContext = React.createContext<SubSidebarContextValue | null>(null)

interface SubSidebarProviderProps {
  children: React.ReactNode
  storageKey: string
  defaultMode?: SubSidebarMode
}

export function SubSidebarProvider({
  children,
  storageKey,
  defaultMode = 'expanded',
}: SubSidebarProviderProps) {
  const [mode, setMode] = React.useState<SubSidebarMode>(defaultMode)
  const [isPeeking, setIsPeeking] = React.useState(false)
  const peekTimeout = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey)
      if (stored === 'collapsed' || stored === 'expanded') setMode(stored)
    } catch {}
  }, [storageKey])

  const persist = React.useCallback(
    (next: SubSidebarMode) => {
      try {
        localStorage.setItem(storageKey, next)
      } catch {}
    },
    [storageKey],
  )

  const collapse = React.useCallback(() => {
    setMode('collapsed')
    setIsPeeking(false)
    if (peekTimeout.current) clearTimeout(peekTimeout.current)
    persist('collapsed')
  }, [persist])

  const expand = React.useCallback(() => {
    setMode('expanded')
    setIsPeeking(false)
    if (peekTimeout.current) clearTimeout(peekTimeout.current)
    persist('expanded')
  }, [persist])

  const toggle = React.useCallback(() => {
    setMode((prev) => {
      const next = prev === 'expanded' ? 'collapsed' : 'expanded'
      setIsPeeking(false)
      persist(next)
      return next
    })
  }, [persist])

  const startPeek = React.useCallback(() => {
    if (peekTimeout.current) clearTimeout(peekTimeout.current)
    setIsPeeking(true)
  }, [])

  const endPeek = React.useCallback(() => {
    peekTimeout.current = setTimeout(() => setIsPeeking(false), 220)
  }, [])

  React.useEffect(
    () => () => {
      if (peekTimeout.current) clearTimeout(peekTimeout.current)
    },
    [],
  )

  return (
    <SubSidebarContext.Provider
      value={{ mode, isPeeking, collapse, expand, toggle, startPeek, endPeek }}
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
