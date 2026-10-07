import 'server-only'

import { cache } from 'react'

import { isBillingEnforced } from '@/lib/billing/config'
import { getEntitlements } from '@/lib/billing/entitlements'
import { getMyPermissions } from '@/lib/rbac/server'
import { visibleSeoSections } from './sections'

/** The SEO tabs this user can reach in the active org, resolved once per request. */
export const getSeoSections = cache(async () => {
  const [permissions, entitlements] = await Promise.all([
    // Fail open like the sidebar: the per-tab gates and RLS still guard data.
    getMyPermissions().catch(() => null),
    isBillingEnforced() ? getEntitlements() : Promise.resolve(null),
  ])
  return visibleSeoSections(permissions, entitlements ? entitlements.features : null)
})
