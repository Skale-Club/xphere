'use client'

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

/**
 * URL-driven detail dialog for the Calls timeline. The server page renders it
 * (with server-component children) only when `?call={id}` is present; closing
 * strips the param so the timeline keeps its filters and scroll context.
 */
export function CallDetailDialog({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()

  const close = React.useCallback(() => {
    const params = new URLSearchParams(Array.from(sp.entries()))
    params.delete('call')
    router.replace(`${pathname}${params.toString() ? `?${params.toString()}` : ''}`)
  }, [router, pathname, sp])

  return (
    <Dialog open onOpenChange={(open) => { if (!open) close() }}>
      <DialogContent className="max-h-[88vh] w-[calc(100vw-2rem)] overflow-y-auto p-5 sm:max-w-[960px]">
        <DialogTitle className="sr-only">Call details</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  )
}
