import type { createServiceRoleClient } from '@/lib/supabase/admin'

type ServiceClient = ReturnType<typeof createServiceRoleClient>

export type ProspectEntityRef = { entityType: 'contact' | 'account'; entityId: string }

/**
 * Resolve an inbound integration event to a prospect record within an org.
 * Prefers the echoed Xphere id/kind; falls back to matching a contact by email.
 */
/**
 * Normalise xphere_kind to the resolver's vocabulary. Accepts the current
 * values ('contact' | 'account') plus the legacy prospect kinds ('person' |
 * 'company') that some callers historically echoed back.
 */
function normaliseXphereKind(kind?: string | null): 'contact' | 'account' | null {
  if (kind === 'contact' || kind === 'person') return 'contact'
  if (kind === 'account' || kind === 'company') return 'account'
  return null
}

export async function resolveProspectEntity(
  supabase: ServiceClient,
  orgId: string,
  params: { xphereId?: string | null; xphereKind?: string | null; email?: string | null },
): Promise<ProspectEntityRef | null> {
  const kind = normaliseXphereKind(params.xphereKind)
  if (params.xphereId && kind) {
    const table = kind === 'account' ? 'accounts' : 'contacts'
    const { data } = await supabase
      .from(table)
      .select('id')
      .eq('id', params.xphereId)
      .eq('org_id', orgId)
      .maybeSingle()
    if (data) return { entityType: kind, entityId: data.id as string }
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

      // Companies have no email column; the address lives in custom_fields.email
      // (see emailFromCustomFields in src/lib/mcp/tools/prospects.ts).
      const { data: accountData } = await supabase
        .from('accounts')
        .select('id')
        .eq('org_id', orgId)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter('custom_fields->>email' as any, 'ilike', email)
        .maybeSingle()
      if (accountData) return { entityType: 'account', entityId: accountData.id as string }
    }
  }

  return null
}
