'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import { EventTypeForm } from './event-type-form'
import { createEventType } from '@/app/(dashboard)/scheduling/_actions/event-types'

export function NewEventTypeDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  async function handleSubmit(values: Parameters<React.ComponentProps<typeof EventTypeForm>['onSubmit']>[0]) {
    startTransition(async () => {
      const result = await createEventType({
        ...values,
        duration_minutes: values.duration_minutes,
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
      <Button size="sm" onClick={() => setOpen(true)} className="gap-1.5">
        <Plus className="h-3.5 w-3.5" /> New event type
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle>New event type</SheetTitle>
          </SheetHeader>
          <EventTypeForm onSubmit={handleSubmit} loading={isPending} submitLabel="Create" />
        </SheetContent>
      </Sheet>
    </>
  )
}
