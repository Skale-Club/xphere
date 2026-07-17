// src/lib/medusa/regions.ts
// Country -> region resolution for the Medusa Store API, used when no
// region_id is pinned on the conversation yet. Verified against stuscle's
// storefront `regions.ts` (region.countries[].iso_2 matching).

import { medusaStoreFetch, type MedusaCredentials } from './client'

export async function resolveRegionId(
  creds: MedusaCredentials,
  orgId: string,
  countryCode?: string,
): Promise<string | undefined> {
  const { regions } = await medusaStoreFetch<{
    regions: Array<{ id: string; countries?: { iso_2: string }[] }>
  }>(creds, '/store/regions', orgId)
  const region =
    (countryCode ? regions.find((r) => r.countries?.some((c) => c.iso_2 === countryCode)) : undefined) ??
    regions[0]
  return region?.id
}
