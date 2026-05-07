import { encrypt, decrypt } from '@/lib/crypto'
import type { Json } from '@/types/database'
import type { ActionContext } from '@/lib/action-engine/execute-action'

export interface GoogleOAuthTokens {
  access_token: string
  refresh_token: string
  google_email?: string
  integrationId: string
}

export async function resolveGoogleCredentials(ctx: ActionContext): Promise<GoogleOAuthTokens> {
  const { data: row, error } = await ctx.supabase
    .from('integrations')
    .select('id, encrypted_api_key')
    .eq('organization_id', ctx.organizationId)
    .eq('provider', 'google_contacts')
    .single()

  if (error || !row) {
    throw new Error('Google Contacts not connected for this org. Connect via /integrations.')
  }

  const blob = JSON.parse(await decrypt(row.encrypted_api_key)) as {
    access_token: string
    refresh_token: string
    google_email?: string
  }

  return {
    access_token: blob.access_token,
    refresh_token: blob.refresh_token,
    google_email: blob.google_email,
    integrationId: row.id,
  }
}

export async function callWithRefresh(
  access_token: string,
  refresh_token: string,
  integrationId: string,
  ctx: ActionContext,
  apiFn: (token: string) => Promise<Response>
): Promise<Response> {
  let res = await apiFn(access_token)

  if (res.status !== 401) return res

  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    refresh_token,
    grant_type: 'refresh_token',
  })

  const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    cache: 'no-store',
  })

  if (!refreshRes.ok) {
    throw new Error('Google token refresh failed — reconnect via /integrations.')
  }

  const refreshData = (await refreshRes.json()) as { access_token: string; expires_in: number }

  const newBlob = {
    access_token: refreshData.access_token,
    refresh_token,
  }

  const newExpiry = Date.now() + refreshData.expires_in * 1000

  await ctx.supabase
    .from('integrations')
    .update({
      encrypted_api_key: await encrypt(JSON.stringify(newBlob)),
      config: { token_expiry: newExpiry } as unknown as Json,
    })
    .eq('id', integrationId)

  return apiFn(refreshData.access_token)
}
