import type { createServiceRoleClient } from '@/lib/supabase/admin'

type ServiceClient = ReturnType<typeof createServiceRoleClient>

export type ProspectEntityRef = { entityType: 'contact' | 'account'; entityId: string }

/**
 * Resolve an inbound integration event to a prospect record within an org.
 * Prefers the echoed Xphere id/kind; falls back to matching a contact by email.
 */
export async function resolveProspectEntity(
  supabase: ServiceClient,
  orgId: string,
  params: { xphereId?: string | null; xphereKind?: string | null; email?: string | null },
): Promise<ProspectEntityRef | null> {
  if (params.xphereId && (params.xphereKind === 'contact' || params.xphereKind === 'account')) {
    const table = params.xphereKind === 'account' ? 'accounts' : 'contacts'
    const { data } = await supabase
      .from(table)
      .select('id')
      .eq('id', params.xphereId)
      .eq('org_id', orgId)
      .maybeSingle()
    if (data) return { entityType: params.xphereKind, entityId: data.id as string }
  }

  if (params.email) {
    const email = params.email.trim().toLowerCase()
    if (email) {
      const { data } = await supabase
        .from('contacts')
        .select('id')
        .eq('org_id', orgId)
        .eq('email_normalized', email)
        .maybeSingle()
      if (data) return { entityType: 'contact', entityId: data.id as string }
    }
  }

  return null
}
