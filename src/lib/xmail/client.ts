// Xmail outreach client.
//
// Xmail (skaleclub-mail) owns the email outreach engine. Per the integration
// contract, Xphere is the orchestrator: it pushes prospect-stage records into
// Xmail as outreach leads and lets Xmail run the sending. Engagement flows back
// to Xphere via the webhook receiver at /api/integrations/xmail/events.
//
// Config is environment-driven (no hardcoded domains):
//   XMAIL_API_URL        base URL of the Xmail backend
//   XMAIL_USER_ID        the Xmail user id Xphere acts as (x-user-id header)
//   XMAIL_WEBHOOK_SECRET shared secret for verifying inbound event webhooks

const XMAIL_API_URL = (process.env.XMAIL_API_URL || '').replace(/\/$/, '')
const XMAIL_USER_ID = process.env.XMAIL_USER_ID || ''

export function isXmailConfigured(): boolean {
  return Boolean(XMAIL_API_URL && XMAIL_USER_ID)
}

export interface XmailLead {
  email: string
  firstName?: string | null
  lastName?: string | null
  companyName?: string | null
  phone?: string | null
  website?: string | null
  customFields?: Record<string, unknown>
}

export type XmailImportResult =
  | { ok: true; imported: number }
  | { ok: false; error: string }

/**
 * Bulk-import outreach leads into Xmail. Idempotent on Xmail's side (it upserts
 * by org + email). Returns the number of leads accepted.
 */
export async function xmailBulkImportLeads(leads: XmailLead[]): Promise<XmailImportResult> {
  if (!isXmailConfigured()) {
    return { ok: false, error: 'Xmail integration is not configured (set XMAIL_API_URL + XMAIL_USER_ID).' }
  }
  if (leads.length === 0) return { ok: true, imported: 0 }

  try {
    const res = await fetch(`${XMAIL_API_URL}/api/outreach/leads/bulk-import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': XMAIL_USER_ID,
      },
      body: JSON.stringify({ leads }),
    })
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) {
      return { ok: false, error: (data.error as string) || `Xmail returned HTTP ${res.status}` }
    }
    const imported =
      (data.imported as number) ?? (data.count as number) ?? (Array.isArray(data.leads) ? data.leads.length : leads.length)
    return { ok: true, imported }
  } catch (err) {
    console.error('[xmail] bulk-import failed:', err)
    return { ok: false, error: 'Could not reach Xmail.' }
  }
}
