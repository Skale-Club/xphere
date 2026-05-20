// src/lib/whatsapp/adapters/zapi.ts
// Z-API adapter — normalizes ReceivedCallback payloads and downloads media
// from the Z-API CDN (URLs are temporary, ~24h).

import { storeWhatsAppMedia } from '../storage'
import type {
  NormalizedWhatsAppMessage,
  ResolvedProvider,
  WhatsAppAdapter,
  WhatsAppMediaAttachment,
  WhatsAppMessageType,
} from '../types'

interface ZApiMediaImage {
  imageUrl?: string
  url?: string
  caption?: string
  mimeType?: string
  width?: number
  height?: number
}

interface ZApiMediaAudio {
  audioUrl?: string
  url?: string
  mimeType?: string
  seconds?: number
  duration?: number
}

interface ZApiMediaVideo {
  videoUrl?: string
  url?: string
  caption?: string
  mimeType?: string
  duration?: number
}

interface ZApiMediaDocument {
  documentUrl?: string
  url?: string
  fileName?: string
  caption?: string
  mimeType?: string
}

interface ZApiMediaSticker {
  stickerUrl?: string
  url?: string
  mimeType?: string
}

export interface ZApiWebhookPayload {
  instanceId?: string
  type?: string
  phone?: string
  fromMe?: boolean
  isGroup?: boolean
  momment?: number
  messageId?: string
  id?: string
  chatName?: string
  senderName?: string
  body?: string
  text?: { message?: string }
  image?: ZApiMediaImage | null
  audio?: ZApiMediaAudio | null
  video?: ZApiMediaVideo | null
  document?: ZApiMediaDocument | null
  sticker?: ZApiMediaSticker | null
}

function normalizePhone(raw: string | undefined): string {
  if (!raw) return ''
  const stripped = raw.split('@')[0]
  if (!stripped) return raw
  return stripped.startsWith('+') ? stripped : `+${stripped}`
}

function detectType(p: ZApiWebhookPayload): WhatsAppMessageType {
  if (p.image) return 'image'
  if (p.audio) return 'audio'
  if (p.video) return 'video'
  if (p.document) return 'document'
  if (p.sticker) return 'sticker'
  return 'text'
}

function extractText(p: ZApiWebhookPayload): string {
  if (typeof p.body === 'string' && p.body.trim()) return p.body.trim()
  if (typeof p.text?.message === 'string' && p.text.message.trim()) return p.text.message.trim()
  if (p.image?.caption) return p.image.caption.trim()
  if (p.video?.caption) return p.video.caption.trim()
  if (p.document?.caption) return p.document.caption.trim()
  return ''
}

export function normalizeZApi(
  payload: ZApiWebhookPayload,
  provider: ResolvedProvider,
): NormalizedWhatsAppMessage[] {
  if (!payload) return []
  if (payload.fromMe) return []
  if (payload.isGroup) return []

  const phone = normalizePhone(payload.phone)
  const jid = payload.phone ?? phone
  const messageId = payload.messageId ?? payload.id ?? ''
  if (!messageId || !phone) return []

  return [
    {
      provider: 'zapi',
      providerId: provider.id,
      orgId: provider.orgId,
      messageId,
      fromJid: jid,
      fromPhone: phone,
      fromName: payload.senderName ?? payload.chatName ?? null,
      isGroup: false,
      isFromMe: false,
      timestamp: typeof payload.momment === 'number' ? payload.momment : Date.now(),
      text: extractText(payload),
      messageType: detectType(payload),
      rawMessage: payload,
    },
  ]
}

function pickMediaSource(p: ZApiWebhookPayload): {
  url: string
  mimeType: string
  filename?: string
  duration?: number
  width?: number
  height?: number
} | null {
  if (p.image) {
    const url = p.image.imageUrl ?? p.image.url
    if (!url) return null
    return {
      url,
      mimeType: p.image.mimeType ?? 'image/jpeg',
      width: p.image.width,
      height: p.image.height,
    }
  }
  if (p.audio) {
    const url = p.audio.audioUrl ?? p.audio.url
    if (!url) return null
    return {
      url,
      mimeType: p.audio.mimeType ?? 'audio/ogg',
      duration: p.audio.seconds ?? p.audio.duration,
    }
  }
  if (p.video) {
    const url = p.video.videoUrl ?? p.video.url
    if (!url) return null
    return {
      url,
      mimeType: p.video.mimeType ?? 'video/mp4',
      duration: p.video.duration,
    }
  }
  if (p.document) {
    const url = p.document.documentUrl ?? p.document.url
    if (!url) return null
    return {
      url,
      mimeType: p.document.mimeType ?? 'application/octet-stream',
      filename: p.document.fileName,
    }
  }
  if (p.sticker) {
    const url = p.sticker.stickerUrl ?? p.sticker.url
    if (!url) return null
    return { url, mimeType: p.sticker.mimeType ?? 'image/webp' }
  }
  return null
}

export async function fetchZApiMedia(
  msg: NormalizedWhatsAppMessage,
  provider: ResolvedProvider,
  conversationId: string,
): Promise<WhatsAppMediaAttachment[]> {
  const raw = msg.rawMessage as ZApiWebhookPayload | undefined
  if (!raw) return []
  const source = pickMediaSource(raw)
  if (!source) return []

  const token = provider.config.token
  const headers: Record<string, string> = token ? { 'Client-Token': token } : {}

  const stored = await storeWhatsAppMedia({
    url: source.url,
    authHeaders: headers,
    mimeType: source.mimeType,
    orgId: msg.orgId,
    conversationId,
    messageId: msg.messageId,
    idx: 0,
    filenameHint: source.filename,
    duration: source.duration,
    width: source.width,
    height: source.height,
  })

  return stored ? [stored] : []
}

export const zapiAdapter: WhatsAppAdapter = {
  normalize(payload, provider) {
    return normalizeZApi(payload as ZApiWebhookPayload, provider)
  },
  fetchMedia(msg, provider, conversationId) {
    return fetchZApiMedia(msg, provider, conversationId)
  },
}
