'use client'

/**
 * Client context that tells phone-display UI whether the floating dial-pad
 * is usable in the current org. Populated once at the dashboard layout
 * from the server-side `isDialpadAvailable()` check.
 *
 * Default value is `false` so any phone displayed outside the provider
 * (auth pages, marketing pages) falls back to a `tel:` link.
 */

import * as React from 'react'

const DialpadAvailabilityContext = React.createContext<boolean>(false)

export function DialpadAvailabilityProvider({
  available,
  children,
}: {
  available: boolean
  children: React.ReactNode
}) {
  return (
    <DialpadAvailabilityContext.Provider value={available}>
      {children}
    </DialpadAvailabilityContext.Provider>
  )
}

export function useDialpadAvailable(): boolean {
  return React.useContext(DialpadAvailabilityContext)
}
