'use server'

import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { verifyTurnstile } from '@/lib/auth/verify-turnstile'
import { mapSupabaseError, type AuthErrorCode } from '@/lib/auth/errors'

export type AuthActionResult =
  | { ok: true; hasSession: boolean }
  | { ok: false; errorCode: AuthErrorCode; errorMessage?: string }

interface EmailPasswordInput {
  email: string
  password: string
  captchaToken: string | null
}

interface SignUpInput extends EmailPasswordInput {
  emailRedirectTo?: string
}

/**
 * Mirrors the cookie written by /auth/callback/route.ts so that email-based
 * logins have org context available on the very first dashboard render without
 * requiring a fallback RPC call.
 */
async function setActiveOrgCookie(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<void> {
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('id', orgId)
    .single()
  if (!org) return
  const jar = await cookies()
  jar.set('vo_active_org', JSON.stringify({ id: org.id, name: org.name }), {
    path: '/',
    sameSite: 'lax',
    httpOnly: false,
    maxAge: 60 * 60 * 24 * 30, // 30 days
  })
}

async function getRemoteIp(): Promise<string | null> {
  const h = await headers()
  return (
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    h.get('x-real-ip') ||
    null
  )
}

export async function signInWithEmail(
  input: EmailPasswordInput,
): Promise<AuthActionResult> {
  const remoteIp = await getRemoteIp()
  const { success } = await verifyTurnstile(input.captchaToken, remoteIp)
  if (!success) {
    return { ok: false, errorCode: 'captcha_failed' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({
    email: input.email,
    password: input.password,
  })

  if (error) {
    return {
      ok: false,
      errorCode: 'unknown_error',
      errorMessage: mapSupabaseError(error.message),
    }
  }

  if (data.session) {
    await setActiveOrgCookie(supabase)
    redirect('/dashboard')
  }

  return { ok: true, hasSession: false }
}

export async function signUpWithEmail(
  input: SignUpInput,
): Promise<AuthActionResult> {
  const remoteIp = await getRemoteIp()
  const { success } = await verifyTurnstile(input.captchaToken, remoteIp)
  if (!success) {
    return { ok: false, errorCode: 'captcha_failed' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: input.emailRedirectTo
      ? { emailRedirectTo: input.emailRedirectTo }
      : undefined,
  })

  if (error) {
    return {
      ok: false,
      errorCode: 'unknown_error',
      errorMessage: mapSupabaseError(error.message),
    }
  }

  if (data.session) {
    await setActiveOrgCookie(supabase)
    redirect('/dashboard')
  }

  return { ok: true, hasSession: false }
}
