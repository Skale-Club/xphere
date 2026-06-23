import { createServiceRoleClient } from '@/lib/supabase/admin'
import { verifyApiKey } from '@/lib/api-keys/verify'
import { hasScope } from '@/lib/api-keys/scopes'

export const runtime = 'nodejs'

export async function GET(request: Request): Promise<Response> {
  const supabase = createServiceRoleClient()
  const auth = await verifyApiKey(request, supabase)
  if (!auth.ok) {
    return Response.json({ error: auth.error, code: auth.code }, { status: auth.status })
  }

  const { data: organization } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('id', auth.key.orgId)
    .eq('is_active', true)
    .maybeSingle()

  if (!organization) {
    return Response.json({ error: 'Organization is inactive', code: 'organization_inactive' }, { status: 403 })
  }

  return Response.json({
    organization: { id: organization.id, name: organization.name },
    scopes: auth.key.scopes,
    capabilities: {
      lead_ingestion: hasScope(auth.key.scopes, 'leads:write'),
      lead_schema_versions: ['1.0'],
    },
  })
}
