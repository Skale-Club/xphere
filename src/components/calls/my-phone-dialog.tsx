'use client'

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/**
 * Personal call preferences modal, driven by `?myphone=1`. Content (the
 * CallSettingsForm) is server-rendered by the page and passed as children.
 */
export function MyPhoneDialog({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()

  const close = React.useCallback(() => {
    const params = new URLSearchParams(Array.from(sp.entries()))
    params.delete('myphone')
    router.replace(`${pathname}${params.toString() ? `?${params.toString()}` : ''}`)
  }, [router, pathname, sp])

  return (
    <Dialog open onOpenChange={(open) => { if (!open) close() }}>
      <DialogContent className="max-h-[88vh] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-[15px]">My Phone</DialogTitle>
          <DialogDescription className="text-[12.5px]">
            How you personally receive calls: browser, SIP softphone, or phone forwarding.
          </DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}
