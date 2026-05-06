'use client'

import * as React from 'react'

type OverrideContextValue = {
  setSegmentLabel: (segment: string, label: string) => void
  getSegmentLabel: (segment: string) => string | undefined
}

const BreadcrumbOverrideContext = React.createContext<OverrideContextValue>({
  setSegmentLabel: () => {},
  getSegmentLabel: () => undefined,
})

export function BreadcrumbOverrideProvider({ children }: { children: React.ReactNode }) {
  const [overrides, setOverrides] = React.useState<Record<string, string>>({})

  const value = React.useMemo<OverrideContextValue>(
    () => ({
      setSegmentLabel: (segment, label) =>
        setOverrides((prev) => (prev[segment] === label ? prev : { ...prev, [segment]: label })),
      getSegmentLabel: (segment) => overrides[segment],
    }),
    [overrides],
  )

  return (
    <BreadcrumbOverrideContext.Provider value={value}>
      {children}
    </BreadcrumbOverrideContext.Provider>
  )
}

export function useBreadcrumbOverride() {
  return React.useContext(BreadcrumbOverrideContext)
}
