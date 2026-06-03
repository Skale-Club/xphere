'use client'

import * as React from 'react'
import { SlidersHorizontal } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ManageAccountsDialog } from './manage-accounts-dialog'

export function ManageAccountsButton({ platform }: { platform: 'meta' | 'google' }) {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" />
        Manage accounts
      </Button>
      <ManageAccountsDialog platform={platform} open={open} onOpenChange={setOpen} />
    </>
  )
}
