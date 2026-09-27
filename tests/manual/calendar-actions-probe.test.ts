// Read-only probe for the two calendar actions, against a real org.
//
// Lists the free times an assistant would read aloud, then asks the booking
// executor to book one WITHOUT consent — which it must refuse. Nothing is ever
// written: the only booking attempt in here is the one that is supposed to
// fail.
//
//   CALENDAR_PROBE_ORG_ID=… CALENDAR_PROBE_EVENT_TYPE=conversa-inicial \
//     npx vitest run --config vitest.manual.config.ts tests/manual/calendar-actions-probe.test.ts

import { it, expect } from 'vitest'
import { executeCalendarListSlots } from '@/lib/action-engine/executors/calendar-slots'
import { executeCalendarBookMeeting } from '@/lib/action-engine/executors/calendar-book-meeting'

const ORG_ID = process.env.CALENDAR_PROBE_ORG_ID
const EVENT_TYPE = process.env.CALENDAR_PROBE_EVENT_TYPE ?? 'conversa-inicial'

/** The next weekday, so the probe does not land on a closed Saturday. */
function nextWeekday(): string {
  const date = new Date()
  do {
    date.setDate(date.getDate() + 1)
  } while (date.getDay() === 0 || date.getDay() === 6)
  return date.toISOString().slice(0, 10)
}

it.skipIf(!ORG_ID)(
  'reads slots the way an assistant would say them, and refuses to book without consent',
  async () => {
    const date = nextWeekday()

    const spoken = await executeCalendarListSlots({ orgId: ORG_ID!, eventType: EVENT_TYPE, date })
    console.log(`### SLOTS ${date}: ${spoken}`)
    expect(spoken).not.toMatch(/could not be read|no active/i)

    const unknownDay = await executeCalendarListSlots({ orgId: ORG_ID!, eventType: EVENT_TYPE, date: 'tuesday' })
    console.log(`### BAD DATE: ${unknownDay}`)
    expect(unknownDay).toMatch(/could not be read/i)

    const unknownType = await executeCalendarListSlots({ orgId: ORG_ID!, eventType: 'does-not-exist', date })
    console.log(`### UNKNOWN EVENT TYPE: ${unknownType}`)
    expect(unknownType).toMatch(/no active/i)

    // A booking attempt from a phone call with a transcript that contains no
    // read-back and no agreement. The gate must stop it — this is the check
    // that keeps a robot from booking somebody who never said yes.
    const refused = await executeCalendarBookMeeting({
      orgId: ORG_ID!,
      eventType: EVENT_TYPE,
      date,
      time: '10:00',
      name: 'Probe Caller',
      email: 'probe@example.invalid',
      confirmed: true, // asserted by the model, which is worth nothing on its own
      voiceBooking: {
        callId: 'probe-call',
        messages: [
          { role: 'user', content: 'I want to talk to someone about ads' },
          { role: 'assistant', content: 'Sure, let me see what is open.' },
        ],
      },
    })
    console.log(`### UNCONSENTED BOOKING: ${refused}`)
    expect(refused).toMatch(/NOT BOOKED/i)

    // Same request with no email: refused before the gate even matters, because
    // the invite has nowhere to go.
    const noEmail = await executeCalendarBookMeeting({
      orgId: ORG_ID!,
      eventType: EVENT_TYPE,
      date,
      time: '10:00',
      name: 'Probe Caller',
      email: '',
    })
    console.log(`### NO EMAIL: ${noEmail}`)
    expect(noEmail).toMatch(/NOT BOOKED.*email/is)
  },
  120000,
)
