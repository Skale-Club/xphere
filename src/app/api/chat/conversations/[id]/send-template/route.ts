// POST /api/chat/conversations/[id]/send-template
//
// Sends an APPROVED WhatsApp Cloud template on a 1:1 conversation. Used by
// the chat composer's "Send template" modal — the operator picks a
// template, fills variables, and dispatches it (essential outside the
// 24h customer service window where free text is rejected).

import { getUser, createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { getActiveCloudAccount } from '@/lib/whatsapp/cloud/resolve-account'
import { sendCloudTemplate } from '@/lib/whatsapp/cloud/send-template'
import { getProviderKey } from '@/lib/integrations/get-provider-key'
import {
  resolveZernioProfileId,
  sendZernioWhatsappTemplate,
} from '@/lib/zernio/whatsapp-templates'

export const runtime = 'nodejs'

interface Body {
  templateId?: string
  bodyVariables?: unknown
  headerVariables?: unknown
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const user = await getUser()
    if (!user) return Response.json({ ok: false, error: 'Not authenticated' }, { status: 401 })

    const { id: conversationId } = await params
    const supabase = await createClient()
    const { data: orgId } = await supabase.rpc('get_current_org_id')
    if (!orgId) {
      return Response.json({ ok: false, error: 'No active organization' }, { status: 403 })
    }

    const body = (await request.json()) as Body
    const templateId = (body.templateId ?? '').trim()
    const bodyVariables = Array.isArray(body.bodyVariables)
      ? body.bodyVariables.map((v) => String(v))
      : []
    const headerVariables = Array.isArray(body.headerVariables)
      ? body.headerVariables.map((v) => String(v))
      : []

    if (!templateId) {
      return Response.json({ ok: false, error: 'Missing templateId' }, { status: 400 })
    }

    // ── Zernio template path (id encoded as `zernio:<name>:<language>`) ──
    // Zernio WhatsApp is the official Cloud API under the hood, so outside the
    // 24h window only approved templates deliver. There is no single-call send;
    // we use the 3-step broadcast flow targeting this one recipient.
    if (templateId.startsWith('zernio:')) {
      const rest = templateId.slice('zernio:'.length)
      const sep = rest.lastIndexOf(':')
      const templateName = sep > 0 ? rest.slice(0, sep) : rest
      const language = sep > 0 ? rest.slice(sep + 1) : ''
      if (!templateName || !language) {
        return Response.json({ ok: false, error: 'Invalid Zernio template id' }, { status: 400 })
      }

      const svc = createServiceRoleClient()
      const { data: convo } = await svc
        .from('conversations')
        .select('id, org_id, channel, channel_metadata, visitor_phone')
        .eq('id', conversationId)
        .maybeSingle()
      if (!convo || convo.org_id !== orgId) {
        return Response.json({ ok: false, error: 'Conversation not found' }, { status: 404 })
      }

      const meta = (convo.channel_metadata as Record<string, string>) ?? {}
      const phone = convo.visitor_phone ?? meta.to_number ?? ''
      if (!phone) {
        return Response.json(
          { ok: false, error: 'Conversation has no associated phone number' },
          { status: 400 },
        )
      }
      const accountId = meta.account_id
      if (!accountId) {
        return Response.json(
          { ok: false, error: 'This Zernio conversation is missing its account id.' },
          { status: 400 },
        )
      }
      const apiKey = await getProviderKey('zernio', orgId, supabase)
      if (!apiKey) {
        return Response.json(
          { ok: false, error: 'Zernio is not connected for this organization.' },
          { status: 400 },
        )
      }
      const profileId = await resolveZernioProfileId(accountId, apiKey)
      if (!profileId) {
        return Response.json(
          {
            ok: false,
            error:
              'Could not resolve the Zernio profile for this account. Reconnect Zernio or check the workspace.',
          },
          { status: 400 },
        )
      }

      const result = await sendZernioWhatsappTemplate({
        apiKey,
        profileId,
        accountId,
        phone,
        templateName,
        language,
        bodyVariables,
        headerVariables,
      })
      if (!result.ok) {
        return Response.json({ ok: false, error: result.error }, { status: 502 })
      }

      const summary =
        bodyVariables.length > 0
          ? `[Template: ${templateName}] ${bodyVariables.join(' · ')}`
          : `[Template: ${templateName}]`
      try {
        await svc.from('conversation_messages').insert({
          conversation_id: conversationId,
          org_id: orgId,
          role: 'assistant',
          content: summary,
          channel: convo.channel,
          metadata: {
            channel: convo.channel,
            provider: 'zernio',
            source: 'template',
            template_name: templateName,
            template_language: language,
            body_variables: bodyVariables,
            header_variables: headerVariables,
            zernio_broadcast_id: result.broadcastId,
          },
        })
        await svc
          .from('conversations')
          .update({
            last_message: summary,
            last_message_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', conversationId)
      } catch (err) {
        console.error('[send-template] zernio persist error:', err)
      }

      return Response.json({ ok: true, broadcastId: result.broadcastId })
    }

    // Load template via the RLS-aware client (must belong to this org).
    const { data: template } = await supabase
      .from('whatsapp_templates')
      .select('name, language, status, body_variable_count, header_variable_count')
      .eq('id', templateId)
      .maybeSingle()
    if (!template) {
      return Response.json({ ok: false, error: 'Template not found' }, { status: 404 })
    }
    if (template.status !== 'APPROVED') {
      return Response.json(
        { ok: false, error: `Template is ${template.status} — only APPROVED templates can be sent` },
        { status: 400 },
      )
    }
    if (bodyVariables.length !== template.body_variable_count) {
      return Response.json(
        {
          ok: false,
          error: `Body expects ${template.body_variable_count} variables, got ${bodyVariables.length}`,
        },
        { status: 400 },
      )
    }
    if (headerVariables.length !== template.header_variable_count) {
      return Response.json(
        {
          ok: false,
          error: `Header expects ${template.header_variable_count} variables, got ${headerVariables.length}`,
        },
        { status: 400 },
      )
    }

    // Load conversation to derive recipient phone. Service role so this works
    // even if the user is acting on behalf of another team member.
    const svc = createServiceRoleClient()
    const { data: convo } = await svc
      .from('conversations')
      .select('id, org_id, visitor_phone, contact_id')
      .eq('id', conversationId)
      .maybeSingle()
    if (!convo || convo.org_id !== orgId) {
      return Response.json({ ok: false, error: 'Conversation not found' }, { status: 404 })
    }
    if (!convo.visitor_phone) {
      return Response.json(
        { ok: false, error: 'Conversation has no associated phone number' },
        { status: 400 },
      )
    }

    const account = await getActiveCloudAccount(orgId)
    if (!account) {
      return Response.json(
        { ok: false, error: 'No active WhatsApp Cloud account for this org' },
        { status: 400 },
      )
    }

    const result = await sendCloudTemplate({
      account,
      to: convo.visitor_phone,
      templateName: template.name,
      language: template.language,
      bodyVariables,
      headerVariables,
    })
    if (!result.ok) {
      return Response.json(
        { ok: false, error: result.error, code: result.code },
        { status: 502 },
      )
    }

    // Persist the outbound template message so it appears in the thread
    // immediately (no waiting on Meta's echo / status webhook). The body
    // shown to the operator is a best-effort summary; a future iteration
    // can resolve the components into the rendered text.
    const summary =
      bodyVariables.length > 0
        ? `[Template: ${template.name}] ${bodyVariables.join(' · ')}`
        : `[Template: ${template.name}]`

    try {
      await svc.from('conversation_messages').insert({
        conversation_id: conversationId,
        org_id: orgId,
        role: 'assistant',
        content: summary,
        metadata: {
          channel: 'whatsapp',
          provider: 'meta_cloud',
          source: 'template',
          template_id: templateId,
          template_name: template.name,
          template_language: template.language,
          body_variables: bodyVariables,
          header_variables: headerVariables,
          wamid: result.wamid,
        },
      })
    } catch (err) {
      console.error('[send-template] persist error:', err)
    }

    return Response.json({ ok: true, wamid: result.wamid })
  } catch (err) {
    console.error('[send-template] outer error:', err)
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    )
  }
}
