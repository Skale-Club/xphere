// src/lib/medusa/regions.ts
// Country -> region resolution for the Medusa Store API, used when no
// region_id is pinned on the conversation yet. Verified against stuscle's
// storefront `regions.ts` (region.countries[].iso_2 matching).

import { medusaStoreFetch, type MedusaCredentials } from './client'

// resolveRegion returns BOTH the region id AND a fallback country (pinned, or
// the resolved region's first country) — used by the product-card emit
// (137, contract §6) to build a storefront-relative url even when no
// country_code is pinned on the conversation yet (guest browsing).
// resolveRegionId delegates to it, keeping its own signature/behavior
// byte-identical for existing cart/get-cart callers.
export async function resolveRegion(
  creds: MedusaCredentials,
  orgId: string,
  countryCode?: string,
): Promise<{ id?: string; countryCode?: string }> {
  const { regions } = await medusaStoreFetch<{
    regions: Array<{ id: string; countries?: { iso_2: string }[] }>
  }>(creds, '/store/regions', orgId)
  const region =
    (countryCode ? regions.find((r) => r.countries?.some((c) => c.iso_2 === countryCode)) : undefined) ??
    regions[0]
  const resolvedCountry = countryCode ?? region?.countries?.[0]?.iso_2
  return { id: region?.id, countryCode: resolvedCountry }
}

export async function resolveRegionId(
  creds: MedusaCredentials,
  orgId: string,
  countryCode?: string,
): Promise<string | undefined> {
  return (await resolveRegion(creds, orgId, countryCode)).id
}
