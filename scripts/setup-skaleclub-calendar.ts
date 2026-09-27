#!/usr/bin/env node
// Gives Skale Club a calendar the booking specialist can actually read.
//
//   npx tsx --env-file=.env.local scripts/setup-skaleclub-calendar.ts            # dry run
//   npx tsx --env-file=.env.local scripts/setup-skaleclub-calendar.ts --apply
//
// The org owner already has a calendar profile (slug `vanildo`,
// America/New_York, Google Meet by default) but no availability and no event
// type in THIS org — so every slot query returns nothing and the public page
// has nothing to show. This creates:
//
//   - one event type: a 30-minute intro call over video
//   - Monday to Friday, 09:00-17:00, in the profile's own timezone
//
// Idempotent: re-running updates the event type in place and leaves existing
// availability rows alone rather than stacking duplicates.

import { createClient } from '@supabase/supabase-js'
import type { Database } from '../src/types/database'

const ORG_ID = process.env.CALENDAR_ORG_ID ?? 'b27e99cf-efcb-4b6b-a369-5a0d3ca7ffe5'

const EVENT_TYPE = {
  title: 'Conversa inicial',
  slug: 'conversa-inicial',
  description:
    'Uma conversa de 30 minutos para entender o que você precisa e dizer se a Skale Club é o lugar certo. ' +
    'Por vídeo.',
  duration_minutes: 30,
  location_type: 'video' as const,
  active: true,
}

/** Monday (1) to Friday (5), 09:00-17:00 in the profile's timezone. */
const WEEKDAYS = [1, 2, 3, 4, 5]
const START = '09:00:00'
const END = '17:00:00'

async function main() {
  const apply = process.argv.includes('--apply')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  const sb = createClient<Database>(url, key, { auth: { persistSession: false } })

  console.log(`org=${ORG_ID} ${apply ? '(APPLY)' : '(dry run — nothing is written)'}`)

  // Whose calendar is it? The org's owner, who must already have a profile:
  // the profile carries the timezone and the public slug, and inventing one
  // here would put a second /book page in front of the same person.
  const { data: member } = await sb
    .from('org_members')
    .select('user_id')
    .eq('organization_id', ORG_ID)
    .eq('role', 'owner')
    .maybeSingle()
  if (!member) throw new Error('This org has no owner.')

  const { data: profile } = await sb
    .from('calendar_profiles')
    .select('slug, timezone, default_location_type')
    .eq('user_id', member.user_id)
    .eq('org_id', ORG_ID)
    .maybeSingle()
  if (!profile) {
    throw new Error(
      'The owner has no calendar profile in this org. Create it in Calendar → Preferences first: ' +
        'it holds the timezone and the public slug.',
    )
  }
  console.log(`profile: /book/${profile.slug} | ${profile.timezone} | default ${profile.default_location_type}`)

  const { data: existingType } = await sb
    .from('event_types')
    .select('id, title, duration_minutes, active')
    .eq('org_id', ORG_ID)
    .eq('user_id', member.user_id)
    .eq('slug', EVENT_TYPE.slug)
    .maybeSingle()

  const { data: existingAvailability } = await sb
    .from('user_availability')
    .select('day_of_week, start_time, end_time')
    .eq('org_id', ORG_ID)
    .eq('user_id', member.user_id)

  const missingDays = WEEKDAYS.filter(
    (day) => !(existingAvailability ?? []).some((row) => row.day_of_week === day),
  )

  if (!apply) {
    console.log(existingType ? `would update event type ${existingType.id}` : `would create event type "${EVENT_TYPE.title}"`)
    console.log(
      missingDays.length
        ? `would add availability for day(s) ${missingDays.join(', ')} at ${START}-${END}`
        : 'availability already covers Monday to Friday',
    )
    console.log(`public page would be https://xphere.app/book/${profile.slug}/${EVENT_TYPE.slug}`)
    console.log('dry run only — re-run with --apply.')
    return
  }

  let eventTypeId = existingType?.id ?? null
  if (existingType) {
    const { error } = await sb.from('event_types').update(EVENT_TYPE).eq('id', existingType.id)
    if (error) throw error
    console.log(`updated event type ${existingType.id}`)
  } else {
    const { data, error } = await sb
      .from('event_types')
      .insert({ ...EVENT_TYPE, org_id: ORG_ID, user_id: member.user_id })
      .select('id')
      .single()
    if (error) throw error
    eventTypeId = data.id
    console.log(`created event type ${eventTypeId}`)
  }

  for (const day of missingDays) {
    const { error } = await sb
      .from('user_availability')
      .insert({ org_id: ORG_ID, user_id: member.user_id, day_of_week: day, start_time: START, end_time: END })
    if (error) throw error
  }
  console.log(
    missingDays.length
      ? `added availability for day(s) ${missingDays.join(', ')}`
      : 'availability unchanged',
  )

  console.log(`\ndone: https://xphere.app/book/${profile.slug}/${EVENT_TYPE.slug}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
