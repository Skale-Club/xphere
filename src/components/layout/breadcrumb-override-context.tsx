'use client'

import * as React from 'react'

type OverrideContextValue = {
  setSegmentLabel: (segment: string, label: string) => void
  getSegmentLabel: (segment: string) => string | undefined
  /** Replace the rendered text of the last breadcrumb segment with arbitrary JSX. */
  setSegmentNode: (segment: string, node: React.ReactNode) => void
  getSegmentNode: (segment: string) => React.ReactNode | undefined
  /** Optional node rendered inline after the last breadcrumb segment. */
  suffix: React.ReactNode
  setSuffix: (node: React.ReactNode) => void
}

const BreadcrumbOverrideContext = React.createContext<OverrideContextValue>({
  setSegmentLabel: () => {},
  getSegmentLabel: () => undefined,
  setSegmentNode: () => {},
  getSegmentNode: () => undefined,
  suffix: null,
  setSuffix: () => {},
})

export function BreadcrumbOverrideProvider({ children }: { children: React.ReactNode }) {
  const [overrides, setOverrides] = React.useState<Record<string, string>>({})
  const [nodes, setNodes] = React.useState<Record<string, React.ReactNode>>({})
  const [suffix, setSuffix] = React.useState<React.ReactNode>(null)

  // Stable refs — these setters never change identity so they can safely appear
  // in useEffect dependency arrays without causing infinite re-render loops.
  const setSegmentLabel = React.useCallback((segment: string, label: string) =>
    setOverrides((prev) => (prev[segment] === label ? prev : { ...prev, [segment]: label })),
  [])
  const setSegmentNode = React.useCallback((segment: string, node: React.ReactNode) =>
    setNodes((prev) => (prev[segment] === node ? prev : { ...prev, [segment]: node })),
  [])

  const value = React.useMemo<OverrideContextValue>(
    () => ({
      setSegmentLabel,
      getSegmentLabel: (segment) => overrides[segment],
      setSegmentNode,
      getSegmentNode: (segment) => nodes[segment],
      suffix,
      setSuffix,
    }),
    [setSegmentLabel, setSegmentNode, overrides, nodes, suffix],
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
