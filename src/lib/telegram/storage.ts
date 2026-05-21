// src/lib/telegram/storage.ts
// Download a Telegram file via the authenticated CDN URL and upload it to
// the chat-media bucket. Returns a MediaAttachment payload ready to embed
// in conversation_messages.metadata. SEED-034.

import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { MediaAttachment } from '@/types/chat'

interface StoreTelegramMediaParams {
  /** Authenticated download URL | `https://api.telegram.org/file/bot{token}/{file_path}` */
  downloadUrl: string
  /** Inferred MIME type (Telegram only declares it for some kinds). */
  mimeType: string
  orgId: string
  conversationId: string
  messageId: string
  idx?: number
  filenameHint?: string
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

/**
 * Telegram file_path often already includes an extension (e.g. "photos/file_42.jpg").
 * This is a defensive fallback when the mime map misses.
 */
function extFromPath(path: string | undefined): string | null {
  if (!path) return null
  const m = path.match(/\.([a-z0-9]{1,5})$/i)
  return m?.[1]?.toLowerCase() ?? null
}

/**
 * Download a Telegram file and persist it to chat-media. Returns null on any
 * failure so the caller can still insert the message without media metadata.
 *
 * IMPORTANT: `downloadUrl` contains the bot token | never log it.
 */
export async function storeTelegramMedia(
  params: StoreTelegramMediaParams,
  pathHint?: string,
): Promise<MediaAttachment | null> {
  const {
    downloadUrl,
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
    const res = await fetch(downloadUrl)
    if (!res.ok) {
      console.error(`[telegram/storage] fetch failed: HTTP ${res.status}`)
      return null
    }
    const ab = await res.arrayBuffer()
    const buffer = Buffer.from(ab)
    const size = buffer.byteLength

    const ext = mimeToExt(mimeType) === 'bin' ? (extFromPath(pathHint) ?? 'bin') : mimeToExt(mimeType)
    const timestamp = Date.now()
    const filename = `${timestamp}-${idx}.${ext}`
    const path = `${orgId}/${conversationId}/${messageId}/${filename}`

    const supabase = createServiceRoleClient()
    const { error } = await supabase.storage
      .from('chat-media')
      .upload(path, buffer, { contentType: mimeType, upsert: false })

    if (error) {
      console.error('[telegram/storage] upload error:', error.message)
      return null
    }

    const publicUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/chat-media/${path}`

    const out: MediaAttachment = {
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
    console.error('[telegram/storage] unexpected error:', err)
    return null
  }
}
