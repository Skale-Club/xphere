import { redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase/server'
import { UpdatePasswordForm } from './update-password-form'

export const metadata = {
  title: 'Set a new password',
  robots: { index: false, follow: false },
}

/**
 * Landing page for the "Forgot password" email link.
 *
 * The reset email points at /auth/callback?next=/auth/update-password. The
 * callback exchanges the recovery code into a session and forwards here, so the
 * user arrives authenticated (recovery session) and can set a new password.
 * If somebody reaches this page without a session, send them home.
 */
export default async function UpdatePasswordPage() {
  const user = await getUser()
  if (!user) redirect('/')

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#08090A] px-4">
      <div className="w-full max-w-[400px] rounded-2xl border border-white/10 bg-[#0c0d0f] p-6 shadow-[0_16px_40px_rgba(0,0,0,0.7)]">
        <div className="mb-6 text-center">
          <h1 className="text-[1.25rem] font-semibold tracking-[-0.02em] text-[#FAFAFA]">
            Set a new password
          </h1>
          <p className="mt-0.5 text-[0.8125rem] text-[#71717A]">
            Choose a new password for {user.email}
          </p>
        </div>
        <UpdatePasswordForm />
      </div>
    </div>
  )
}
