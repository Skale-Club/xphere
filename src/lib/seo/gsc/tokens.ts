// Access tokens for an org's Search Console grant, refreshed on demand.
//
// A dead grant (invalid_grant: revoked, password change, or the 7-day expiry
// of an unverified "Testing" OAuth app) flips the integration to
// health_status='disconnected', which is what the SEO UI keys its
// "Reconnect" banner on. Works with the service-role client (cron) and the
// user client (dashboard actions) alike.

import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt, encrypt } from '@/lib/crypto'
import type { Database, Json } from '@/types/database'
import { GoogleOAuthError, refreshGscToken, type GscTokenBlob } from './oauth'

type Sb = SupabaseClient<Database>

export class GscNotConnectedError extends Error {
  constructor(message = 'Google Search Console is not connected for this organization.') {
    super(message)
    this.name = 'GscNotConnectedError'
  }
}

/** Refresh this long before expiry so a token never dies mid-request. */
const EXPIRY_SKEW_MS = 2 * 60 * 1000

export async function getGscAccessToken(sb: Sb, orgId: string): Promise<string> {
  const { data: row } = await sb
    .from('integrations')
    .select('id, encrypted_api_key, config, health_status, is_active')
    .eq('organization_id', orgId)
    .eq('provider', 'google_search_console')
    .maybeSingle()
  if (!row || !row.is_active) throw new GscNotConnectedError()
  if (row.health_status === 'disconnected') throw new GscNotConnectedError('Google Search Console access expired. Reconnect it.')

  const blob = JSON.parse(await decrypt(row.encrypted_api_key)) as GscTokenBlob
  const config = (row.config ?? {}) as { token_expiry?: string; google_email?: string | null }
  const expiry = config.token_expiry ? new Date(config.token_expiry).getTime() : 0
  if (blob.access_token && expiry - EXPIRY_SKEW_MS > Date.now()) return blob.access_token

  if (!blob.refresh_token) {
    await markDisconnected(sb, row.id, 'No refresh token stored; reconnect required.')
    throw new GscNotConnectedError('Google Search Console access expired. Reconnect it.')
  }

  try {
    const fresh = await refreshGscToken(blob.refresh_token)
    const next: GscTokenBlob = { access_token: fresh.access_token, refresh_token: fresh.refresh_token ?? blob.refresh_token }
    await sb
      .from('integrations')
      .update({
        encrypted_api_key: await encrypt(JSON.stringify(next)),
        config: { ...config, token_expiry: new Date(Date.now() + fresh.expires_in * 1000).toISOString() } as Json,
        health_status: 'connected',
        last_checked_at: new Date().toISOString(),
        last_error: null,
        failure_count: 0,
      })
      .eq('id', row.id)
    return fresh.access_token
  } catch (err) {
    if (err instanceof GoogleOAuthError && err.code === 'invalid_grant') {
      await markDisconnected(sb, row.id, err.message)
      throw new GscNotConnectedError('Google Search Console access expired. Reconnect it.')
    }
    throw err
  }
}

/** Flag a dead grant so the UI asks for a reconnect instead of failing silently. */
export async function markDisconnected(sb: Sb, integrationId: string, error: string) {
  await sb
    .from('integrations')
    .update({ health_status: 'disconnected', last_error: error.slice(0, 500), last_checked_at: new Date().toISOString() })
    .eq('id', integrationId)
}
