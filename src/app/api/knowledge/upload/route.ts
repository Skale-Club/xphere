// src/app/api/knowledge/upload/route.ts
// Route Handler for file upload | avoids server action 1MB body limit.
// DOES NOT run embedding inline | returns immediately with storagePath.
// Caller (client component) then invokes insertDocument server action.

import { createClient as createServerClient, getUser } from '@/lib/supabase/server'
import * as storage from '@/lib/storage'
import { randomUUID } from 'crypto'

// Do NOT set runtime = 'edge' | formData() requires Node.js runtime
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024 // 10MB

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/csv',
])

export async function POST(request: Request): Promise<Response> {
  const user = await getUser()
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabaseUser = await createServerClient()
  const { data: membership } = await supabaseUser
    .from('org_members')
    .select('organization_id')
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return Response.json({ error: 'No organization found' }, { status: 403 })
  }

  const organizationId = membership.organization_id

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return Response.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  if (!file) {
    return Response.json({ error: 'No file provided' }, { status: 400 })
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return Response.json({ error: 'File exceeds 10MB limit' }, { status: 400 })
  }

  if (!ALLOWED_MIME_TYPES.has(file.type) && !file.name.endsWith('.txt') && !file.name.endsWith('.csv')) {
    return Response.json({ error: 'Unsupported file type. Use PDF, TXT, or CSV.' }, { status: 400 })
  }

  const fileExt = file.name.split('.').pop() ?? 'bin'
  const storagePath = `${organizationId}/${randomUUID()}.${fileExt}`
  const arrayBuffer = await file.arrayBuffer()

  // Supabase Storage, or R2 once knowledge-docs is enabled there
  const { error: storageError } = await storage.put('knowledge-docs', storagePath, arrayBuffer, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  })

  if (storageError) {
    return Response.json({ error: `Storage upload failed: ${storageError.message}` }, { status: 500 })
  }

  return Response.json({
    path: storagePath,
    name: file.name,
    organizationId,
  })
}
