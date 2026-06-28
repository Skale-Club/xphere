import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

import { encrypt } from '@/lib/crypto'
import {
  exchangeNotionCode,
  NOTION_OAUTH_STATE_COOKIE,
} from '@/lib/notion/client'
import { resolveRequestOrigin } from '@/lib/site-url'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { getUser } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const CLEAR_COOKIE = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 0,
}

function redirect(request: NextRequest, path: string): NextResponse {
  const response = NextResponse.redirect(new URL(path, resolveRequestOrigin(request)))
  response.cookies.set(NOTION_OAUTH_STATE_COOKIE, '', CLEAR_COOKIE)
  return response
}

export async function GET(request: NextRequest): Promise<Response> {
  const user = await getUser()
  if (!user) return redirect(request, '/')
  if (user.email !== process.env.PLATFORM_ADMIN_EMAIL) return redirect(request, '/dashboard')

  const url = new URL(request.url)
  const error = url.searchParams.get('error')
  if (error) return redirect(request, `/admin/knowledge?notion_error=${encodeURIComponent(error)}`)

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const storedState = (await cookies()).get(NOTION_OAUTH_STATE_COOKIE)?.value
  if (!code) return redirect(request, '/admin/knowledge?notion_error=missing_code')
  if (!state || !storedState || state !== storedState) {
    return redirect(request, '/admin/knowledge?notion_error=csrf')
  }

  try {
    const tokens = await exchangeNotionCode(code)
    const supabase = createServiceRoleClient()
    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null
    await supabase
      .from('global_knowledge_notion_connections')
      .update({ status: 'disconnected', updated_at: new Date().toISOString() })
      .neq('workspace_id', tokens.workspace_id)
      .neq('status', 'disconnected')
    const { error: upsertError } = await supabase
      .from('global_knowledge_notion_connections')
      .upsert({
        workspace_id: tokens.workspace_id,
        workspace_name: tokens.workspace_name,
        workspace_icon: tokens.workspace_icon,
        bot_id: tokens.bot_id,
        owner_user_id: tokens.owner.user?.id ?? null,
        encrypted_access_token: await encrypt(tokens.access_token),
        encrypted_refresh_token: tokens.refresh_token
          ? await encrypt(tokens.refresh_token)
          : null,
        token_expires_at: expiresAt,
        status: 'connected',
        error_detail: null,
        created_by: user.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'workspace_id' })
    if (upsertError) throw new Error(upsertError.message)

    return redirect(request, '/admin/knowledge?notion=connected')
  } catch (callbackError) {
    console.error(
      '[notion/callback] OAuth exchange failed:',
      callbackError instanceof Error ? callbackError.message : callbackError,
    )
    return redirect(request, '/admin/knowledge?notion_error=oauth_exchange')
  }
}
