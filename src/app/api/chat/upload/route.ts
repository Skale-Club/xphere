// POST /api/chat/upload — uploads a file to the chat-media Supabase Storage bucket.
// SEED-030: Chat Rich Messages
//
// Accepts multipart/form-data with a `file` field.
// Validates: auth, file size (max 5MB), and MIME type (image/*, audio/*, video/*, application/pdf).
// Uses the service role client for Storage uploads (bypasses RLS on the bucket).
// Returns { url: string } — the public URL of the uploaded file.

import { getUser } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const MAX_SIZE_BYTES = 5 * 1024 * 1024 // 5 MB

const ALLOWED_MIME_PREFIXES = ['image/', 'audio/', 'video/']
const ALLOWED_EXACT_TYPES = ['application/pdf']

function isAllowedMime(mimeType: string): boolean {
  if (ALLOWED_EXACT_TYPES.includes(mimeType)) return true
  return ALLOWED_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix))
}

export async function POST(request: Request): Promise<Response> {
  // Auth check
  const user = await getUser()
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Resolve org ID via authenticated supabase client
  const supabase = await createClient()
  const { data: orgData } = await supabase.rpc('get_current_org_id' as never)
  const orgId = (orgData as string | null) ?? 'unknown'

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return Response.json({ error: 'Invalid multipart form data' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!file || !(file instanceof File)) {
    return Response.json({ error: 'Missing file field' }, { status: 400 })
  }

  // Validate MIME type
  const mimeType = file.type || 'application/octet-stream'
  if (!isAllowedMime(mimeType)) {
    return Response.json(
      { error: 'Invalid file type. Allowed: images, audio, video, PDF.' },
      { status: 400 }
    )
  }

  // Validate file size
  if (file.size > MAX_SIZE_BYTES) {
    return Response.json(
      { error: 'File too large. Maximum size is 5 MB.' },
      { status: 400 }
    )
  }

  // Sanitize filename (prevent path traversal)
  const rawName = file.name ?? 'upload'
  const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200)
  const path = `${orgId}/${Date.now()}/${safeName}`

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  try {
    const adminClient = createServiceRoleClient()
    const { error } = await adminClient.storage
      .from('chat-media')
      .upload(path, buffer, {
        contentType: mimeType,
        upsert: false,
      })

    if (error) {
      console.error('[chat/upload] Storage upload error:', error.message)
      return Response.json({ error: 'Upload failed' }, { status: 500 })
    }

    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/chat-media/${path}`
    return Response.json({ url }, { status: 200 })
  } catch (err) {
    console.error('[chat/upload] Unexpected error:', err)
    return Response.json({ error: 'Upload failed' }, { status: 500 })
  }
}
