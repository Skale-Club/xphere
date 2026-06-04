// src/lib/ghl/map-business-to-xphere.ts
// Pure mapper from GoHighLevel business rows to Xphere account rows.

import { normaliseDomain } from '@/lib/accounts'
import type { GhlBusiness } from './list-businesses'

export interface MappedGhlBusiness {
  name: string
  domain: string | null
  website: string | null
  address: string | null
  external_id: string
  custom_fields: Record<string, unknown>
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function domainFromWebsite(website: string | null): string | null {
  if (!website) return null
  try {
    const url = new URL(website)
    // GHL businesses can store Google Maps search URLs as "website". Those
    // are useful as source metadata, but not as company identity domains.
    if (url.hostname.endsWith('google.com')) return null
    return normaliseDomain(url.hostname)
  } catch {
    return normaliseDomain(website)
  }
}

export function mapGhlBusiness(business: GhlBusiness): MappedGhlBusiness | null {
  const name = clean(business.name)
  if (!business.id || !name) return null

  const website = clean(business.website)
  const address = clean(business.address)
  const city = clean(business.city)
  const state = clean(business.state)
  const postalCode = clean(business.postalCode)

  const customFields: Record<string, unknown> = {
    ghl_business: {
      id: business.id,
      location_id: business.locationId ?? null,
      city,
      state,
      postal_code: postalCode,
      created_at: business.createdAt ?? null,
      updated_at: business.updatedAt ?? null,
      created_by: business.createdBy ?? null,
      custom_fields: business.customFields ?? [],
    },
  }

  return {
    name,
    domain: domainFromWebsite(website),
    website,
    address,
    external_id: business.id,
    custom_fields: customFields,
  }
}
