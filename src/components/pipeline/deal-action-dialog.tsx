'use client'

import * as React from 'react'
import { Plus, Link2 } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { NewOpportunityDialog } from './new-opportunity-dialog'
import { OpportunityLinkerDialog } from './opportunity-linker-dialog'

interface DealActionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  pipelineId: string
  contactId: string
  onLinked?: () => void
}

export function DealActionDialog({
  open,
  onOpenChange,
  pipelineId,
  contactId,
  onLinked,
}: DealActionDialogProps) {
  const [mode, setMode] = React.useState<'menu' | 'create' | 'link'>('menu')

  React.useEffect(() => {
    if (!open) setMode('menu')
  }, [open])

  if (mode === 'create') {
    return (
      <NewOpportunityDialog
        pipelineId={pipelineId}
        defaultContactId={contactId}
      >
        <span className="hidden" />
      </NewOpportunityDialog>
    )
  }

  if (mode === 'link') {
    return (
      <OpportunityLinkerDialog
        open={true}
        onOpenChange={(o) => {
          if (!o) {
            setMode('menu')
            onOpenChange(false)
          }
        }}
        contactId={contactId}
        onLinked={() => {
          setMode('menu')
          onOpenChange(false)
          onLinked?.()
        }}
      />
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New deal</DialogTitle>
          <DialogDescription>
            What do you want to do?
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 pt-2">
          <button
            type="button"
            onClick={() => setMode('create')}
            className="flex items-center gap-3 rounded-[10px] border border-border-subtle bg-bg-secondary px-4 py-3 text-left transition-colors hover:border-border-strong hover:bg-bg-tertiary/40"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-accent-muted text-accent">
              <Plus className="h-4 w-4" />
            </div>
            <div>
              <div className="text-[13px] font-medium text-text-primary">Create new deal</div>
              <div className="text-[11px] text-text-tertiary">Start a fresh opportunity for this contact.</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setMode('link')}
            className="flex items-center gap-3 rounded-[10px] border border-border-subtle bg-bg-secondary px-4 py-3 text-left transition-colors hover:border-border-strong hover:bg-bg-tertiary/40"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-bg-tertiary text-text-secondary ring-1 ring-border-subtle">
              <Link2 className="h-4 w-4" />
            </div>
            <div>
              <div className="text-[13px] font-medium text-text-primary">Link existing deal</div>
              <div className="text-[11px] text-text-tertiary">Attach this contact to an existing deal.</div>
            </div>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
