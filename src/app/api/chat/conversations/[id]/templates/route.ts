// GET /api/chat/conversations/[id]/templates
//
// Provider-aware list of APPROVED WhatsApp templates for the conversation's
// channel, normalized to the same shape the SendTemplateDialog already renders
// (ApprovedTemplate). Meta Cloud reads the synced `whatsapp_templates` table;
// Zernio fetches its template library live via the Zernio API.
//
// Response: { provider, canCreate, templates: ApprovedTemplate[] }

import { createClient, getUser } from '@/lib/supabase/server'
import { getProviderKey } from '@/lib/integrations/get-provider-key'
import {
  listZernioWhatsappTemplates,
  zernioTemplateBodyVarCount,
  zernioTemplateHeaderVarCount,
  zernioBodyComponent,
} from '@/lib/zernio/whatsapp-templates'

export const runtime = 'nodejs'

interface ApprovedTemplate {
  id: string
  name: string
  language: string
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'
  bodyVariableCount: number
  headerVariableCount: number
  bodyText: string | null
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const supabase = await createClient()

  const { data: conv } = await supabase
    .from('conversations')
    .select('id, org_id, channel, channel_metadata')
    .eq('id', id)
    .maybeSingle()
  if (!conv) return Response.json({ error: 'Conversation not found' }, { status: 404 })

  const channel = (conv.channel as string) ?? ''
  const meta = (conv.channel_metadata as Record<string, string>) ?? {}

  // ── Zernio (zernio_whatsapp): live template library ──
  if (channel === 'zernio_whatsapp') {
    const accountId = meta.account_id
    if (!accountId) {
      return Response.json({ provider: 'zernio', canCreate: false, templates: [] })
    }
    const apiKey = await getProviderKey('zernio', conv.org_id as string, supabase)
    if (!apiKey) {
      return Response.json({ provider: 'zernio', canCreate: false, templates: [] })
    }
    try {
      const raw = await listZernioWhatsappTemplates(accountId, apiKey)
      const templates: ApprovedTemplate[] = raw
        .filter((t) => (t.status ?? '').toUpperCase() === 'APPROVED')
        .map((t) => ({
          // Encode name+language so the send route can route without a DB row.
          id: `zernio:${t.name}:${t.language}`,
          name: t.name,
          language: t.language,
          category: (['MARKETING', 'UTILITY', 'AUTHENTICATION'].includes(
            (t.category ?? '').toUpperCase(),
          )
            ? ((t.category as string).toUpperCase() as ApprovedTemplate['category'])
            : 'UTILITY'),
          bodyVariableCount: zernioTemplateBodyVarCount(t),
          headerVariableCount: zernioTemplateHeaderVarCount(t),
          bodyText: zernioBodyComponent(t)?.text ?? null,
        }))
      return Response.json({ provider: 'zernio', canCreate: false, templates })
    } catch (err) {
      console.error('[chat:templates] zernio list error', err)
      return Response.json(
        { provider: 'zernio', canCreate: false, templates: [], error: 'Failed to load Zernio templates' },
        { status: 502 },
      )
    }
  }

  // ── Meta Cloud / native whatsapp: synced DB table ──
  const { data: rows } = await supabase
    .from('whatsapp_templates')
    .select('id, name, language, category, body_variable_count, header_variable_count, components')
    .eq('org_id', conv.org_id as string)
    .eq('status', 'APPROVED')
    .order('name')

  const templates: ApprovedTemplate[] = (rows ?? []).map((r) => {
    const components = (r.components as Array<{ type?: string; text?: string }> | null) ?? []
    const body = components.find((c) => (c.type ?? '').toUpperCase() === 'BODY')
    return {
      id: r.id as string,
      name: r.name as string,
      language: r.language as string,
      category: (r.category as ApprovedTemplate['category']) ?? 'UTILITY',
      bodyVariableCount: (r.body_variable_count as number) ?? 0,
      headerVariableCount: (r.header_variable_count as number) ?? 0,
      bodyText: body?.text ?? null,
    }
  })

  return Response.json({ provider: 'meta_cloud', canCreate: true, templates })
}
