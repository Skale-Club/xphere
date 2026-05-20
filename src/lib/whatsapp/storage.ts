// src/lib/whatsapp/storage.ts
// Upload WhatsApp media into the chat-media Supabase Storage bucket. Returns
// a WhatsAppMediaAttachment ready to embed in conversation_messages.metadata.
// SEED-031.

import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { WhatsAppMediaAttachment } from './types'

interface StoreWhatsAppMediaParams {
  /** Provide either base64 (preferred for Evolution / W-API) ... */
  base64?: string
  /** ... or a direct URL (Z-API CDN). */
  url?: string
  authHeaders?: Record<string, string>
  mimeType: string
  orgId: string
  conversationId: string
  messageId: string
  idx?: number
  /** Optional original filename hint (e.g. documentMessage.fileName). */
  filenameHint?: string
  /** Optional duration in seconds (audio/video). */
  duration?: number
  width?: number
  height?: number
}

function mimeToExt(mimeType: string): string {
  const base = mimeType.split(';')[0].trim().toLowerCase()
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'audio/ogg': 'ogg',
    'audio/ogg; codecs=opus': 'ogg',
    'audio/mp4': 'm4a',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/webm': 'webm',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/3gpp': '3gp',
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  }
  return map[base] ?? 'bin'
}

function stripBase64Prefix(b64: string): string {
  if (b64.startsWith('data:')) {
    const idx = b64.indexOf(',')
    return idx >= 0 ? b64.slice(idx + 1) : b64
  }
  return b64
}

/**
 * Upload either a base64 blob or a URL-fetched buffer to chat-media. Returns
 * null on any failure (bucket missing, network error, etc.) so callers can
 * gracefully insert the message without media.
 */
export async function storeWhatsAppMedia(
  params: StoreWhatsAppMediaParams,
): Promise<WhatsAppMediaAttachment | null> {
  const {
    base64,
    url,
    authHeaders,
    mimeType,
    orgId,
    conversationId,
    messageId,
    idx = 0,
    filenameHint,
    duration,
    width,
    height,
  } = params

  try {
    let buffer: Buffer
    if (base64) {
      const clean = stripBase64Prefix(base64)
      buffer = Buffer.from(clean, 'base64')
    } else if (url) {
      const res = await fetch(url, authHeaders ? { headers: authHeaders } : undefined)
      if (!res.ok) {
        console.error(
          `[whatsapp/storage] fetch ${url} failed: HTTP ${res.status}`,
        )
        return null
      }
      const ab = await res.arrayBuffer()
      buffer = Buffer.from(ab)
    } else {
      console.error('[whatsapp/storage] storeWhatsAppMedia: no base64 or url')
      return null
    }

    const size = buffer.byteLength
    const ext = mimeToExt(mimeType)
    const timestamp = Date.now()
    const filename = `${timestamp}-${idx}.${ext}`
    const path = `${orgId}/${conversationId}/${messageId}/${filename}`

    const supabase = createServiceRoleClient()
    const { error } = await supabase.storage
      .from('chat-media')
      .upload(path, buffer, { contentType: mimeType, upsert: false })

    if (error) {
      console.error('[whatsapp/storage] upload error:', error.message)
      return null
    }

    const publicUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/chat-media/${path}`

    const out: WhatsAppMediaAttachment = {
      url: publicUrl,
      mime_type: mimeType,
      size,
      filename: filenameHint ?? filename,
    }
    if (typeof duration === 'number') out.duration = duration
    if (typeof width === 'number') out.width = width
    if (typeof height === 'number') out.height = height
    return out
  } catch (err) {
    console.error('[whatsapp/storage] unexpected error:', err)
    return null
  }
}
