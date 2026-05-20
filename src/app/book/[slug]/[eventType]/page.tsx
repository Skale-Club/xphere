import { notFound } from 'next/navigation'
import { Clock, MapPin, Phone, Video, CalendarCheck } from 'lucide-react'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { BookingPageClient } from '@/components/scheduling/booking-page-client'

const LOCATION_ICONS = { video: Video, phone: Phone, in_person: MapPin }
const LOCATION_LABELS = { video: 'Video call', phone: 'Phone call', in_person: 'In person' }

interface Props {
  params: Promise<{ slug: string; eventType: string }>
}

export default async function PublicBookingPage({ params }: Props) {
  const { slug, eventType: eventTypeSlug } = await params

  const supabase = createServiceRoleClient()

  // Resolve profile by slug
  const { data: profile } = await supabase
    .from('scheduling_profiles')
    .select('user_id, timezone, org_id')
    .eq('slug', slug)
    .single()

  if (!profile) notFound()

  // Resolve event type
  const { data: et } = await supabase
    .from('event_types')
    .select('id, title, slug, description, duration_minutes, color, location_type, location_value, active')
    .eq('user_id', profile.user_id)
    .eq('slug', eventTypeSlug)
    .eq('active', true)
    .single()

  if (!et) notFound()

  // Fetch available days of week
  const { data: availability } = await supabase
    .from('user_availability')
    .select('day_of_week')
    .eq('user_id', profile.user_id)

  const availableDows = (availability ?? []).map((a) => a.day_of_week)
  const LocationIcon = LOCATION_ICONS[et.location_type as keyof typeof LOCATION_ICONS] ?? Video

  return (
    <div className="dark min-h-screen bg-[#08090A] flex items-start justify-center pt-10 px-4">
      <div className="w-full max-w-3xl">
        {/* Event type info */}
        <div className="rounded-xl border border-[#2A2A2F] bg-[#111113] overflow-hidden">
          <div className="h-2" style={{ backgroundColor: et.color }} />
          <div className="p-6 md:p-8 grid md:grid-cols-[260px_1fr] gap-8">
            {/* Left sidebar — event info */}
            <div className="space-y-4">
              <div>
                <h1 className="text-xl font-semibold text-[#FAFAFA]">{et.title}</h1>
                {et.description && (
                  <p className="mt-1 text-sm text-[#A1A1AA]">{et.description}</p>
                )}
              </div>
              <div className="space-y-2 text-sm text-[#A1A1AA]">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 shrink-0" />
                  {et.duration_minutes} minutes
                </div>
                <div className="flex items-center gap-2">
                  <LocationIcon className="h-4 w-4 shrink-0" />
                  {LOCATION_LABELS[et.location_type as keyof typeof LOCATION_LABELS] ?? et.location_type}
                </div>
                {et.location_value && et.location_type !== 'phone' && (
                  <div className="text-xs text-[#71717A] pl-6 truncate">{et.location_value}</div>
                )}
              </div>
            </div>

            {/* Right — booking UI (client) */}
            <BookingPageClient
              eventTypeId={et.id}
              availableDows={availableDows}
              durationMinutes={et.duration_minutes}
              color={et.color}
            />
          </div>
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
