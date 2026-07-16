import { notFound } from 'next/navigation'
import { format, parseISO } from 'date-fns'
import { CheckCircle2, XCircle } from 'lucide-react'
import { revalidatePath } from 'next/cache'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { cancelBookingByToken } from '@/app/(dashboard)/calendar/_actions/bookings'

interface Props {
  params: Promise<{ id: string }>
  searchParams: Promise<{ token?: string }>
}

export default async function CancelBookingPage({ params, searchParams }: Props) {
  const { id } = await params
  const { token } = await searchParams

  if (!token) notFound()

  const supabase = createServiceRoleClient()

  // Read-only fetch. No mutation happens during GET render -- cancellation
  // only happens via the POST form action below (CAL-03).
  const { data: booking } = await supabase
    .from('bookings')
    .select('id, booker_name, start_at, end_at, status, event_type_id, cancel_token')
    .eq('id', id)
    .maybeSingle()

  if (!booking || booking.cancel_token !== token) notFound()

  const { data: et } = await supabase
    .from('event_types')
    .select('title')
    .eq('id', booking.event_type_id)
    .maybeSingle()

  const alreadyCancelled = booking.status === 'cancelled'
  const startDate = format(parseISO(booking.start_at), 'EEEE, MMMM d, yyyy')
  const startTime = format(parseISO(booking.start_at), 'HH:mm')

  async function confirmCancel() {
    'use server'
    const result = await cancelBookingByToken(id, token!)
    if (result.ok) {
      revalidatePath(`/book/cancel/${id}`)
    }
    // On failure (e.g. a concurrent cancel already landed), the next render
    // simply re-reads booking.status fresh -- self-healing, no error branch
    // needed.
  }

  return (
    <div className="dark min-h-screen bg-[#08090A] flex items-start justify-center pt-16 px-4">
      <div className="w-full max-w-md">
        <div className="rounded-xl border border-[#2A2A2F] bg-[#111113] p-8 text-center space-y-4">
          {alreadyCancelled ? (
            <>
              <div className="h-14 w-14 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto">
                <CheckCircle2 className="h-8 w-8 text-emerald-400" />
              </div>
              <h1 className="text-xl font-semibold text-[#FAFAFA]">Already cancelled</h1>
              <div className="text-sm text-[#A1A1AA] space-y-1">
                {et?.title && <p className="font-medium text-[#FAFAFA]">{et.title}</p>}
                <p>{startDate} at {startTime}</p>
                <p>Hi {booking.booker_name}, this booking has already been cancelled.</p>
              </div>
            </>
          ) : (
            <>
              <div className="h-14 w-14 rounded-full bg-red-500/10 flex items-center justify-center mx-auto">
                <XCircle className="h-8 w-8 text-red-400" />
              </div>
              <h1 className="text-xl font-semibold text-[#FAFAFA]">Cancel this booking?</h1>
              <div className="text-sm text-[#A1A1AA] space-y-1">
                {et?.title && <p className="font-medium text-[#FAFAFA]">{et.title}</p>}
                <p>{startDate} at {startTime}</p>
                <p>Hi {booking.booker_name}, confirm below to cancel this booking.</p>
              </div>
              <form action={confirmCancel}>
                <button
                  type="submit"
                  className="w-full rounded-lg bg-red-500/90 hover:bg-red-500 text-white text-sm font-medium py-2.5 transition-colors"
                >
                  Cancel booking
                </button>
              </form>
            </>
          )}
        </div>

        <a
          href="https://xphere.app"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 text-center text-xs text-[#52525B] mt-6 transition-colors hover:text-[#A1A1AA]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/api/pwa/icons/32" alt="" width={14} height={14} className="rounded-[3px] opacity-70" />
          Powered by Xphere
        </a>
      </div>
    </div>
  )
}
