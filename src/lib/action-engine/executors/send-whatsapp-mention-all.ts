// src/lib/action-engine/executors/send-whatsapp-mention-all.ts
// Executor for the `send_whatsapp_mention_all` action type.
//
// Mentions every participant of a WhatsApp group when posting a message
// (Evolution Go v0.7.0+ — `mentionsEveryOne: true` flag).
//
// Required params:
//   group_jid : string  — e.g. "120363012345678901@g.us"
//   text      : string
// Optional:
//   media_url   : string
//   media_type  : 'image' | 'video' | 'document' | 'audio'

import { sendGroupMentionAll } from '@/lib/evolution/client'
import { resolveEvolutionInstance } from '@/lib/evolution/credentials'
import type { ActionContext } from '@/lib/action-engine/execute-action'

export async function sendWhatsappMentionAllAction(
  params: Record<string, unknown>,
  ctx: ActionContext,
): Promise<string> {
  const groupJid = String(params.group_jid ?? params.groupJid ?? '').trim()
  const text = String(params.text ?? params.message ?? params.body ?? '').trim()
  const instanceName = params.instance_name ? String(params.instance_name) : undefined
  const mediaUrl = params.media_url ? String(params.media_url) : undefined
  const mediaType = params.media_type as 'image' | 'video' | 'document' | 'audio' | undefined

  if (!groupJid) throw new Error('send_whatsapp_mention_all requires "group_jid".')
  if (!groupJid.endsWith('@g.us')) {
    throw new Error('send_whatsapp_mention_all "group_jid" must end with @g.us')
  }
  if (!text) throw new Error('send_whatsapp_mention_all requires "text".')

  const instance = await resolveEvolutionInstance(ctx.organizationId, instanceName, ctx.supabase)
  if (!instance) throw new Error('No active Evolution Go instance for this org.')
  if (instance.status !== 'connected') {
    throw new Error(`Evolution instance "${instance.instance_name}" is not connected.`)
  }

  const res = await sendGroupMentionAll(instance.config, instance.instance_name, groupJid, text, {
    mediaUrl,
    mediaType,
  })

  if (!res.ok) {
    throw new Error(res.error ?? 'Evolution Go mention-all send failed')
  }

  return `WhatsApp group mention sent. ID: ${res.data?.key?.id ?? '(unknown)'}`
}
