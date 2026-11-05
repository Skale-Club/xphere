// src/lib/meta/media.ts
// Downloads a Meta CDN attachment and re-hosts it in the Supabase Storage
// `chat-media` bucket. Returns the public URL + metadata, or null on any
// failure (so callers can insert the message text without media gracefully).
// SEED-032.

import * as storage from '@/lib/storage'

interface DownloadMetaMediaParams {
  url: string
  mimeType: string
  pageToken: string
  orgId: string
  conversationId: string
  messageId: string
  index: number
}

interface DownloadedMetaMedia {
  url: string
  mimeType: string
  size: number
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
    'application/pdf': 'pdf',
    'application/octet-stream': 'bin',
  }
  return map[base] ?? 'bin'
}

/**
 * Fetches a Meta CDN URL and stores it in the `chat-media` bucket. Meta CDN
 * URLs are usually signed and accessible without auth; if the first request
 * returns 401 we retry once with the page access token as a query param.
 * Returns null on any error.
 */
export async function downloadMetaMedia(
  params: DownloadMetaMediaParams,
): Promise<DownloadedMetaMedia | null> {
  const {
    url,
    mimeType: declaredMime,
    pageToken,
    orgId,
    conversationId,
    messageId,
    index,
  } = params

  try {
    let response = await fetch(url)

    if (response.status === 401 || response.status === 403) {
      const authedUrl = url.includes('?')
        ? `${url}&access_token=${encodeURIComponent(pageToken)}`
        : `${url}?access_token=${encodeURIComponent(pageToken)}`
      response = await fetch(authedUrl)
    }

    if (!response.ok) {
      console.error(
        `[meta/media] fetch ${url} failed: HTTP ${response.status}`,
      )
      return null
    }

    const headerMime = response.headers.get('content-type')?.split(';')[0].trim()
    const mimeType =
      headerMime && headerMime !== 'application/octet-stream'
        ? headerMime
        : declaredMime

    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const size = buffer.byteLength

    const ts = Date.now()
    const ext = mimeToExt(mimeType)
    const path = `${orgId}/${conversationId}/${messageId}/${ts}-${index}.${ext}`

    const { error } = await storage.put('chat-media', path, buffer, { contentType: mimeType, upsert: false })

    if (error) {
      console.error('[meta/media] upload error:', error.message)
      return null
    }

    // Supabase public URL today; the session-gated /api/media path once chat-media is on R2.
    const publicUrl = storage.storedMediaUrl('chat-media', path)

    return { url: publicUrl, mimeType, size }
  } catch (err) {
    console.error('[meta/media] unexpected error:', err)
    return null
  }
}
