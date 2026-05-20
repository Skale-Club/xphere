// src/lib/whatsapp/adapters/evolution.ts
// Evolution Go adapter — normalizes messages.upsert webhook payloads and
// fetches encrypted WhatsApp media via /chat/getBase64FromMediaMessage.

import { storeWhatsAppMedia } from '../storage'
import type {
  NormalizedWhatsAppMessage,
  ResolvedProvider,
  WhatsAppAdapter,
  WhatsAppMediaAttachment,
  WhatsAppMessageType,
} from '../types'

interface EvolutionMessageKey {
  id: string
  remoteJid: string
  fromMe: boolean
  participant?: string
}

interface EvolutionMessageBody {
  conversation?: string
  extendedTextMessage?: { text?: string }
  imageMessage?: { caption?: string; mimetype?: string; fileLength?: number; width?: number; height?: number }
  videoMessage?: { caption?: string; mimetype?: string; fileLength?: number; seconds?: number }
  audioMessage?: { mimetype?: string; fileLength?: number; seconds?: number; ptt?: boolean }
  documentMessage?: { fileName?: string; caption?: string; mimetype?: string; fileLength?: number }
  stickerMessage?: { mimetype?: string; fileLength?: number }
  locationMessage?: { degreesLatitude?: number; degreesLongitude?: number }
}

interface EvolutionMessageData {
  key: EvolutionMessageKey
  pushName?: string
  message?: EvolutionMessageBody
  messageType?: string
  messageTimestamp?: number
}

export interface EvolutionWebhookPayload {
  event: string
  instance: string
  data: Record<string, unknown>
}

function jidToPhone(jid: string): string {
  const num = jid.split('@')[0]
  if (!num) return jid
  return num.startsWith('+') ? num : `+${num}`
}

function isGroupJid(jid: string): boolean {
  return jid.endsWith('@g.us')
}

function detectType(message: EvolutionMessageBody | undefined): WhatsAppMessageType {
  if (!message) return 'text'
  if (message.imageMessage) return 'image'
  if (message.audioMessage) return 'audio'
  if (message.videoMessage) return 'video'
  if (message.documentMessage) return 'document'
  if (message.stickerMessage) return 'sticker'
  if (message.locationMessage) return 'location'
  return 'text'
}

function extractText(message: EvolutionMessageBody | undefined): string {
  if (!message) return ''
  if (typeof message.conversation === 'string' && message.conversation.trim()) {
    return message.conversation.trim()
  }
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text.trim()
  if (message.imageMessage?.caption) return message.imageMessage.caption.trim()
  if (message.videoMessage?.caption) return message.videoMessage.caption.trim()
  if (message.documentMessage?.caption) return message.documentMessage.caption.trim()
  return ''
}

export function normalizeEvolution(
  payload: EvolutionWebhookPayload,
  provider: ResolvedProvider,
): NormalizedWhatsAppMessage[] {
  const raw = payload.data as unknown as
    & { messages?: EvolutionMessageData[] }
    & EvolutionMessageData
  const messages: EvolutionMessageData[] = Array.isArray(raw?.messages)
    ? raw.messages
    : [raw]

  const out: NormalizedWhatsAppMessage[] = []
  for (const m of messages) {
    if (!m?.key) continue
    if (m.key.fromMe) continue
    if (isGroupJid(m.key.remoteJid)) continue

    out.push({
      provider: 'evolution',
      providerId: provider.id,
      orgId: provider.orgId,
      messageId: m.key.id,
      fromJid: m.key.remoteJid,
      fromPhone: jidToPhone(m.key.remoteJid),
      fromName: m.pushName ?? null,
      isGroup: false,
      isFromMe: false,
      timestamp: typeof m.messageTimestamp === 'number'
        ? m.messageTimestamp
        : Math.floor(Date.now() / 1000),
      text: extractText(m.message),
      messageType: detectType(m.message),
      rawMessage: m,
      instanceName: provider.config.instance_name,
    })
  }
  return out
}

interface EvolutionMediaResponse {
  base64?: string
  mimetype?: string
}

export async function fetchEvolutionMedia(
  msg: NormalizedWhatsAppMessage,
  provider: ResolvedProvider,
  conversationId: string,
): Promise<WhatsAppMediaAttachment[]> {
  const raw = msg.rawMessage as EvolutionMessageData | undefined
  if (!raw?.key || !raw.message) return []

  const baseUrl = (provider.config.base_url ?? '').replace(/\/+$/, '')
  const instanceName = provider.config.instance_name
  const token = provider.config.token
  if (!baseUrl || !instanceName || !token) return []

  try {
    const res = await fetch(
      `${baseUrl}/chat/getBase64FromMediaMessage/${instanceName}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: token,
        },
        body: JSON.stringify({
          message: { key: raw.key, message: raw.message },
        }),
      },
    )

    if (!res.ok) {
      console.error(
        `[whatsapp/evolution] media fetch failed HTTP ${res.status} for ${msg.messageId}`,
      )
      return []
    }

    const body = (await res.json()) as EvolutionMediaResponse
    if (!body.base64) return []

    const mimeType =
      body.mimetype ??
      raw.message.imageMessage?.mimetype ??
      raw.message.audioMessage?.mimetype ??
      raw.message.videoMessage?.mimetype ??
      raw.message.documentMessage?.mimetype ??
      raw.message.stickerMessage?.mimetype ??
      'application/octet-stream'

    const dur =
      raw.message.audioMessage?.seconds ??
      raw.message.videoMessage?.seconds

    const stored = await storeWhatsAppMedia({
      base64: body.base64,
      mimeType,
      orgId: msg.orgId,
      conversationId,
      messageId: msg.messageId,
      idx: 0,
      filenameHint: raw.message.documentMessage?.fileName,
      duration: typeof dur === 'number' ? dur : undefined,
      width: raw.message.imageMessage?.width,
      height: raw.message.imageMessage?.height,
    })

    return stored ? [stored] : []
  } catch (err) {
    console.error('[whatsapp/evolution] fetchMedia error:', err)
    return []
  }
}

export const evolutionAdapter: WhatsAppAdapter = {
  normalize(payload, provider) {
    return normalizeEvolution(payload as EvolutionWebhookPayload, provider)
  },
  fetchMedia(msg, provider, conversationId) {
    return fetchEvolutionMedia(msg, provider, conversationId)
  },
}
