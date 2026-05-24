'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { createClient, getUser } from '@/lib/supabase/server'
import {
  META_OAUTH_STATE_COOKIE,
  META_OAUTH_STATE_MAX_AGE_SECONDS,
  buildMetaOAuthUrl,
} from '@/lib/meta/oauth'

const META_STATE_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: META_OAUTH_STATE_MAX_AGE_SECONDS,
}

export async function connectMeta(): Promise<never> {
  const user = await getUser()

  if (!user) {
    redirect('/')
  }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')

  if (!orgId) {
    redirect('/integrations/meta?error=no_org')
  }

  const state = crypto.randomUUID()
  const jar = await cookies()
  jar.set(META_OAUTH_STATE_COOKIE, state, META_STATE_COOKIE_OPTIONS)

  redirect(buildMetaOAuthUrl(state))
}

export async function disconnectMetaChannel(channelId: string): Promise<{ error?: string }> {
  const user = await getUser()

  if (!user) {
    return { error: 'Not authenticated.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('meta_channels')
    .delete()
    .eq('id', channelId)
    .select('id')
    .maybeSingle()

  if (error) {
    return { error: error.message }
  }

  if (!data) {
    return { error: 'Meta channel not found.' }
  }

  revalidatePath('/integrations')
  revalidatePath('/integrations/meta')

  return {}
}

export async function updateMetaChannelAutomation(
  channelId: string,
  automationId: string | null
): Promise<{ error?: string }> {
  const user = await getUser()

  if (!user) {
    return { error: 'Not authenticated.' }
  }

  const supabase = await createClient()
  const normalizedAutomationId = automationId && automationId.trim().length > 0 ? automationId : null

  const { error } = await supabase
    .from('meta_channels')
    .update({ automation_id: normalizedAutomationId })
    .eq('id', channelId)

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/integrations/meta')

  return {}
}
