import 'server-only'
import { cache } from 'react'

import { createClient } from '@/lib/supabase/server'

/**
 * Resolved company/control-panel settings for the active org. Source of truth
 * for date timezone + currency across server components. Cached per-request
 * via React `cache()` (same pattern as getUser / get_current_org_id) so many
 * widgets can call it without N round-trips.
 */
export interface OrgSettings {
  id: string | null
  timezone: string
  currency: string
  legalName: string | null
  taxId: string | null
  address: {
    line1: string | null
    line2: string | null
    city: string | null
    state: string | null
    postalCode: string | null
    country: string | null
  }
}

const DEFAULTS: OrgSettings = {
  id: null,
  timezone: 'UTC',
  currency: 'USD',
  legalName: null,
  taxId: null,
  address: { line1: null, line2: null, city: null, state: null, postalCode: null, country: null },
}

export const getOrgSettings = cache(async (): Promise<OrgSettings> => {
  try {
    const supabase = await createClient()
    const { data: orgId } = await supabase.rpc('get_current_org_id')
    if (!orgId) return DEFAULTS
    const { data } = await supabase
      .from('organizations')
      .select(
        'id, timezone, default_currency, legal_name, tax_id, address_line1, address_line2, address_city, address_state, address_postal_code, address_country',
      )
      .eq('id', orgId as string)
      .maybeSingle()
    if (!data) return DEFAULTS
    return {
      id: data.id,
      timezone: data.timezone || 'UTC',
      currency: data.default_currency || 'USD',
      legalName: data.legal_name,
      taxId: data.tax_id,
      address: {
        line1: data.address_line1,
        line2: data.address_line2,
        city: data.address_city,
        state: data.address_state,
        postalCode: data.address_postal_code,
        country: data.address_country,
      },
    }
  } catch {
    return DEFAULTS
  }
})
