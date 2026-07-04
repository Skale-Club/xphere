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

/**
 * @param orgId Pre-resolved org id (e.g. from getActiveOrg()) to skip a
 * redundant get_current_org_id() RPC when the caller already has it. Pass
 * `undefined` (or omit) to self-resolve via RPC as before; pass `null`
 * explicitly for "no active org".
 */
export const getOrgSettings = cache(async (orgId?: string | null): Promise<OrgSettings> => {
  try {
    const supabase = await createClient()
    const resolvedOrgId = orgId !== undefined ? orgId : (await supabase.rpc('get_current_org_id')).data
    if (!resolvedOrgId) return DEFAULTS
    const { data } = await supabase
      .from('organizations')
      .select(
        'id, timezone, default_currency, legal_name, tax_id, address_line1, address_line2, address_city, address_state, address_postal_code, address_country',
      )
      .eq('id', resolvedOrgId as string)
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
