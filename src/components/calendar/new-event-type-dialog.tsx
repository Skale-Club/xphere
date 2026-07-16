'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { EventTypeForm } from './event-type-form'
import { createEventType } from '@/app/(dashboard)/calendar/_actions/event-types'

interface NewEventTypeDialogProps {
  /** Controlled open state. When provided, the internal trigger can be hidden. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Hide the built-in "New event type" trigger button (controlled usage). */
  hideTrigger?: boolean
}

export function NewEventTypeDialog({ open: controlledOpen, onOpenChange, hideTrigger = false }: NewEventTypeDialogProps = {}) {
  const router = useRouter()
  const isControlled = controlledOpen !== undefined
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = isControlled ? controlledOpen : uncontrolledOpen
  const setOpen = (o: boolean) => {
    if (isControlled) onOpenChange?.(o)
    else setUncontrolledOpen(o)
  }
  const [isPending, startTransition] = useTransition()

  function handleOpen() {
    setOpen(true)
  }

  async function handleSubmit(
    values: Parameters<React.ComponentProps<typeof EventTypeForm>['onSubmit']>[0],
  ) {
    startTransition(async () => {
      // SYNC-04: round-robin removed from customer-facing configuration —
      // zero backing implementation (no team-member table, no rotation
      // state, no assignment-at-booking-time logic; see 130-RESEARCH.md).
      // Every event type created from this dialog is 'personal'. The
      // booking_type column and any pre-existing 'round_robin' rows are
      // left untouched (D-02: data preserved, no migration).
      const result = await createEventType({
        ...values,
        booking_type: 'personal',
        active: true,
      })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success('Event type created')
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <>
      {!hideTrigger && (
        <Button size="sm" onClick={handleOpen} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> New event type
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader className="mb-2">
            <DialogTitle>New event type</DialogTitle>
          </DialogHeader>
          <EventTypeForm
            onSubmit={handleSubmit}
            loading={isPending}
            submitLabel="Create"
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
