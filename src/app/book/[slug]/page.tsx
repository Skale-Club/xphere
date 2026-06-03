import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Clock, Video, Phone, MapPin, Link2, CalendarDays } from 'lucide-react'
import { createServiceRoleClient } from '@/lib/supabase/admin'

const LOCATION_ICONS: Record<string, React.ElementType> = {
  google_meet: Video,
  zoom: Video,
  whereby: Video,
  custom_link: Link2,
  video: Video,
  phone_call: Phone,
  custom_phone: Phone,
  phone: Phone,
  store_location: MapPin,
  client_address: MapPin,
  custom_address: MapPin,
  in_person: MapPin,
}

const LOCATION_LABELS: Record<string, string> = {
  google_meet: 'Google Meet',
  zoom: 'Zoom',
  whereby: 'Whereby',
  custom_link: 'Video link',
  video: 'Video call',
  phone_call: 'Phone call',
  custom_phone: 'Phone call',
  phone: 'Phone call',
  store_location: 'In person',
  client_address: 'Client address',
  custom_address: 'In person',
  in_person: 'In person',
}

interface Props {
  params: Promise<{ slug: string }>
}

export default async function PublicBookingProfilePage({ params }: Props) {
  const { slug } = await params

  const supabase = createServiceRoleClient()

  // Resolve profile by slug
  const { data: profile } = await supabase
    .from('scheduling_profiles')
    .select('user_id, timezone')
    .eq('slug', slug)
    .single()

  if (!profile) notFound()

  // Fetch host display name
  const { data: authUser } = await supabase.auth.admin.getUserById(profile.user_id)
  const meta = (authUser?.user?.user_metadata ?? {}) as Record<string, unknown>
  const hostName: string =
    (typeof meta.full_name === 'string' && meta.full_name) ||
    (typeof meta.name === 'string' && meta.name) ||
    authUser?.user?.email?.split('@')[0] ||
    'Host'

  // Fetch all active event types for this user
  const { data: eventTypes } = await supabase
    .from('event_types')
    .select('id, title, slug, description, duration_minutes, color, location_type, allowed_location_kinds')
    .eq('user_id', profile.user_id)
    .eq('active', true)
    .order('created_at', { ascending: true })

  const types = eventTypes ?? []

  return (
    <div className="dark min-h-screen bg-[#08090A] flex items-start justify-center pt-10 px-4 pb-16">
      <div className="w-full max-w-xl">
        {/* Profile header */}
        <div className="text-center mb-8 space-y-2">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600/20 border border-indigo-500/30 text-xl font-semibold text-indigo-300 mb-3">
            {hostName.charAt(0).toUpperCase()}
          </div>
          <h1 className="text-xl font-semibold text-[#FAFAFA]">{hostName}</h1>
          <p className="text-sm text-[#71717A]">{profile.timezone}</p>
        </div>

        {/* Event types list */}
        {types.length === 0 ? (
          <div className="rounded-xl border border-[#2A2A2F] bg-[#111113] p-10 text-center space-y-2">
            <CalendarDays className="mx-auto h-8 w-8 text-[#52525B]" />
            <p className="text-sm text-[#A1A1AA]">No meeting types available.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {types.map((et) => {
              const primaryKind = (et.allowed_location_kinds as string[] | null)?.[0] ?? et.location_type
              const LocationIcon = LOCATION_ICONS[primaryKind] ?? Video
              const locationLabel = LOCATION_LABELS[primaryKind] ?? primaryKind

              return (
                <Link
                  key={et.id}
                  href={`/book/${slug}/${et.slug}`}
                  className="group block rounded-xl border border-[#2A2A2F] bg-[#111113] overflow-hidden hover:border-[#3F3F46] transition-colors"
                >
                  <div className="h-1" style={{ backgroundColor: et.color }} />
                  <div className="p-5 flex items-center gap-4">
                    <div
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                      style={{ backgroundColor: `${et.color}20` }}
                    >
                      <CalendarDays className="h-5 w-5" style={{ color: et.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h2 className="text-[15px] font-semibold text-[#FAFAFA] group-hover:text-white transition-colors">
                        {et.title}
                      </h2>
                      {et.description && (
                        <p className="mt-0.5 text-xs text-[#71717A] line-clamp-1">{et.description}</p>
                      )}
                      <div className="mt-1.5 flex items-center gap-3 text-xs text-[#A1A1AA]">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {et.duration_minutes} min
                        </span>
                        <span className="flex items-center gap-1">
                          <LocationIcon className="h-3 w-3" />
                          {locationLabel}
                        </span>
                      </div>
                    </div>
                    <div className="text-[#52525B] group-hover:text-[#A1A1AA] transition-colors shrink-0">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}

        <a
          href="https://xphere.app"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 text-center text-xs text-[#52525B] mt-8 transition-colors hover:text-[#A1A1AA]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/api/pwa/icons/32" alt="" width={14} height={14} className="rounded-[3px] opacity-70" />
          Powered by Xphere Scheduling
        </a>
      </div>
    </div>
  )
}
