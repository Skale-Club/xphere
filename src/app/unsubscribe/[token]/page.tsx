// Public unsubscribe page. Verifies the signed token, records the opt-out in
// email_unsubscribes (service role — RLS bypassed), best-effort marks any
// matching campaign_recipients as 'unsubscribed', and confirms.
//
// Unauthenticated. Mirrors the public booking page pattern (service role
// client + root layout).

import { verifyUnsubscribeToken } from '@/lib/email/unsubscribe-token'
import { recordUnsubscribe } from '@/lib/email/unsubscribe'

export const dynamic = 'force-dynamic'

export default async function UnsubscribePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const parsed = await verifyUnsubscribeToken(token)

  let ok = false
  let email = ''
  if (parsed) {
    email = parsed.email
    try {
      await recordUnsubscribe(parsed.orgId, parsed.email, 'link')
      ok = true
    } catch {
      ok = false
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg-primary px-4">
      <div className="w-full max-w-md rounded-[14px] border border-border bg-bg-secondary p-8 text-center shadow-elevation-md">
        {ok ? (
          <>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6">
                <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h1 className="text-[18px] font-semibold text-text-primary">You&apos;ve been unsubscribed</h1>
            <p className="mt-2 text-[13px] text-text-secondary">
              {email ? <><span className="font-medium text-text-primary">{email}</span> won&apos;t</> : 'You won&apos;t'}{' '}
              receive marketing emails from this sender anymore.
            </p>
          </>
        ) : (
          <>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/15 text-rose-400">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6">
                <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h1 className="text-[18px] font-semibold text-text-primary">Link expired or invalid</h1>
            <p className="mt-2 text-[13px] text-text-secondary">
              This unsubscribe link couldn&apos;t be verified. Reply to the email and ask to be
              removed, and the sender will take care of it.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
