'use server'

import { createServiceRoleClient } from '@/lib/supabase/admin'

export type ActivityEventType =
  | 'org_created'
  | 'member_joined'
  | 'call_completed'
  | 'conversation_started'
  | 'contact_created'
  | 'workflow_run'
  | 'campaign_started'
  | 'booking_created'

export type PlatformEvent = {
  id: string
  type: ActivityEventType
  org_id: string | null
  org_name: string | null
  description: string
  timestamp: string
}

export async function getPlatformActivity(hours: 24 | 48 | 72 = 72): Promise<PlatformEvent[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createServiceRoleClient() as any
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()

  const [orgsRes, membersRes, callsRes, convsRes, contactsRes, workflowsRes, campaignsRes, bookingsRes] =
    await Promise.all([
      admin.from('organizations').select('id, name, created_at').gte('created_at', since).order('created_at', { ascending: false }).limit(10),
      admin.from('org_members').select('id, organization_id, created_at').gte('created_at', since).order('created_at', { ascending: false }).limit(10),
      admin.from('calls').select('id, organization_id, created_at').eq('status', 'completed').gte('created_at', since).order('created_at', { ascending: false }).limit(10),
      admin.from('conversations').select('id, org_id, created_at').gte('created_at', since).order('created_at', { ascending: false }).limit(10),
      admin.from('contacts').select('id, org_id, name, created_at').gte('created_at', since).order('created_at', { ascending: false }).limit(10),
      admin.from('workflow_runs').select('id, status, started_at').gte('started_at', since).order('started_at', { ascending: false }).limit(10),
      admin.from('campaigns').select('id, name, created_at').eq('status', 'in_progress' as const).gte('created_at', since).order('created_at', { ascending: false }).limit(10),
      admin.from('bookings').select('id, created_at').gte('created_at', since).order('created_at', { ascending: false }).limit(10).maybeSingle().then(() =>
        admin.from('bookings').select('id, created_at').gte('created_at', since).order('created_at', { ascending: false }).limit(10)
      ),
    ])

  // Build org name lookup
  const orgIds = new Set<string>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(membersRes.data ?? []).forEach((r: any) => orgIds.add(r.organization_id))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(callsRes.data ?? []).forEach((r: any) => orgIds.add(r.organization_id))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(convsRes.data ?? []).forEach((r: any) => orgIds.add(r.org_id))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(contactsRes.data ?? []).forEach((r: any) => orgIds.add(r.org_id))

  let orgMap = new Map<string, string>()
  if (orgIds.size > 0) {
    const { data } = await admin.from('organizations').select('id, name').in('id', [...orgIds])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    orgMap = new Map((data ?? []).map((o: any) => [o.id, o.name]))
  }

  const events: PlatformEvent[] = []

  for (const org of orgsRes.data ?? []) {
    events.push({ id: `org-${org.id}`, type: 'org_created', org_id: org.id, org_name: org.name, description: `New organization created: ${org.name}`, timestamp: org.created_at })
  }
  for (const m of membersRes.data ?? []) {
    const name = orgMap.get(m.organization_id) ?? m.organization_id
    events.push({ id: `member-${m.id}`, type: 'member_joined', org_id: m.organization_id, org_name: name, description: `New member joined ${name}`, timestamp: m.created_at })
  }
  for (const c of callsRes.data ?? []) {
    const name = orgMap.get(c.organization_id) ?? c.organization_id
    events.push({ id: `call-${c.id}`, type: 'call_completed', org_id: c.organization_id, org_name: name, description: `Call completed in ${name}`, timestamp: c.created_at })
  }
  for (const c of convsRes.data ?? []) {
    const name = orgMap.get(c.org_id) ?? c.org_id
    events.push({ id: `conv-${c.id}`, type: 'conversation_started', org_id: c.org_id, org_name: name, description: `New conversation in ${name}`, timestamp: c.created_at })
  }
  for (const c of contactsRes.data ?? []) {
    const name = orgMap.get(c.org_id) ?? c.org_id
    const who = c.name || 'Unknown'
    events.push({ id: `contact-${c.id}`, type: 'contact_created', org_id: c.org_id, org_name: name, description: `Contact created: ${who} in ${name}`, timestamp: c.created_at })
  }
  for (const r of workflowsRes.data ?? []) {
    if (!r.started_at) continue
    events.push({ id: `wf-${r.id}`, type: 'workflow_run', org_id: null, org_name: null, description: `Workflow run ${r.status}`, timestamp: r.started_at })
  }
  for (const c of campaignsRes.data ?? []) {
    events.push({ id: `campaign-${c.id}`, type: 'campaign_started', org_id: null, org_name: null, description: `Campaign started: ${c.name}`, timestamp: c.created_at })
  }
  for (const b of (bookingsRes.data ?? [])) {
    events.push({ id: `booking-${b.id}`, type: 'booking_created', org_id: null, org_name: null, description: 'New booking created', timestamp: b.created_at })
  }

  return events.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 50)
}
