'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { NewFlowForm } from './new-flow-form'

interface NewWorkflowButtonProps {
  label?: string
  className?: string
  iconOnly?: boolean
}

export function NewWorkflowButton({
  label = 'New workflow',
  className,
  iconOnly = false,
}: NewWorkflowButtonProps) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className={className} aria-label={iconOnly ? label : undefined}>
          <Plus className="h-3.5 w-3.5" />
          {!iconOnly && label}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Create a new workflow</DialogTitle>
          <DialogDescription>
            Give it a name and slug. You can edit nodes and triggers right after.
          </DialogDescription>
        </DialogHeader>
        <NewFlowForm onCreated={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  )
}
