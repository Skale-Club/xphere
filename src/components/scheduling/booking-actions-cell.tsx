'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cancelBooking } from '@/app/(dashboard)/scheduling/_actions/bookings'

export function BookingActionsCell({ bookingId }: { bookingId: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function handleCancel() {
    if (!confirm('Cancel this booking?')) return
    startTransition(async () => {
      const result = await cancelBooking(bookingId)
      if (!result.ok) toast.error(result.error)
      else {
        toast.success('Booking cancelled')
        router.refresh()
      }
    })
  }

  return (
    <Button
      size="icon"
      variant="ghost"
      className="h-7 w-7 text-red-400 hover:text-red-300 shrink-0"
      onClick={handleCancel}
      disabled={isPending}
      title="Cancel booking"
    >
      <XCircle className="h-4 w-4" />
    </Button>
  )
}
