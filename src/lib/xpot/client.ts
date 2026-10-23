// Xpot field-sales client.
//
// Xpot owns in-person field visits (check-ins, audio notes, AI summaries). Xphere
// dispatches prospect-stage records to Xpot for a visit; Xpot returns visit
// outcomes via the webhook receiver at /api/integrations/xpot/visits.
//
// Config is per org (Settings → Integrations → Xpot, see ./credentials.ts), so
// only the tenant that connected Xpot sends it prospects and tasks:
//   baseUrl  base URL of the Xpot backend
//   apiKey   the Xpot user's inbound key (xpot_…), sent as the Bearer token
//
// Contract: Xpot exposes POST {baseUrl}/api/xpot/inbound/prospects accepting
// { leads: XpotLead[] } and returning { sent }.

export interface XpotCredentials {
  baseUrl: string
  apiKey: string
}

export interface XpotLead {
  xphereId: string
  xphereKind: 'contact' | 'account'
  name: string
  email: string | null
  phone: string | null
  address: string | null
}

export type XpotSendResult = { ok: true; sent: number } | { ok: false; error: string }

export interface XpotTaskMutation {
  externalId: string
  xpotTaskId?: number | null
  operation: 'upsert' | 'delete'
  occurredAt: string
  task: {
    title: string
    description?: string | null
    dueAt?: string | null
    priority: 'low' | 'medium' | 'high' | 'urgent'
    status: 'todo' | 'in_progress' | 'done' | 'cancelled'
    entityType?: 'contact' | 'account' | 'opportunity' | null
    entityId?: string | null
  }
}

export type XpotTaskSendResult =
  | { ok: true; action: string; taskId: number | null }
  | { ok: false; error: string; retryable: boolean }

export async function xpotSendLeads(creds: XpotCredentials, leads: XpotLead[]): Promise<XpotSendResult> {
  if (leads.length === 0) return { ok: true, sent: 0 }

  try {
    const res = await fetch(`${creds.baseUrl}/api/xpot/inbound/prospects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${creds.apiKey}`,
      },
      body: JSON.stringify({ leads }),
    })
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) {
      return { ok: false, error: (data.error as string) || `Xpot returned HTTP ${res.status}` }
    }
    return { ok: true, sent: (data.sent as number) ?? leads.length }
  } catch (err) {
    console.error('[xpot] send failed:', err)
    return { ok: false, error: 'Could not reach Xpot.' }
  }
}

export async function xpotSendTask(creds: XpotCredentials, input: XpotTaskMutation): Promise<XpotTaskSendResult> {
  try {
    const res = await fetch(`${creds.baseUrl}/api/xpot/inbound/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${creds.apiKey}` },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(10_000),
    })
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) {
      return {
        ok: false,
        error: (data.error as string) || `Xpot returned HTTP ${res.status}`,
        retryable: res.status === 429 || res.status >= 500,
      }
    }
    return { ok: true, action: String(data.action ?? 'synced'), taskId: (data.taskId as number | null) ?? null }
  } catch (err) {
    console.error('[xpot] task sync failed:', err)
    return { ok: false, error: err instanceof Error ? err.message : 'Could not reach Xpot.', retryable: true }
  }
}
