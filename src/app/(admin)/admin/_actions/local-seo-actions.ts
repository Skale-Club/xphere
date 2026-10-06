'use server'

// Platform-admin control for whose DataForSEO account an org's Local SEO scans
// run on (migration 1323). 'platform' (the default) means the agency pays and
// the points count against the org's plan quota; 'own' means the org's account
// from Integrations → DataForSEO pays and the points are not billable.
// Same pattern as billing-actions: assert platform admin → service-role write.
import { revalidatePath } from 'next/cache'

import { orgDataForSeoCredentials } from '@/lib/local-seo/credentials'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { getUser } from '@/lib/supabase/server'

type Result = { ok: true } | { ok: false; error: string }

export type OrgLocalSeoSettings = {
  rankCredentials: 'platform' | 'own'
  /** The org has an active DataForSEO integration with a login and password. */
  ownAccountConnected: boolean
}

async function platformAdmin() {
  const user = await getUser()
  const adminEmail = process.env.PLATFORM_ADMIN_EMAIL
  return user && adminEmail && user.email === adminEmail ? user : null
}

export async function getOrgLocalSeoSettings(orgId: string): Promise<OrgLocalSeoSettings> {
  const admin = createServiceRoleClient()
  const [{ data }, creds] = await Promise.all([
    admin.from('local_seo_org_settings').select('rank_credentials').eq('org_id', orgId).maybeSingle(),
    orgDataForSeoCredentials(admin, orgId),
  ])
  return { rankCredentials: data?.rank_credentials === 'own' ? 'own' : 'platform', ownAccountConnected: !!creds }
}

export async function setOrgRankCredentials(orgId: string, source: 'platform' | 'own'): Promise<Result> {
  const user = await platformAdmin()
  if (!user) return { ok: false, error: 'Unauthorized' }
  if (source !== 'platform' && source !== 'own') return { ok: false, error: 'Unknown option.' }
  const admin = createServiceRoleClient()
  if (source === 'own' && !(await orgDataForSeoCredentials(admin, orgId))) {
    return { ok: false, error: 'This organization has no active DataForSEO integration yet.' }
  }
  const { error } = await admin
    .from('local_seo_org_settings')
    .upsert({ org_id: orgId, rank_credentials: source, updated_by: user.id, updated_at: new Date().toISOString() })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/admin/orgs/${orgId}`)
  return { ok: true }
}
