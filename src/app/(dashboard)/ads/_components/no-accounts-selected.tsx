'use client'

import * as React from 'react'
import { LayoutGrid } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ManageAccountsDialog } from './manage-accounts-dialog'

/**
 * Shown when a platform is connected but no ad accounts are selected for the
 * org yet — prompts the admin to pick which accounts should appear.
 */
export function NoAccountsSelected({ platform }: { platform: 'meta' | 'google' }) {
  const [open, setOpen] = React.useState(false)
  const label = platform === 'meta' ? 'Meta Ads' : 'Google Ads'

  return (
    <div className="flex flex-col items-center justify-center gap-4 p-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-bg-secondary">
        <LayoutGrid className="h-5 w-5 text-text-tertiary" />
      </div>
      <div>
        <h2 className="text-[15px] font-semibold text-text-primary">Pick your ad accounts</h2>
        <p className="mt-1 max-w-sm text-[13px] text-text-secondary">
          {label} is connected. Choose which ad accounts should appear in this workspace — the rest
          stay connected but hidden.
        </p>
      </div>
      <Button onClick={() => setOpen(true)}>Select ad accounts</Button>
      <ManageAccountsDialog platform={platform} open={open} onOpenChange={setOpen} />
    </div>
  )
}
