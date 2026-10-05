import 'server-only'

// Shared guard for Local SEO server actions: signed in, holds the
// permission, plan includes the feature, has an active org.

import { requireFeature } from '@/lib/billing/guards'
import { requirePermission } from '@/lib/rbac/server'
import { createClient, getUser } from '@/lib/supabase/server'

export type LocalSeoPermission = 'local_seo.view' | 'local_seo.manage' | 'local_seo.approve' | 'local_seo.admin'

export type Fail = { error: string }

export type ActionCtx = {
  user: { id: string; email?: string | null }
  supabase: Awaited<ReturnType<typeof createClient>>
  orgId: string
}

export async function localSeoContext(permission: LocalSeoPermission): Promise<ActionCtx | Fail> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const perm = await requirePermission(permission)
  if (!perm.ok) return { error: perm.error ?? 'You do not have permission to do this.' }
  const feature = await requireFeature('local_seo')
  if (!feature.ok) return { error: feature.error }
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No active organization.' }
  return { user, supabase, orgId: orgId as string }
}
