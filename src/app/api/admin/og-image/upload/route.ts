export const runtime = 'nodejs'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { getUser } from '@/lib/supabase/server'

const ALLOWED = new Set(['image/png', 'image/webp', 'image/jpeg'])
const MAX_BYTES = 8 * 1024 * 1024

export async function POST(request: Request) {
  try {
    const user = await getUser()
    if (!user || user.email !== process.env.PLATFORM_ADMIN_EMAIL) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return Response.json({ error: 'No file provided' }, { status: 400 })

    if (!ALLOWED.has(file.type)) {
      return Response.json(
        { error: 'Invalid file type. Allowed: PNG, WEBP, JPEG.' },
        { status: 400 }
      )
    }
    if (file.size > MAX_BYTES) {
      return Response.json({ error: 'File too large. Max 8 MB.' }, { status: 400 })
    }

    const ext = file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1]
    const path = `seo/og-image-${Date.now()}.${ext}`
    const bytes = await file.arrayBuffer()
    const admin = createServiceRoleClient()
    const { error: uploadError } = await admin.storage
      .from('branding')
      .upload(path, bytes, {
        contentType: file.type,
        cacheControl: '31536000',
        upsert: false,
      })

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
