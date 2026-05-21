// src/lib/whatsapp/send.ts
// Provider-agnostic WhatsApp sender. Looks up the active provider for the org
// and dispatches text (+ optional media) via the right vendor API.

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { formatOutbound as formatWhatsapp } from '@/lib/agent-runtime/adapters/whatsapp'
import { resolveActiveProvider } from './resolve-provider'
import type {
  ResolvedProvider,
  WhatsAppMediaAttachment,
} from './types'

export interface SendWhatsAppMessageInput {
  orgId: string
  to: string
  text: string
  media?: WhatsAppMediaAttachment[]
  conversationId?: string
  /** Defaults to true | uses the 1600-char WhatsApp adapter chunks. */
  splitIntoChunks?: boolean
  /** When persisting to conversation_messages, which role to use. */
  role?: 'assistant' | 'user'
}

export interface SendWhatsAppMessageResult {
  ok: boolean
  error?: string
  messageIds: string[]
}

function normalizeTo(to: string): string {
  // Strip leading + and any @suffix | most providers want digits-only.
  let value = to.startsWith('+') ? to.slice(1) : to
  if (value.includes('@')) value = value.split('@')[0]
  return value
}

// ---------------------------------------------------------------------------
// Evolution Go
// ---------------------------------------------------------------------------

interface EvolutionSendTextResponse {
  key?: { id?: string }
  message?: unknown
}

async function sendViaEvolution(
  input: SendWhatsAppMessageInput,
  provider: ResolvedProvider,
  chunks: string[],
): Promise<SendWhatsAppMessageResult> {
  const baseUrl = (provider.config.base_url ?? '').replace(/\/+$/, '')
  const instanceName = provider.config.instance_name
  const token = provider.config.token
  if (!baseUrl || !instanceName || !token) {
    return { ok: false, error: 'Evolution provider config incomplete.', messageIds: [] }
  }

  const number = normalizeTo(input.to)
  const messageIds: string[] = []

  for (const text of chunks) {
    try {
      const res = await fetch(`${baseUrl}/message/sendText/${instanceName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: token },
        body: JSON.stringify({ number, text }),
      })
      if (!res.ok) {
        const errBody = await res.text().catch(() => '')
        return {
          ok: false,
          error: `Evolution send failed HTTP ${res.status}: ${errBody.slice(0, 200)}`,
          messageIds,
        }
      }
      const body = (await res.json()) as EvolutionSendTextResponse
      if (body.key?.id) messageIds.push(body.key.id)
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        messageIds,
      }
    }
  }

  // Media via /message/sendMedia
  for (const m of input.media ?? []) {
    const mediatype = m.mime_type.startsWith('image/')
      ? 'image'
      : m.mime_type.startsWith('video/')
      ? 'video'
      : m.mime_type.startsWith('audio/')
      ? 'audio'
      : 'document'
    try {
      const res = await fetch(`${baseUrl}/message/sendMedia/${instanceName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: token },
        body: JSON.stringify({
          number,
          mediatype,
          media: m.url,
          fileName: m.filename,
          mimetype: m.mime_type,
        }),
      })
      if (!res.ok) {
        const errBody = await res.text().catch(() => '')
        return {
          ok: false,
          error: `Evolution media failed HTTP ${res.status}: ${errBody.slice(0, 200)}`,
          messageIds,
        }
      }
      const body = (await res.json()) as EvolutionSendTextResponse
      if (body.key?.id) messageIds.push(body.key.id)
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        messageIds,
      }
    }
  }

  return { ok: true, messageIds }
}

// ---------------------------------------------------------------------------
// Z-API
// ---------------------------------------------------------------------------

interface ZApiSendResponse {
  messageId?: string
  id?: string
  zaapId?: string
}

async function sendViaZApi(
  input: SendWhatsAppMessageInput,
  provider: ResolvedProvider,
  chunks: string[],
): Promise<SendWhatsAppMessageResult> {
  const baseUrl = (provider.config.base_url ?? 'https://api.z-api.io').replace(/\/+$/, '')
  const instanceId = provider.config.instance_id
  const token = provider.config.token
  if (!instanceId || !token) {
    return { ok: false, error: 'Z-API provider config incomplete.', messageIds: [] }
  }

  const phone = normalizeTo(input.to)
  const messageIds: string[] = []
  const prefix = `${baseUrl}/instances/${instanceId}/token/${token}`
  const clientToken = token

  for (const message of chunks) {
    try {
      const res = await fetch(`${prefix}/send-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Client-Token': clientToken },
        body: JSON.stringify({ phone, message }),
      })
      if (!res.ok) {
        const errBody = await res.text().catch(() => '')
        return {
          ok: false,
          error: `Z-API send failed HTTP ${res.status}: ${errBody.slice(0, 200)}`,
          messageIds,
        }
      }
      const body = (await res.json()) as ZApiSendResponse
      const id = body.messageId ?? body.id ?? body.zaapId
      if (id) messageIds.push(id)
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        messageIds,
      }
    }
  }

  for (const m of input.media ?? []) {
    const endpoint = m.mime_type.startsWith('image/')
      ? 'send-image'
      : m.mime_type.startsWith('audio/')
      ? 'send-audio'
      : m.mime_type.startsWith('video/')
      ? 'send-video'
      : 'send-document'

    const payload: Record<string, unknown> = { phone }
    if (endpoint === 'send-image') payload.image = m.url
    else if (endpoint === 'send-audio') payload.audio = m.url
    else if (endpoint === 'send-video') payload.video = m.url
    else payload.document = m.url
    if (m.filename) payload.fileName = m.filename

    try {
      const res = await fetch(`${prefix}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Client-Token': clientToken },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const errBody = await res.text().catch(() => '')
        return {
          ok: false,
          error: `Z-API media failed HTTP ${res.status}: ${errBody.slice(0, 200)}`,
          messageIds,
        }
      }
      const body = (await res.json()) as ZApiSendResponse
      const id = body.messageId ?? body.id ?? body.zaapId
      if (id) messageIds.push(id)
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        messageIds,
      }
    }
  }

  return { ok: true, messageIds }
}

// ---------------------------------------------------------------------------
// W-API
// ---------------------------------------------------------------------------

interface WApiSendResponse {
  messageId?: string
  data?: { messageId?: string; key?: { id?: string } }
  key?: { id?: string }
}

async function sendViaWApi(
  input: SendWhatsAppMessageInput,
  provider: ResolvedProvider,
  chunks: string[],
): Promise<SendWhatsAppMessageResult> {
  const baseUrl = (provider.config.base_url ?? '').replace(/\/+$/, '')
  const instanceKey = provider.config.instance_key
  const token = provider.config.token
  if (!baseUrl || !instanceKey || !token) {
    return { ok: false, error: 'W-API provider config incomplete.', messageIds: [] }
  }

  const number = normalizeTo(input.to)
  const messageIds: string[] = []
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }

  for (const text of chunks) {
    try {
      const res = await fetch(`${baseUrl}/message/sendText/${instanceKey}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ number, text }),
      })
      if (!res.ok) {
        const errBody = await res.text().catch(() => '')
        return {
          ok: false,
          error: `W-API send failed HTTP ${res.status}: ${errBody.slice(0, 200)}`,
          messageIds,
        }
      }
      const body = (await res.json()) as WApiSendResponse
      const id = body.messageId ?? body.data?.messageId ?? body.data?.key?.id ?? body.key?.id
      if (id) messageIds.push(id)
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        messageIds,
      }
    }
  }

  for (const m of input.media ?? []) {
    const endpoint = m.mime_type.startsWith('image/')
      ? 'sendImage'
      : m.mime_type.startsWith('audio/')
      ? 'sendAudio'
      : m.mime_type.startsWith('video/')
      ? 'sendVideo'
      : 'sendDocument'
    const payload: Record<string, unknown> = { number, url: m.url, mimetype: m.mime_type }
    if (m.filename) payload.fileName = m.filename
    try {
      const res = await fetch(`${baseUrl}/message/${endpoint}/${instanceKey}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const errBody = await res.text().catch(() => '')
        return {
          ok: false,
          error: `W-API media failed HTTP ${res.status}: ${errBody.slice(0, 200)}`,
          messageIds,
        }
      }
      const body = (await res.json()) as WApiSendResponse
      const id = body.messageId ?? body.data?.messageId ?? body.data?.key?.id ?? body.key?.id
      if (id) messageIds.push(id)
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        messageIds,
      }
    }
  }

  return { ok: true, messageIds }
}

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

export async function sendWhatsAppMessage(
  input: SendWhatsAppMessageInput,
): Promise<SendWhatsAppMessageResult> {
  const provider = await resolveActiveProvider(input.orgId)
  if (!provider) {
    return { ok: false, error: 'No active WhatsApp provider for this org.', messageIds: [] }
  }

  const chunks: string[] = []
  if (input.text && input.text.length > 0) {
    if (input.splitIntoChunks === false) {
      chunks.push(input.text)
    } else {
      for (const c of formatWhatsapp(input.text)) {
        if (c.type === 'text') chunks.push(c.text)
      }
    }
  }

  let result: SendWhatsAppMessageResult
  switch (provider.provider) {
    case 'evolution':
      result = await sendViaEvolution(input, provider, chunks)
      break
    case 'zapi':
      result = await sendViaZApi(input, provider, chunks)
      break
    case 'wapi':
      result = await sendViaWApi(input, provider, chunks)
      break
    default:
      result = { ok: false, error: `Unknown provider: ${String(provider.provider)}`, messageIds: [] }
  }

  // Persist outbound messages to the conversation if requested
  if (result.ok && input.conversationId) {
    const supabase = createServiceRoleClient()
    const role = input.role ?? 'assistant'
    for (const chunk of chunks) {
      try {
        await supabase.from('conversation_messages').insert({
          conversation_id: input.conversationId,
          org_id: input.orgId,
          role,
          content: chunk,
          metadata: {
            channel: 'whatsapp',
            provider: provider.provider,
            to: input.to,
            provider_id: provider.id,
          },
        })
      } catch (err) {
        console.error('[whatsapp/send] persist error:', err)
      }
    }
  }

  return result
}
