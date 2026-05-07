'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { createClient, getUser } from '@/lib/supabase/server'
import {
  GOOGLE_OAUTH_STATE_COOKIE,
  GOOGLE_OAUTH_STATE_MAX_AGE_SECONDS,
  buildGoogleOAuthUrl,
} from '@/lib/google-contacts/oauth'

const GOOGLE_STATE_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: GOOGLE_OAUTH_STATE_MAX_AGE_SECONDS, // 600 seconds (10 minutes) per D-10
}

// D-07: server action generates CSRF state, sets cookie, redirects to Google consent URL
export async function connectGoogleContacts(): Promise<never> {
  const user = await getUser()

  if (!user) {
    redirect('/login')
  }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id') // D-09: always resolve from session

  if (!orgId) {
    redirect('/integrations/google-contacts?error=no_org')
  }

  const state = crypto.randomUUID()
  const jar = await cookies()
  jar.set(GOOGLE_OAUTH_STATE_COOKIE, state, GOOGLE_STATE_COOKIE_OPTIONS)

  redirect(buildGoogleOAuthUrl(state))
}

// D-11: delete the integrations row for provider='google_contacts' for the current org
export async function disconnectGoogleContacts(): Promise<{ error?: string }> {
  const user = await getUser()

  if (!user) {
    return { error: 'Not authenticated.' }
  }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')

  if (!orgId) {
    return { error: 'No active organization.' }
  }

  const { error } = await supabase
    .from('integrations')
    .delete()
    .eq('organization_id', orgId)
    .eq('provider', 'google_contacts')

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/integrations')
  revalidatePath('/integrations/google-contacts')

  return {}
}
