'use server'

import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { mapSupabaseError, type AuthErrorCode } from '@/lib/auth/errors'

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

/**
 * These actions deliberately do NOT call `redirect()` on success.
 *
 * A `redirect()` inside a server action makes the Next router REJECT the
 * action's promise on the client with a NEXT_REDIRECT error (see
 * server-action-reducer: "the action promise will be rejected with a redirect").
 * In the login dialog that rejection propagated through react-hook-form, which
 * reset `isSubmitting` and re-enabled the "Sign in" button while /dashboard was
 * still rendering — inviting a second submit and a second session. Returning
 * `{ ok: true, hasSession: true }` lets the dialog keep its "Signing you in…"
 * state up and drive the navigation itself.
 */
export type AuthActionResult =
  | { ok: true; hasSession: boolean }
  | { ok: false; errorCode: AuthErrorCode; errorMessage?: string }

interface EmailPasswordInput {
  email: string
  password: string
}

interface SignUpInput extends EmailPasswordInput {
  emailRedirectTo?: string
}

export async function signInWithEmail(
  input: EmailPasswordInput,
): Promise<AuthActionResult> {
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
    return { ok: true, hasSession: true }
  }

  return { ok: true, hasSession: false }
}

export async function signUpWithEmail(
  input: SignUpInput,
): Promise<AuthActionResult> {
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
    return { ok: true, hasSession: true }
  }

  return { ok: true, hasSession: false }
}
