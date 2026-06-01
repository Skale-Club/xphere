'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface ModalShellProps {
  title: string
  description?: string
  fallbackHref?: string
  children: React.ReactNode
}

/**
 * Wraps a page's content in a large auto-opened Dialog with lateral margin.
 * Closing the dialog navigates back, or to `fallbackHref` if there's no
 * history to pop (e.g. user landed via direct URL).
 *
 * Use this for pages that should feel like an overlay on top of the user's
 * current context (settings, admin panels) instead of full-page navigations.
 */
export function ModalShell({
  title,
  description,
  fallbackHref = '/dashboard',
  children,
}: ModalShellProps) {
  const router = useRouter()
  const [open, setOpen] = useState(true)
  const hasHistoryRef = useRef(false)

  useEffect(() => {
    hasHistoryRef.current = window.history.length > 1
  }, [])

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      if (hasHistoryRef.current) {
        router.back()
      } else {
        router.replace(fallbackHref)
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-[70vw] h-[70vh] max-h-[70vh] overflow-y-auto p-0">
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
          {description ? (
            <DialogDescription className="text-xs">{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        <div className="px-6 pb-6">{children}</div>
      </DialogContent>
    </Dialog>
  )
}
