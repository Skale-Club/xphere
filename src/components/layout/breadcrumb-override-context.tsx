'use client'

import * as React from 'react'

type OverrideContextValue = {
  setSegmentLabel: (segment: string, label: string) => void
  getSegmentLabel: (segment: string) => string | undefined
  /** Optional node rendered inline after the last breadcrumb segment. */
  suffix: React.ReactNode
  setSuffix: (node: React.ReactNode) => void
}

const BreadcrumbOverrideContext = React.createContext<OverrideContextValue>({
  setSegmentLabel: () => {},
  getSegmentLabel: () => undefined,
  suffix: null,
  setSuffix: () => {},
})

export function BreadcrumbOverrideProvider({ children }: { children: React.ReactNode }) {
  const [overrides, setOverrides] = React.useState<Record<string, string>>({})
  const [suffix, setSuffix] = React.useState<React.ReactNode>(null)

  const value = React.useMemo<OverrideContextValue>(
    () => ({
      setSegmentLabel: (segment, label) =>
        setOverrides((prev) => (prev[segment] === label ? prev : { ...prev, [segment]: label })),
      getSegmentLabel: (segment) => overrides[segment],
      suffix,
      setSuffix,
    }),
    [overrides, suffix],
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
