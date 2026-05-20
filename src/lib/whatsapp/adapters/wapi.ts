// src/lib/whatsapp/adapters/wapi.ts
// W-API adapter — Baileys-like nested payload, encrypted media fetched via
// POST {base_url}/message/download/{instanceKey}.

import { storeWhatsAppMedia } from '../storage'
import type {
  NormalizedWhatsAppMessage,
  ResolvedProvider,
  WhatsAppAdapter,
  WhatsAppMediaAttachment,
  WhatsAppMessageType,
} from '../types'

interface WApiKey {
  id: string
  remoteJid: string
  fromMe: boolean
  participant?: string
}

interface WApiMessageBody {
  conversation?: string
  extendedTextMessage?: { text?: string }
  imageMessage?: { caption?: string; mimetype?: string; fileLength?: number; width?: number; height?: number }
  audioMessage?: { mimetype?: string; fileLength?: number; seconds?: number; ptt?: boolean }
  videoMessage?: { caption?: string; mimetype?: string; fileLength?: number; seconds?: number }
  documentMessage?: { fileName?: string; mimetype?: string; fileLength?: number; title?: string }
  stickerMessage?: { mimetype?: string; fileLength?: number }
}

interface WApiData {
  key: WApiKey
  pushName?: string
  message?: WApiMessageBody
  messageType?: string
  messageTimestamp?: number
}

export interface WApiWebhookPayload {
  event?: string
  instance_key?: string
  data?: WApiData
}

function jidToPhone(jid: string): string {
  const num = jid.split('@')[0]
  if (!num) return jid
  return num.startsWith('+') ? num : `+${num}`
}

function isGroupJid(jid: string): boolean {
  return jid.endsWith('@g.us')
}

function detectType(msg: WApiMessageBody | undefined): WhatsAppMessageType {
  if (!msg) return 'text'
  if (msg.imageMessage) return 'image'
  if (msg.audioMessage) return 'audio'
  if (msg.videoMessage) return 'video'
  if (msg.documentMessage) return 'document'
  if (msg.stickerMessage) return 'sticker'
  return 'text'
}

function extractText(msg: WApiMessageBody | undefined): string {
  if (!msg) return ''
  if (typeof msg.conversation === 'string' && msg.conversation.trim()) return msg.conversation.trim()
  if (msg.extendedTextMessage?.text) return msg.extendedTextMessage.text.trim()
  if (msg.imageMessage?.caption) return msg.imageMessage.caption.trim()
  if (msg.videoMessage?.caption) return msg.videoMessage.caption.trim()
  return ''
}

export function normalizeWApi(
  payload: WApiWebhookPayload,
  provider: ResolvedProvider,
): NormalizedWhatsAppMessage[] {
  const d = payload?.data
  if (!d?.key) return []
  if (d.key.fromMe) return []
  if (isGroupJid(d.key.remoteJid)) return []

  return [
    {
      provider: 'wapi',
      providerId: provider.id,
      orgId: provider.orgId,
      messageId: d.key.id,
      fromJid: d.key.remoteJid,
      fromPhone: jidToPhone(d.key.remoteJid),
      fromName: d.pushName ?? null,
      isGroup: false,
      isFromMe: false,
      timestamp: typeof d.messageTimestamp === 'number'
        ? d.messageTimestamp
        : Math.floor(Date.now() / 1000),
      text: extractText(d.message),
      messageType: detectType(d.message),
      rawMessage: d,
    },
  ]
}

interface WApiDownloadResponse {
  data?: { base64?: string; mimetype?: string }
  base64?: string
  mimetype?: string
}

export async function fetchWApiMedia(
  msg: NormalizedWhatsAppMessage,
  provider: ResolvedProvider,
  conversationId: string,
): Promise<WhatsAppMediaAttachment[]> {
  const raw = msg.rawMessage as WApiData | undefined
  if (!raw?.key || !raw.message) return []

  const baseUrl = (provider.config.base_url ?? '').replace(/\/+$/, '')
  const instanceKey = provider.config.instance_key
  const token = provider.config.token
  if (!baseUrl || !instanceKey || !token) return []

  try {
    const res = await fetch(`${baseUrl}/message/download/${instanceKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        messageId: raw.key.id,
        remoteJid: raw.key.remoteJid,
      }),
    })

    if (!res.ok) {
      console.error(
        `[whatsapp/wapi] media download failed HTTP ${res.status} for ${msg.messageId}`,
      )
      return []
    }

    const body = (await res.json()) as WApiDownloadResponse
    const base64 = body.data?.base64 ?? body.base64
    if (!base64) return []

    const mimeType =
      body.data?.mimetype ??
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
      base64,
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
    console.error('[whatsapp/wapi] fetchMedia error:', err)
    return []
  }
}

export const wapiAdapter: WhatsAppAdapter = {
  normalize(payload, provider) {
    return normalizeWApi(payload as WApiWebhookPayload, provider)
  },
  fetchMedia(msg, provider, conversationId) {
    return fetchWApiMedia(msg, provider, conversationId)
  },
}
