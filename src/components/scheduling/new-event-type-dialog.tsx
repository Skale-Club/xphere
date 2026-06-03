'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus, Users, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { EventTypeForm } from './event-type-form'
import { createEventType } from '@/app/(dashboard)/scheduling/_actions/event-types'

type BookingType = 'personal' | 'round_robin'

const BOOKING_TYPES: {
  value: BookingType
  icon: React.ReactNode
  label: string
  description: string
  example: string
}[] = [
  {
    value: 'personal',
    icon: <User className="h-5 w-5 text-indigo-400" />,
    label: 'Personal booking',
    description: 'Schedules one-on-one meetings with a specific team member.',
    example: 'E.g.: Client meetings, private consultations.',
  },
  {
    value: 'round_robin',
    icon: <Users className="h-5 w-5 text-indigo-400" />,
    label: 'Round robin',
    description: 'Distributes appointments among team members in a rotating order.',
    example: 'E.g.: Sales calls, onboarding sessions.',
  },
]

export function NewEventTypeDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'type' | 'form'>('type')
  const [bookingType, setBookingType] = useState<BookingType>('personal')
  const [isPending, startTransition] = useTransition()

  function handleOpen() {
    setStep('type')
    setBookingType('personal')
    setOpen(true)
  }

  function handleTypeSelect(type: BookingType) {
    setBookingType(type)
    setStep('form')
  }

  async function handleSubmit(
    values: Parameters<React.ComponentProps<typeof EventTypeForm>['onSubmit']>[0],
  ) {
    startTransition(async () => {
      const result = await createEventType({
        ...values,
        booking_type: bookingType,
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
      <Button size="sm" onClick={handleOpen} className="gap-1.5">
        <Plus className="h-3.5 w-3.5" /> New event type
      </Button>

      <Dialog open={open} onOpenChange={(o) => { if (!o) setOpen(false) }}>
        <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
          {step === 'type' ? (
            <>
              <DialogHeader className="mb-2">
                <DialogTitle>Choose event type</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-3">
                {BOOKING_TYPES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => handleTypeSelect(t.value)}
                    className={cn(
                      'flex items-start gap-3 rounded-[12px] border p-4 text-left transition-colors',
                      'border-border bg-bg-secondary hover:border-accent/50 hover:bg-accent/5',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    )}
                  >
                    <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-indigo-500/10">
                      {t.icon}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-semibold text-text-primary">{t.label}</p>
                      <p className="mt-0.5 text-[12.5px] text-text-secondary leading-snug">
                        {t.description}
                      </p>
                      <p className="mt-1 text-[11.5px] text-text-tertiary">{t.example}</p>
                    </div>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <DialogHeader className="mb-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setStep('type')}
                    className="text-[12px] text-text-tertiary hover:text-text-primary transition-colors"
                  >
                    ← Back
                  </button>
                </div>
                <DialogTitle>
                  {bookingType === 'personal' ? 'Personal booking' : 'Round robin'}
                </DialogTitle>
              </DialogHeader>
              <EventTypeForm
                onSubmit={handleSubmit}
                loading={isPending}
                submitLabel="Create"
              />
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
