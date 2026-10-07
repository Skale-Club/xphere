'use client'

import * as React from 'react'

import { useBreadcrumbOverride } from './breadcrumb-override-context'

/**
 * Shows `label` in the header breadcrumb in place of a route segment (usually
 * an id), from a server layout or page that already knows the name.
 */
export function BreadcrumbLabel({ segment, label }: { segment: string; label: string }) {
  const { setSegmentLabel } = useBreadcrumbOverride()
  React.useEffect(() => {
    setSegmentLabel(segment, label)
  }, [segment, label, setSegmentLabel])
  return null
}
