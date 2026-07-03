'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Megaphone, Settings2, Smartphone } from 'lucide-react'

import { Button } from '@/components/ui/button'

/**
 * Action row for the single-page Calls module: personal My Phone modal for
 * everyone, org Voice Settings modal for managers, and a cross-link to the
 * multi-channel Campaigns module.
 */
export function CallsHeaderActions({ canManage }: { canManage: boolean }) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()

  const openParam = React.useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(Array.from(sp.entries()))
      params.set(key, value)
      router.push(`${pathname}?${params.toString()}`)
    },
    [router, pathname, sp],
  )

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button asChild variant="ghost" size="sm" className="gap-1.5">
        <Link href="/campaigns?channel=calls">
          <Megaphone className="h-3.5 w-3.5" />
          Voice Campaigns
        </Link>
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => openParam('myphone', '1')}
      >
        <Smartphone className="h-3.5 w-3.5" />
        My Phone
      </Button>
      {canManage && (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => openParam('settings', 'numbers')}
        >
          <Settings2 className="h-3.5 w-3.5" />
          Voice Settings
        </Button>
      )}
    </div>
  )
}
