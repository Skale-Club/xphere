import { decrypt, encrypt } from '@/lib/crypto'
import { refreshNotionTokens } from '@/lib/notion/client'
import { createServiceRoleClient } from '@/lib/supabase/admin'

type ConnectionRow = {
  id: string
  encrypted_access_token: string
  encrypted_refresh_token: string | null
  token_expires_at: string | null
}

const REFRESH_SKEW_MS = 5 * 60 * 1000

export async function resolveNotionAccessToken(connection: ConnectionRow): Promise<string> {
  const accessToken = await decrypt(connection.encrypted_access_token)
  const expiresAt = connection.token_expires_at
    ? new Date(connection.token_expires_at).getTime()
    : Number.POSITIVE_INFINITY

  if (expiresAt - Date.now() > REFRESH_SKEW_MS) return accessToken
  if (!connection.encrypted_refresh_token) return accessToken

  const refreshToken = await decrypt(connection.encrypted_refresh_token)
  const refreshed = await refreshNotionTokens(refreshToken)
  const nextRefreshToken = refreshed.refresh_token ?? refreshToken
  const nextExpiresAt = refreshed.expires_in
    ? new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
    : null

  const supabase = createServiceRoleClient()
  const { error } = await supabase
    .from('global_knowledge_notion_connections')
    .update({
      encrypted_access_token: await encrypt(refreshed.access_token),
      encrypted_refresh_token: await encrypt(nextRefreshToken),
      token_expires_at: nextExpiresAt,
      status: 'connected',
      error_detail: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', connection.id)
  if (error) throw new Error(`Failed to persist refreshed Notion token: ${error.message}`)

  return refreshed.access_token
}

