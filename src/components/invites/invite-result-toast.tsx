'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'

/**
 * Surfaces the outcome of an invite acceptance (carried via ?invite=… on the
 * post-acceptance redirect) as a toast, then strips the param from the URL so
 * it doesn't re-fire on refresh. Mounted once in the dashboard layout.
 */
export function InviteResultToast() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const shown = useRef(false)

  const outcome = searchParams.get('invite')

  useEffect(() => {
    if (!outcome || shown.current) return
    shown.current = true

    switch (outcome) {
      case 'joined':
        toast.success('Invitation accepted — welcome!')
        break
      case 'mismatch': {
        const forEmail = searchParams.get('for')
        toast.error(
          forEmail
            ? `This invitation is for ${forEmail}. Sign out and sign in with that account to accept it.`
            : 'This invitation is for a different account. Sign out and sign in with the invited account.',
          { duration: 8000 },
        )
        break
      }
      case 'expired':
        toast.error('This invitation has expired. Ask an admin to resend it.')
        break
      case 'invalid':
        toast.error('This invitation link is no longer valid.')
        break
      default:
        break
    }

    // Strip invite params from the URL without adding a history entry.
    const params = new URLSearchParams(searchParams.toString())
    params.delete('invite')
    params.delete('for')
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [outcome, searchParams, router, pathname])

  return null
}
