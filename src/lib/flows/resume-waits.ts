// Shared "resume any run waiting on this event" helper.
//
// Every domain event emitter (calendar, pipeline, contact, lead, inbound phone)
// calls this so a run suspended at a `wait_for_event` node resumes regardless of
// which subsystem produced the event. Previously only calendar events resumed
// waits, so opportunity/phone/contact waits could only ever advance via timeout.
//
// Correlation: a wait matches when its event_type equals the incoming event AND
// either the wait is uncorrelated (no contact_id) or its contact matches. Each
// wait is claimed atomically via satisfyWait; resumeRun runs only for the winner.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { findUnsatisfiedWaits, satisfyWait } from '@/lib/flows/wait'
import { resumeRun } from '@/lib/flows/engine'

export async function resumeMatchingWaits(
  supabase: SupabaseClient<Database>,
  params: {
    orgId: string
    eventType: string
    contactId: string | null
    payload: Record<string, unknown>
  },
): Promise<void> {
  const waits = await findUnsatisfiedWaits(supabase, {
    orgId: params.orgId,
    eventType: params.eventType,
    contactId: params.contactId,
  })
  for (const w of waits) {
    // Only the caller that wins the atomic claim resumes the run. This prevents
    // a duplicate event delivery (or a concurrent emitter) from double-resuming.
    const claimed = await satisfyWait(supabase, w.id)
    if (!claimed) continue
    await resumeRun(supabase, {
      runId: w.run_id,
      nodeId: w.node_id,
      event: params.eventType,
      payload: params.payload,
    })
  }
}
