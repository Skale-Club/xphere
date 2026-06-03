'use server'

// Upload a custom image to use as a project-folder icon. The image is squared,
// downscaled and re-encoded to a small webp, stored in the public `avatars`
// bucket, and its public URL returned. The caller persists the URL via
// updateFolderMeta({ icon: url }).

import { createClient, getUser } from '@/lib/supabase/server'

const MAX_BYTES = 4 * 1024 * 1024 // 4MB
const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
])

type Result = { ok: true; url: string } | { ok: false; error: string }

export async function uploadFolderIcon(formData: FormData): Promise<Result> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const file = formData.get('file')
  if (!(file instanceof File)) return { ok: false, error: 'Missing file' }
  if (file.size === 0) return { ok: false, error: 'Empty file' }
  if (file.size > MAX_BYTES) return { ok: false, error: 'File too large (max 4MB)' }
  if (!ALLOWED_MIME.has(file.type)) return { ok: false, error: 'Unsupported image type' }

  const arrayBuffer = await file.arrayBuffer()
  const sharp = (await import('sharp')).default
  let processed: Buffer
  try {
    processed = await sharp(Buffer.from(arrayBuffer))
      .rotate() // honour EXIF orientation
      .resize(128, 128, { fit: 'cover', position: 'attention' })
      .webp({ quality: 82 })
      .toBuffer()
  } catch {
    return { ok: false, error: 'Could not process image' }
  }

  const supabase = await createClient()
  const nonce = Math.random().toString(36).slice(2, 10)
  const objectPath = `${user.id}/folder-icons/${nonce}.webp`

  const { error: uploadErr } = await supabase.storage
    .from('avatars')
    .upload(objectPath, processed, {
      contentType: 'image/webp',
      upsert: false,
      cacheControl: '3600',
    })
  if (uploadErr) return { ok: false, error: uploadErr.message }

  const { data } = supabase.storage.from('avatars').getPublicUrl(objectPath)
  if (!data.publicUrl) return { ok: false, error: 'Could not resolve public URL' }
  return { ok: true, url: data.publicUrl }
}
