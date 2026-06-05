'use server'

import { createHash, randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient, getUser } from '@/lib/supabase/server'

async function requireOrg() {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated', user: null, orgId: null }
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No active organization', user: null, orgId: null }
  return { error: null, user, orgId: orgId as string }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type ApiKeyRow = {
  id: string
  name: string
  key_prefix: string
  scopes: string[]
  last_used_at: string | null
  created_at: string
}

// ── listApiKeys ───────────────────────────────────────────────────────────────

export async function listApiKeys(): Promise<{ keys: ApiKeyRow[]; error: string | null }> {
  const { error: authError, orgId } = await requireOrg()
  if (authError || !orgId) return { keys: [], error: authError }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('api_keys')
    .select('id, name, key_prefix, scopes, last_used_at, created_at')
    .eq('org_id', orgId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })

  if (error) return { keys: [], error: error.message }
  return { keys: (data ?? []) as ApiKeyRow[], error: null }
}

// ── generateApiKey ────────────────────────────────────────────────────────────

const generateSchema = z.object({ name: z.string().min(1).max(100) })

export async function generateApiKey(
  input: { name: string },
): Promise<{ key: string | null; row: ApiKeyRow | null; error: string | null }> {
  const parsed = generateSchema.safeParse(input)
  if (!parsed.success) return { key: null, row: null, error: parsed.error.errors[0].message }

  const { error: authError, user, orgId } = await requireOrg()
  if (authError || !user || !orgId) return { key: null, row: null, error: authError }

  const raw = 'xph_' + randomBytes(32).toString('hex')
  const hash = createHash('sha256').update(raw).digest('hex')
  const prefix = raw.slice(0, 12)

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('api_keys')
    .insert({
      org_id: orgId,
      name: parsed.data.name,
      key_hash: hash,
      key_prefix: prefix,
      scopes: ['contacts:write'],
      created_by: user.id,
    })
    .select('id, name, key_prefix, scopes, last_used_at, created_at')
    .single()

  if (error || !data) return { key: null, row: null, error: error?.message ?? 'Insert failed' }

  revalidatePath('/settings/api-keys')
  return { key: raw, row: data as ApiKeyRow, error: null }
}

// ── revokeApiKey ──────────────────────────────────────────────────────────────

export async function revokeApiKey(
  id: string,
): Promise<{ error: string | null }> {
  const { error: authError, orgId } = await requireOrg()
  if (authError || !orgId) return { error: authError }

  const supabase = await createClient()
  const { error } = await supabase
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('org_id', orgId)

  if (error) return { error: error.message }
  revalidatePath('/settings/api-keys')
  return { error: null }
}
