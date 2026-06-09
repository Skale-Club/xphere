// src/lib/contacts/store-avatar.ts
// Re-hosts an external contact profile picture (e.g. an Instagram/Facebook CDN
// URL relayed by Zernio) into the public `avatars` Supabase Storage bucket, so
// it survives the source URL's signed expiry and never needs a 3rd-party token
// at view time. Mirrors the manual upload in contacts/actions.ts (sharp → 512²
// webp). Service-role only: keyed by org_id (bypasses the user-scoped bucket RLS
// used by the interactive uploader). Returns the public URL, or null on any
// failure (the caller treats avatars as best-effort / non-fatal).

import sharp from 'sharp'
import type { createServiceRoleClient } from '@/lib/supabase/admin'

const AVATAR_BUCKET = 'avatars'
const FETCH_TIMEOUT_MS = 8000

export async function storeContactAvatarFromUrl(params: {
  supabase: ReturnType<typeof createServiceRoleClient>
  orgId: string
  contactId: string
  sourceUrl: string
}): Promise<string | null> {
  const { supabase, orgId, contactId, sourceUrl } = params
  if (!orgId || !contactId || !sourceUrl) return null

  try {
    const res = await fetch(sourceUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!res.ok) {
      console.warn(`[contacts/avatar] fetch failed ${res.status} for contact ${contactId}`)
      return null
    }
    const input = Buffer.from(await res.arrayBuffer())

    const processed = await sharp(input)
      .rotate() // honour EXIF orientation
      .resize(512, 512, { fit: 'cover', position: 'attention' })
      .webp({ quality: 82 })
      .toBuffer()

    const nonce = Math.random().toString(36).slice(2, 10)
    const objectPath = `${orgId}/contacts/${contactId}-${nonce}.webp`

    const { error: uploadErr } = await supabase.storage
      .from(AVATAR_BUCKET)
      .upload(objectPath, processed, {
        contentType: 'image/webp',
        upsert: false,
        cacheControl: '3600',
      })
    if (uploadErr) {
      console.warn('[contacts/avatar] upload failed:', uploadErr.message)
      return null
    }

    const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(objectPath)
    return data?.publicUrl || null
  } catch (err) {
    console.warn('[contacts/avatar] store failed:', err instanceof Error ? err.message : String(err))
    return null
  }
}
