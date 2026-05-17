import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { DEFAULT_BRANDING, resolveOrgBranding, type OrgBranding } from '@/lib/branding'

/**
 * Server-only fetcher for the active org's branding row. Errors are
 * swallowed (returns DEFAULT_BRANDING). Re-exports the resolved type
 * for convenience.
 */
export async function getOrgBranding(orgId: string | null | undefined): Promise<OrgBranding> {
  if (!orgId) return DEFAULT_BRANDING
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('organizations')
      .select('logo_url, accent_color, brand_name')
      .eq('id', orgId)
      .maybeSingle()
    if (error || !data) return DEFAULT_BRANDING
    return resolveOrgBranding(data)
  } catch {
    return DEFAULT_BRANDING
  }
}

export type { OrgBranding } from '@/lib/branding'
