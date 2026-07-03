'use client'

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'

/**
 * URL-driven detail sheet for the Calls timeline. The server page renders it
 * (with server-component children) only when `?call={id}` is present; closing
 * strips the param so the timeline keeps its filters and scroll context.
 */
export function CallDetailSheet({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()

  const close = React.useCallback(() => {
    const params = new URLSearchParams(Array.from(sp.entries()))
    params.delete('call')
    router.replace(`${pathname}${params.toString() ? `?${params.toString()}` : ''}`)
  }, [router, pathname, sp])

  return (
    <Sheet open onOpenChange={(open) => { if (!open) close() }}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto p-5 sm:max-w-2xl"
      >
        <SheetTitle className="sr-only">Call details</SheetTitle>
        {children}
      </SheetContent>
    </Sheet>
  )
}
