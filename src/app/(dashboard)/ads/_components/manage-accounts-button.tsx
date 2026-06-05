'use client'

import * as React from 'react'
import { SlidersHorizontal } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ManageAccountsDialog } from './manage-accounts-dialog'

export function ManageAccountsButton({ platform }: { platform: 'meta' | 'google' }) {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-text-secondary hover:text-text-primary"
              onClick={() => setOpen(true)}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Manage accounts</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <ManageAccountsDialog platform={platform} open={open} onOpenChange={setOpen} />
    </>
  )
}
