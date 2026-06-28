// src/app/api/admin/ads-playbook/upload/route.ts
// Super-admin file upload for the GLOBAL ads playbook.
// Stores into the private `ads-playbook` bucket at {platform}/{uuid}.{ext}.
// Caller (client) then invokes the insertPlaybookSource server action.

import { getUser } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { randomUUID } from 'crypto'

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024 // 10MB

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/csv',
])

const PLATFORMS = new Set(['meta', 'google', 'global'])

export async function POST(request: Request): Promise<Response> {
  const user = await getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.email !== process.env.PLATFORM_ADMIN_EMAIL) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return Response.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  const platform = String(formData.get('platform') ?? '')
  if (!file) return Response.json({ error: 'No file provided' }, { status: 400 })
  if (!PLATFORMS.has(platform)) return Response.json({ error: 'Invalid platform' }, { status: 400 })

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return Response.json({ error: 'File exceeds 10MB limit' }, { status: 400 })
  }
  if (!ALLOWED_MIME_TYPES.has(file.type) && !file.name.endsWith('.txt') && !file.name.endsWith('.csv')) {
    return Response.json({ error: 'Unsupported file type. Use PDF, TXT, or CSV.' }, { status: 400 })
  }

  const serviceClient = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )

  const fileExt = file.name.split('.').pop() ?? 'bin'
  const storagePath = `${platform}/${randomUUID()}.${fileExt}`
  const arrayBuffer = await file.arrayBuffer()

  const { error: storageError } = await serviceClient.storage
    .from('ads-playbook')
    .upload(storagePath, arrayBuffer, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    })

  if (storageError) {
    return Response.json({ error: `Storage upload failed: ${storageError.message}` }, { status: 500 })
  }

  return Response.json({ path: storagePath, name: file.name })
}
