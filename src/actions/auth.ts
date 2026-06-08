'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { mapSupabaseError, type AuthErrorCode } from '@/lib/auth/errors'

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
    redirect('/dashboard')
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
    redirect('/dashboard')
  }

  return { ok: true, hasSession: false }
}
