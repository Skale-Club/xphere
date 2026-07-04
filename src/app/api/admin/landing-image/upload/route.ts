export const runtime = 'nodejs'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { getUser } from '@/lib/supabase/server'

const ALLOWED = new Set(['image/png', 'image/webp', 'image/jpeg', 'image/svg+xml'])
const MAX_BYTES = 8 * 1024 * 1024 // matches bucket file_size_limit set in 1050_landing_config.sql
const KIND_FOLDERS: Record<string, string> = {
  cta: 'landing',
  scroll: 'landing/scroll',
}

export async function POST(request: Request) {
  try {
    const user = await getUser()
    if (!user || user.email !== process.env.PLATFORM_ADMIN_EMAIL) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const kind = (formData.get('kind') as string | null) ?? 'cta'

    if (!file) return Response.json({ error: 'No file provided' }, { status: 400 })
    if (!KIND_FOLDERS[kind]) {
      return Response.json({ error: 'Invalid kind. Use "cta" or "scroll".' }, { status: 400 })
    }
    if (!ALLOWED.has(file.type)) {
      return Response.json({ error: 'Invalid file type. Allowed: PNG, WEBP, JPEG, SVG.' }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return Response.json({ error: 'File too large. Max 8 MB.' }, { status: 400 })
    }

    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'webp'
    const filename = kind === 'cta' ? 'cta-bg' : `scroll-${Date.now()}`
    const path = `${KIND_FOLDERS[kind]}/${filename}.${ext}`
    const bytes = await file.arrayBuffer()

    const admin = createServiceRoleClient()
    const { error: uploadError } = await admin.storage
      .from('branding')
      .upload(path, bytes, { contentType: file.type, upsert: true })

    if (uploadError) throw uploadError

    const {
      data: { publicUrl },
    } = admin.storage.from('branding').getPublicUrl(path)

    // Add a cache-buster so admins see their replacement immediately.
    const url = `${publicUrl}?v=${Date.now()}`
    return Response.json({ url })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upload failed'
    return Response.json({ error: message }, { status: 500 })
  }
}
