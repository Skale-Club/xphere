import { notFound } from 'next/navigation'
import { format, parseISO } from 'date-fns'
import { CheckCircle2, XCircle } from 'lucide-react'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { cancelBookingByToken } from '@/app/(dashboard)/scheduling/_actions/bookings'

interface Props {
  params: Promise<{ id: string }>
  searchParams: Promise<{ token?: string }>
}

export default async function CancelBookingPage({ params, searchParams }: Props) {
  const { id } = await params
  const { token } = await searchParams

  if (!token) notFound()

  const supabase = createServiceRoleClient()

  // Fetch booking details before cancelling
  const { data: booking } = await supabase
    .from('bookings')
    .select('id, booker_name, start_at, end_at, status, event_type_id, cancel_token')
    .eq('id', id)
    .maybeSingle()

  if (!booking || booking.cancel_token !== token) notFound()

  // Fetch event type title
  const { data: et } = await supabase
    .from('event_types')
    .select('title')
    .eq('id', booking.event_type_id)
    .maybeSingle()

  const alreadyCancelled = booking.status === 'cancelled'

  let cancelled = alreadyCancelled
  let errorMsg: string | null = null

  if (!alreadyCancelled) {
    const result = await cancelBookingByToken(id, token)
    if (!result.ok) {
      errorMsg = result.error
    } else {
      cancelled = true
    }
  }

  const startDate = format(parseISO(booking.start_at), 'EEEE, MMMM d, yyyy')
  const startTime = format(parseISO(booking.start_at), 'HH:mm')

  return (
    <div className="dark min-h-screen bg-[#08090A] flex items-start justify-center pt-16 px-4">
      <div className="w-full max-w-md">
        <div className="rounded-xl border border-[#2A2A2F] bg-[#111113] p-8 text-center space-y-4">
          {errorMsg ? (
            <>
              <div className="h-14 w-14 rounded-full bg-red-500/10 flex items-center justify-center mx-auto">
                <XCircle className="h-8 w-8 text-red-400" />
              </div>
              <h1 className="text-xl font-semibold text-[#FAFAFA]">Could not cancel</h1>
              <p className="text-sm text-[#A1A1AA]">{errorMsg}</p>
            </>
          ) : cancelled ? (
            <>
              <div className="h-14 w-14 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto">
                <CheckCircle2 className="h-8 w-8 text-emerald-400" />
              </div>
              <h1 className="text-xl font-semibold text-[#FAFAFA]">
                {alreadyCancelled ? 'Already cancelled' : 'Booking cancelled'}
              </h1>
              <div className="text-sm text-[#A1A1AA] space-y-1">
                {et?.title && <p className="font-medium text-[#FAFAFA]">{et.title}</p>}
                <p>
                  {startDate} at {startTime}
                </p>
                <p>Hi {booking.booker_name}, your booking has been cancelled.</p>
              </div>
            </>
          ) : null}
        </div>

        <div className="flex items-center justify-center gap-1.5 text-center text-xs text-[#52525B] mt-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/api/pwa/icons/32" alt="" width={14} height={14} className="rounded-[3px] opacity-70" />
          Powered by Xphere Scheduling
        </div>
      </div>
    </div>
  )
}
