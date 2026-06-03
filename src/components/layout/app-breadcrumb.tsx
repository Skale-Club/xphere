'use client'

import * as React from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { LayoutDashboard } from 'lucide-react'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { useBreadcrumbOverride } from './breadcrumb-override-context'
import { findNavItemForPath } from './nav-items'

// Acronyms and proper nouns that must not be auto-cased by toTitleCase.
const SEGMENT_LABELS: Record<string, string> = {
  mcp: 'MCP Server',
  sms: 'SMS',
  api: 'API',
}

function toTitleCase(str: string) {
  if (SEGMENT_LABELS[str.toLowerCase()]) return SEGMENT_LABELS[str.toLowerCase()]
  return str
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

export function AppBreadcrumb() {
  const pathname = usePathname()
  const rawSegments = pathname.split('/').filter(Boolean)
  const segments = rawSegments
    .map((segment, index) => ({ segment, rawIndex: index }))
    .filter(({ segment, rawIndex }) => !(rawSegments[0] === 'workflows' && rawSegments[1] === 'flows' && rawIndex === 1))
  const { getSegmentLabel, getSegmentNode, suffix } = useBreadcrumbOverride()

  // Match the top-level path segment to a sidebar nav item so the icon
  // shown in the header is the same as the icon highlighted in the sidebar.
  const navItem = findNavItemForPath(pathname)
  const Icon = navItem?.icon ?? LayoutDashboard

  if (segments.length === 0) {
    return (
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-text-secondary" />
            <BreadcrumbPage>Dashboard</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    )
  }

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {segments.map(({ segment, rawIndex }, index) => {
          const isLast = index === segments.length - 1
          const href = `/${rawSegments.slice(0, rawIndex + 1).join('/')}`
          const isFirst = index === 0

          return (
            <React.Fragment key={href}>
              {index > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem className={isFirst ? 'flex items-center gap-2' : undefined}>
                {isFirst && <Icon className="h-4 w-4 text-text-secondary shrink-0" />}
                {isLast ? (
                  <BreadcrumbPage className="flex items-center gap-2">
                    {getSegmentNode(segment) ?? getSegmentLabel(segment) ?? toTitleCase(segment)}
                    {suffix}
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link href={href}>{getSegmentLabel(segment) ?? toTitleCase(segment)}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </React.Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
