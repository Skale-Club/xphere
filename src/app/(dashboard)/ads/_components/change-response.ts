// Shared response handling for the legacy campaign-table mutations
// (meta-ads-campaigns.tsx, google-ads-campaigns.tsx, campaigns-panel.tsx).
//
// Every one of those routes now goes through the Ads Command Engine
// (POST /api/ads/{meta,google}/campaigns → submitChange → engineResponse), so
// a write can land in three shapes:
//   - applied immediately (200, ok: true)          → safe to update local state
//   - sent for approval (202, ok: true, pending_approval: true) → do NOT
//     optimistically update; the value hasn't changed yet
//   - rejected (4xx/5xx, ok: false, error, code)    → show the engine's message

import { toast } from 'sonner'

type EngineResponseBody = {
  ok?: boolean
  error?: string
  code?: string
  pending_approval?: boolean
}

/**
 * Interpret a fetch Response from a campaign-table mutation and show the
 * matching toast. Returns true only when the change applied immediately.
 */
export async function handleEngineResponse(res: Response, successMessage: string): Promise<boolean> {
  let body: EngineResponseBody = {}
  try {
    body = (await res.json()) as EngineResponseBody
  } catch {
    // no body to parse
  }

  if (res.ok && body.pending_approval) {
    toast.info('Sent for approval — see Ads → Changes')
    return false
  }

  // 202 + ok:false = temporary platform error, retry already scheduled.
  if (res.ok && body.ok === false) {
    toast.info(body.error ?? 'Temporary platform error — the change will be retried automatically.')
    return false
  }

  if (!res.ok) {
    const message = body.error ?? 'Failed to update'
    toast.error(body.code === 'state_conflict' ? `${message} Refresh the page and try again.` : message)
    return false
  }

  toast.success(successMessage)
  return true
}
