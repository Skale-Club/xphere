// src/lib/chat/store-media.ts
// Generic helper to download a URL and upload to Supabase Storage bucket `chat-media`.
// SEED-030: Chat Rich Messages

import { createServiceRoleClient } from '@/lib/supabase/admin'

interface StoreMediaParams {
  url: string
  mimeType: string
  authHeaders?: Record<string, string>
  orgId: string
  conversationId: string
  messageId: string
  /** Index when storing multiple attachments from one message. Defaults to 0. */
  idx?: number
  /** Optional timestamp override for the filename (defaults to Date.now()). */
  timestamp?: number
}

interface StoredMedia {
  publicUrl: string
  size: number
  filename: string
}

/** Maps MIME types to file extensions. */
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
    'application/pdf': 'pdf',
  }
  return map[base] ?? 'bin'
}

/**
 * Downloads the media from `url` (optionally with auth headers) and uploads it
 * to the Supabase Storage bucket `chat-media`. Returns the public URL, file
 * size in bytes, and filename. Returns null on any error | callers must handle
 * graceful degradation.
 */
export async function storeMediaFromUrl(params: StoreMediaParams): Promise<StoredMedia | null> {
  const { url, mimeType, authHeaders, orgId, conversationId, messageId, idx = 0 } = params
  const timestamp = params.timestamp ?? Date.now()

  try {
    const fetchOptions: RequestInit = {}
    if (authHeaders && Object.keys(authHeaders).length > 0) {
      fetchOptions.headers = authHeaders
    }

    const response = await fetch(url, fetchOptions)
    if (!response.ok) {
      console.error(
        `[chat/store-media] Failed to fetch ${url}: HTTP ${response.status}`
      )
      return null
    }

    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const size = buffer.byteLength

    const ext = mimeToExt(mimeType)
    const filename = `${timestamp}-${idx}.${ext}`
    const path = `${orgId}/${conversationId}/${messageId}/${filename}`

    const supabase = createServiceRoleClient()
    const { error } = await supabase.storage
      .from('chat-media')
      .upload(path, buffer, {
        contentType: mimeType,
        upsert: false,
      })

    if (error) {
      console.error('[chat/store-media] Upload error:', error.message)
      return null
    }

    const publicUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/chat-media/${path}`

    return { publicUrl, size, filename }
  } catch (err) {
    console.error('[chat/store-media] Unexpected error:', err)
    return null
  }
}
