'use client'

import * as React from 'react'
import { ConfettiBurst } from './confetti-burst'

interface CelebrationContextValue {
  /** Fire a confetti burst. Optional accent color array. */
  celebrate: (opts?: { colors?: string[] }) => void
}

const CelebrationContext = React.createContext<CelebrationContextValue | null>(null)

/**
 * Mount once near the dashboard root. Any descendant can call
 * `useCelebrate()` to fire a 3s confetti burst — used for deal-won
 * moments and other "this is worth celebrating" interactions.
 */
export function CelebrationProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = React.useState(false)
  const [colors, setColors] = React.useState<string[] | undefined>(undefined)

  const celebrate = React.useCallback((opts?: { colors?: string[] }) => {
    setColors(opts?.colors)
    setActive(true)
  }, [])

  const value = React.useMemo(() => ({ celebrate }), [celebrate])

  return (
    <CelebrationContext.Provider value={value}>
      {children}
      <ConfettiBurst active={active} colors={colors} onComplete={() => setActive(false)} />
    </CelebrationContext.Provider>
  )
}

export function useCelebrate(): (opts?: { colors?: string[] }) => void {
  const ctx = React.useContext(CelebrationContext)
  // Safe fallback when provider isn't mounted (e.g., login page).
  return ctx?.celebrate ?? (() => {})
}
