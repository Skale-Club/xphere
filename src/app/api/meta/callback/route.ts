import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

import { encrypt } from '@/lib/crypto'
import {
  META_OAUTH_STATE_COOKIE,
  META_OAUTH_STATE_MAX_AGE_SECONDS,
  exchangeCodeForShortLivedToken,
  exchangeShortLivedTokenForLongLivedToken,
  fetchInstagramBusinessAccount,
  fetchMetaPages,
} from '@/lib/meta/oauth'
import { createClient, getUser } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

export const runtime = 'nodejs'

const META_STATE_COOKIE_CLEAR_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 0,
}

function buildRedirect(request: NextRequest, path: string) {
  return NextResponse.redirect(new URL(path, request.url))
}

async function clearStateCookie() {
  const jar = await cookies()
  jar.set(META_OAUTH_STATE_COOKIE, '', META_STATE_COOKIE_CLEAR_OPTIONS)
}

type ExistingMetaChannel = Pick<
  Database['public']['Tables']['meta_channels']['Row'],
  'page_id' | 'channel_type' | 'automation_id' | 'webhook_verified'
>

export async function GET(request: NextRequest): Promise<Response> {
  const user = await getUser()

  if (!user) {
    return buildRedirect(request, '/login')
  }

  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const jar = await cookies()
  const storedState = jar.get(META_OAUTH_STATE_COOKIE)?.value

  await clearStateCookie()

  if (!code) {
    return buildRedirect(request, '/integrations/meta?error=missing_code')
  }

  if (!state || !storedState || state !== storedState) {
    return buildRedirect(request, '/integrations/meta?error=csrf')
  }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')

  if (!orgId) {
    return buildRedirect(request, '/integrations/meta?error=no_org')
  }

  try {
    const shortLivedToken = await exchangeCodeForShortLivedToken(code)
    const longLivedToken = await exchangeShortLivedTokenForLongLivedToken(shortLivedToken.access_token)
    const pages = await fetchMetaPages(longLivedToken.access_token)

    const existingRowsResponse = pages.length
      ? await supabase
          .from('meta_channels')
          .select('page_id, channel_type, automation_id, webhook_verified')
          .in('page_id', pages.map((page) => page.id))
      : { data: [] satisfies ExistingMetaChannel[], error: null }

    if (existingRowsResponse.error) {
      throw new Error(existingRowsResponse.error.message)
    }

    const existingRows = new Map(
      (existingRowsResponse.data ?? []).map((row) => [`${row.page_id}:${row.channel_type}`, row])
    )

    const instagramAccounts = await Promise.all(
      pages.map(async (page) => ({
        pageId: page.id,
        account: await fetchInstagramBusinessAccount(page.id, page.accessToken),
      }))
    )

    const instagramByPageId = new Map(
      instagramAccounts.map((entry) => [entry.pageId, entry.account])
    )

    const lastSyncedAt = new Date().toISOString()
    const rows: Database['public']['Tables']['meta_channels']['Insert'][] = []

    for (const page of pages) {
      const encryptedPageAccessToken = await encrypt(page.accessToken)
      const messengerExisting = existingRows.get(`${page.id}:messenger`)
      const instagramAccount = instagramByPageId.get(page.id) ?? null

      rows.push({
        org_id: orgId,
        channel_type: 'messenger',
        page_id: page.id,
        page_name: page.name,
        ig_account_id: null,
        ig_username: instagramAccount?.username ?? null,
        encrypted_page_access_token: encryptedPageAccessToken,
        token_expires_at: null,
        is_active: true,
        webhook_verified: messengerExisting?.webhook_verified ?? false,
        last_synced_at: lastSyncedAt,
        connection_error: null,
        automation_id: messengerExisting?.automation_id ?? null,
      })

      if (instagramAccount?.id) {
        const instagramExisting = existingRows.get(`${page.id}:instagram`)

        rows.push({
          org_id: orgId,
          channel_type: 'instagram',
          page_id: page.id,
          page_name: page.name,
          ig_account_id: instagramAccount.id,
          ig_username: instagramAccount.username,
          encrypted_page_access_token: encryptedPageAccessToken,
          token_expires_at: null,
          is_active: true,
          webhook_verified: instagramExisting?.webhook_verified ?? false,
          last_synced_at: lastSyncedAt,
          connection_error: null,
          automation_id: instagramExisting?.automation_id ?? null,
        })
      }
    }

    if (rows.length > 0) {
      const { error } = await supabase
        .from('meta_channels')
        .upsert(rows, { onConflict: 'org_id,page_id,channel_type' })

      if (error) {
        throw new Error(error.message)
      }
    }

    return buildRedirect(request, '/integrations/meta?connected=true')
  } catch {
    return buildRedirect(request, '/integrations/meta?error=oauth_exchange')
  }
}
