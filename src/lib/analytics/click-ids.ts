// Server-side counterpart to click-id-script.ts: maps the ingest payload's
// click-id fields onto the analytics_sessions columns written by
// src/lib/analytics/ingest.ts. Pure and side-effect free so it can be unit
// tested without a database — see tests/analytics-click-ids.test.ts.
import type { IngestPayload } from './types'

export interface ClickIdFields {
  gclid: string | null
  gbraid: string | null
  wbraid: string | null
  fbclid: string | null
}

/**
 * Normalizes the click-id fields the browser script may send on
 * session_start. An empty string (a query param present with no value) is
 * treated the same as absent -- both become null, matching how the rest of
 * this table's optional text columns behave.
 */
export function extractClickIdFields(
  payload: Pick<IngestPayload, 'gclid' | 'gbraid' | 'wbraid' | 'fbclid'>,
): ClickIdFields {
  const norm = (v?: string | null): string | null => (v ? v : null)
  return {
    gclid: norm(payload.gclid),
    gbraid: norm(payload.gbraid),
    wbraid: norm(payload.wbraid),
    fbclid: norm(payload.fbclid),
  }
}
