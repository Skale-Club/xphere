export const runtime = 'nodejs'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { getUser } from '@/lib/supabase/server'

const ALLOWED = new Set([
  'image/png',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/svg+xml',
  'image/webp',
  'image/jpeg',
])
const MAX_BYTES = 2 * 1024 * 1024

export async function POST(request: Request) {
  try {
    const user = await getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return Response.json({ error: 'No file provided' }, { status: 400 })

    if (!ALLOWED.has(file.type)) {
      return Response.json(
        { error: 'Invalid file type. Allowed: PNG, ICO, SVG, WEBP, JPEG.' },
        { status: 400 }
      )
    }
    if (file.size > MAX_BYTES) {
      return Response.json({ error: 'File too large. Max 2 MB.' }, { status: 400 })
    }

    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'png'
    const path = `favicon/favicon-${Date.now()}.${ext}`
    const bytes = await file.arrayBuffer()

    const admin = createServiceRoleClient()
    const { error: uploadError } = await admin.storage
      .from('branding')
      .upload(path, bytes, { contentType: file.type, upsert: true })

    if (uploadError) throw uploadError

    const {
      data: { publicUrl },
    } = admin.storage.from('branding').getPublicUrl(path)

    return Response.json({ url: publicUrl })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upload failed'
    return Response.json({ error: message }, { status: 500 })
  }
}
