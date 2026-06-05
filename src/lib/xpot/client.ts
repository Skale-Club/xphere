// Xpot field-sales client.
//
// Xpot owns in-person field visits (check-ins, audio notes, AI summaries). Xphere
// dispatches prospect-stage records to Xpot for a visit; Xpot returns visit
// outcomes via the webhook receiver at /api/integrations/xpot/visits.
//
// Config is environment-driven:
//   XPOT_API_URL  base URL of the Xpot backend
//   XPOT_API_KEY  bearer token for the Xpot inbound API
//   XPOT_WEBHOOK_SECRET  shared secret for verifying inbound visit webhooks
//
// Contract: Xpot exposes POST {XPOT_API_URL}/api/xpot/inbound/prospects accepting
// { leads: XpotLead[] } and returning { sent }.

const XPOT_API_URL = (process.env.XPOT_API_URL || '').replace(/\/$/, '')
const XPOT_API_KEY = process.env.XPOT_API_KEY || ''

export function isXpotConfigured(): boolean {
  return Boolean(XPOT_API_URL && XPOT_API_KEY)
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

export async function xpotSendLeads(leads: XpotLead[]): Promise<XpotSendResult> {
  if (!isXpotConfigured()) return { ok: false, error: 'Xpot is not configured.' }
  if (leads.length === 0) return { ok: true, sent: 0 }

  try {
    const res = await fetch(`${XPOT_API_URL}/api/xpot/inbound/prospects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${XPOT_API_KEY}`,
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
