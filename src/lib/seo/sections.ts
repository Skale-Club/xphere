import type { Feature } from '@/lib/billing/catalog'

/**
 * The tabs of the SEO area. Website audits, Local SEO and Reviews are separate
 * billing features with separate permission sets, so each tab is gated on its
 * own pair; the sidebar shows "SEO" when any tab is reachable.
 */
export type SeoSection = {
  key: 'website' | 'local' | 'reviews' | 'reports'
  label: string
  href: string
  permission: string
  /** Label of `permission` in Settings → Roles, quoted on the no-access card. */
  permissionLabel: string
  feature: Feature
}

export const SEO_SECTIONS: readonly SeoSection[] = [
  { key: 'website', label: 'Website', href: '/seo/website', permission: 'seo.view', permissionLabel: 'View SEO audits', feature: 'seo' },
  { key: 'local', label: 'Local', href: '/seo/local', permission: 'local_seo.view', permissionLabel: 'View rankings, competitors & reports', feature: 'local_seo' },
  { key: 'reviews', label: 'Reviews', href: '/seo/reviews', permission: 'reviews.view', permissionLabel: 'View reviews', feature: 'reviews' },
  { key: 'reports', label: 'Reports', href: '/seo/reports', permission: 'local_seo.view', permissionLabel: 'View rankings, competitors & reports', feature: 'local_seo' },
]

/**
 * Tabs the user may open. `null` means unrestricted, with the same meaning the
 * sidebar gives it: no RBAC restriction / billing enforcement off.
 */
export function visibleSeoSections(
  permissions: readonly string[] | null,
  features: readonly string[] | null,
): SeoSection[] {
  return SEO_SECTIONS.filter(
    (s) => (permissions == null || permissions.includes(s.permission)) && (features == null || features.includes(s.feature)),
  )
}
