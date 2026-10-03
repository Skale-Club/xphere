'use client'

import { usePathname as useNextPathname } from 'next/navigation'

import { stripOrgPrefix } from '@/lib/org/request-org'

/**
 * `usePathname()` without the per-tab `/o/<org-id>` prefix, so route checks
 * (active nav item, section roots, breadcrumbs) see the real route. Also keeps
 * server and client renders identical: the server renders the rewritten route
 * while the browser's URL still carries the prefix. Use this instead of the
 * `next/navigation` export anywhere under the dashboard.
 */
export function usePathname(): string {
  return stripOrgPrefix(useNextPathname() ?? '/')
}
