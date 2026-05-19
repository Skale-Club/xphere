'use client'

import { useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { createBooking } from '@/app/(dashboard)/scheduling/_actions/bookings'
import type { TimeSlot } from '@/lib/scheduling/slots'

const schema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  email: z.string().email('Valid email required'),
  phone: z.string().max(30).optional(),
  notes: z.string().max(2000).optional(),
})

type FormValues = z.infer<typeof schema>

interface BookingFormProps {
  eventTypeId: string
  slot: TimeSlot
  onSuccess: (bookingId: string, cancelToken: string) => void
}

export function BookingForm({ eventTypeId, slot, onSuccess }: BookingFormProps) {
  const [isPending, startTransition] = useTransition()

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', email: '', phone: '', notes: '' },
  })

  function handleSubmit(values: FormValues) {
    startTransition(async () => {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
      const result = await createBooking({
        event_type_id: eventTypeId,
        start_at: slot.start,
        booker_name: values.name,
        booker_email: values.email,
        booker_phone: values.phone,
        booker_timezone: timezone,
        notes: values.notes,
      })

      if (!result.ok) {
        if (result.error === 'slot_taken') {
          toast.error('This slot was just taken — please pick another time.')
        } else {
          toast.error(result.error)
        }
        return
      }

      onSuccess(result.data.id, result.data.cancel_token)
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        <FormField control={form.control} name="name" render={({ field }) => (
          <FormItem>
            <FormLabel>Your name</FormLabel>
            <FormControl><Input placeholder="Jane Smith" {...field} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <FormField control={form.control} name="email" render={({ field }) => (
          <FormItem>
            <FormLabel>Email</FormLabel>
            <FormControl><Input type="email" placeholder="jane@example.com" {...field} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <FormField control={form.control} name="phone" render={({ field }) => (
          <FormItem>
            <FormLabel>Phone <span className="text-muted-foreground text-xs">(optional)</span></FormLabel>
            <FormControl><Input type="tel" placeholder="+55 11 99999-9999" {...field} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <FormField control={form.control} name="notes" render={({ field }) => (
          <FormItem>
            <FormLabel>Notes <span className="text-muted-foreground text-xs">(optional)</span></FormLabel>
            <FormControl><Textarea placeholder="Anything you'd like to share before the meeting…" rows={3} className="resize-none" {...field} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <Button type="submit" disabled={isPending} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white">
          {isPending ? 'Confirming…' : 'Confirm booking'}
        </Button>
      </form>
    </Form>
  )
}
