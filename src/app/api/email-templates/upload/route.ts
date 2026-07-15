// POST /api/email-templates/upload | uploads an image to the email-assets bucket.
// v3.4 Email Editor Overhaul.
//
// Accepts multipart/form-data with a `file` field.
// Validates: auth, file size (max 10MB), and MIME type (raster images only —
// PNG/JPEG/GIF/WebP. SVG is deliberately excluded: it's script-capable
// content (<script>, event handler attributes, external references) served
// from a public bucket, which is a stored-XSS vector for anyone who can
// guess/enumerate an asset URL).
// Uses the service-role client for Storage uploads (bypasses RLS on the bucket).
// Returns { url: string } | the public URL of the uploaded image.
//
// The email-assets bucket is public (migration 1234) so the returned URL renders
// inside composed email HTML — email clients have no Supabase session, so images
// MUST be reachable without auth headers.

import { getUser } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { checkUploadQuota } from '@/lib/email/upload-quota'

export const runtime = 'nodejs'

const MAX_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB
const ALLOWED_MIME = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]

export async function POST(request: Request): Promise<Response> {
  const user = await getUser()
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

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

  const mimeType = file.type || 'application/octet-stream'
  if (!ALLOWED_MIME.includes(mimeType)) {
    return Response.json(
      { error: 'Invalid file type. Allowed: PNG, JPEG, GIF, WebP.' },
      { status: 400 }
    )
  }

  if (file.size > MAX_SIZE_BYTES) {
    return Response.json(
      { error: 'File too large. Maximum size is 10 MB.' },
      { status: 400 }
    )
  }

  // Sanitize filename (prevent path traversal).
  const rawName = file.name ?? 'image'
  const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200)
  const path = `${orgId}/${Date.now()}-${safeName}`

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  try {
    const adminClient = createServiceRoleClient()

    // Per-org quota (Finding #8): cap object count and cumulative bytes so a
    // single org can't unbounded-grow the shared public bucket.
    // Invariant: this single list({ limit: 1000 }) page is only correct while
    // MAX_UPLOAD_OBJECTS (500) < 1000 — raising the cap past the page size
    // requires paginating here.
    const { data: existing, error: listError } = await adminClient.storage
      .from('email-assets')
      .list(orgId, { limit: 1000 })

    if (listError) {
      console.error('[email-templates/upload] Quota list error:', listError.message)
      return Response.json({ error: 'Upload failed' }, { status: 500 })
    }

    const quota = checkUploadQuota(
      (existing ?? []).map((obj) => ({ sizeBytes: obj.metadata?.size ?? 0 })),
    )
    if (!quota.ok) {
      return Response.json({ error: quota.error }, { status: 400 })
    }

    const { error } = await adminClient.storage
      .from('email-assets')
      .upload(path, buffer, {
        contentType: mimeType,
        upsert: false,
      })

    if (error) {
      console.error('[email-templates/upload] Storage upload error:', error.message)
      return Response.json({ error: 'Upload failed' }, { status: 500 })
    }

    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/email-assets/${path}`
    return Response.json({ url }, { status: 200 })
  } catch (err) {
    console.error('[email-templates/upload] Unexpected error:', err)
    return Response.json({ error: 'Upload failed' }, { status: 500 })
  }
}
