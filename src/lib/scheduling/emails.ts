// src/lib/scheduling/emails.ts
// Booker email notifications for the scheduling system.
//
// Contract:
//   - Fire-and-forget. Never throws. Callers do not need try/catch.
//   - If RESEND_API_KEY is missing, the helpers log a warning and no-op.
//     Booking flow continues unchanged.
//   - Resend is the provider (installed in this phase). If you later swap
//     providers, keep this contract.
//
// Templates are inline HTML to avoid a template engine dependency. Dark
// theme matches the booking page (#08090A bg, #FAFAFA text, indigo accent).

import { format } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'
import { Resend } from 'resend'

const RESEND_FROM = process.env.RESEND_FROM ?? 'Xphere Scheduling <bookings@xphere.app>'

let _client: Resend | null | undefined = undefined

// Lazily resolve the Resend client. Returns null when RESEND_API_KEY is
// missing — callers should treat that as a soft no-op (logged warning).
function getResend(): Resend | null {
  if (_client !== undefined) return _client
  const key = process.env.RESEND_API_KEY
  if (!key) {
    console.warn('[scheduling/emails] RESEND_API_KEY not set; email notifications disabled')
    _client = null
    return null
  }
  _client = new Resend(key)
  return _client
}

function formatStart(startAt: Date | string, timezone: string): string {
  const start = typeof startAt === 'string' ? new Date(startAt) : startAt
  const zoned = toZonedTime(start, timezone)
  // e.g. "Tuesday, May 19 2026 · 14:30"
  return format(zoned, 'EEEE, MMMM d yyyy · HH:mm')
}

const BASE_STYLE = `
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background-color: #08090A;
  color: #FAFAFA;
  padding: 32px 24px;
  margin: 0;
  line-height: 1.5;
`
const CARD_STYLE = `
  max-width: 560px;
  margin: 0 auto;
  background-color: #111113;
  border: 1px solid #2A2A2F;
  border-radius: 12px;
  padding: 32px;
`
const MUTED = 'color: #A1A1AA;'
const BUTTON = `
  display: inline-block;
  padding: 12px 24px;
  background-color: #6366F1;
  color: #FFFFFF !important;
  text-decoration: none;
  border-radius: 8px;
  font-weight: 600;
  margin-top: 16px;
`

// ──────────────────────────────────────────────────────────────────────────────
// sendBookingConfirmation — sent after createBooking succeeds.
// ──────────────────────────────────────────────────────────────────────────────

export interface BookingConfirmationParams {
  bookerEmail: string
  bookerName: string
  hostName: string
  eventTitle: string
  startAt: Date | string
  endAt: Date | string
  timezone: string
  cancelUrl: string
}

export async function sendBookingConfirmation(
  params: BookingConfirmationParams,
): Promise<void> {
  try {
    const client = getResend()
    if (!client) return

    const subject = `Booking confirmed: ${params.eventTitle} with ${params.hostName}`
    const when = formatStart(params.startAt, params.timezone)

    const html = `<!doctype html>
<html><body style="${BASE_STYLE}">
  <div style="${CARD_STYLE}">
    <h1 style="margin: 0 0 8px; font-size: 22px;">Booking confirmed</h1>
    <p style="${MUTED} margin: 0 0 24px;">Hi ${escapeHtml(params.bookerName)}, your meeting is on the calendar.</p>

    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
      <tr><td style="${MUTED} padding: 6px 0; width: 100px;">Event</td><td>${escapeHtml(params.eventTitle)}</td></tr>
      <tr><td style="${MUTED} padding: 6px 0;">Host</td><td>${escapeHtml(params.hostName)}</td></tr>
      <tr><td style="${MUTED} padding: 6px 0;">When</td><td>${escapeHtml(when)}</td></tr>
      <tr><td style="${MUTED} padding: 6px 0;">Timezone</td><td>${escapeHtml(params.timezone)}</td></tr>
    </table>

    <p style="margin-top: 28px;">
      <a href="${params.cancelUrl}" style="${BUTTON}">Cancel booking</a>
    </p>

    <p style="${MUTED} font-size: 12px; margin-top: 32px;">
      Powered by Xphere Scheduling
    </p>
  </div>
</body></html>`

    await client.emails.send({
      from: RESEND_FROM,
      to: [params.bookerEmail],
      subject,
      html,
    })
  } catch (err) {
    console.warn(
      '[scheduling/emails] sendBookingConfirmation failed:',
      err instanceof Error ? err.message : err,
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// sendBookingCancellation — sent after a booking moves to status='cancelled'.
// ──────────────────────────────────────────────────────────────────────────────

export interface BookingCancellationParams {
  bookerEmail: string
  bookerName: string
  hostName: string
  eventTitle: string
  startAt: Date | string
  timezone: string
  rebookUrl: string
}

export async function sendBookingCancellation(
  params: BookingCancellationParams,
): Promise<void> {
  try {
    const client = getResend()
    if (!client) return

    const subject = `Booking cancelled: ${params.eventTitle} with ${params.hostName}`
    const when = formatStart(params.startAt, params.timezone)

    const html = `<!doctype html>
<html><body style="${BASE_STYLE}">
  <div style="${CARD_STYLE}">
    <h1 style="margin: 0 0 8px; font-size: 22px;">Booking cancelled</h1>
    <p style="${MUTED} margin: 0 0 24px;">Hi ${escapeHtml(params.bookerName)}, your booking with ${escapeHtml(params.hostName)} has been cancelled.</p>

    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
      <tr><td style="${MUTED} padding: 6px 0; width: 100px;">Event</td><td>${escapeHtml(params.eventTitle)}</td></tr>
      <tr><td style="${MUTED} padding: 6px 0;">Was</td><td>${escapeHtml(when)} (${escapeHtml(params.timezone)})</td></tr>
    </table>

    <p style="margin-top: 28px;">
      <a href="${params.rebookUrl}" style="${BUTTON}">Book a new time</a>
    </p>

    <p style="${MUTED} font-size: 12px; margin-top: 32px;">
      Powered by Xphere Scheduling
    </p>
  </div>
</body></html>`

    await client.emails.send({
      from: RESEND_FROM,
      to: [params.bookerEmail],
      subject,
      html,
    })
  } catch (err) {
    console.warn(
      '[scheduling/emails] sendBookingCancellation failed:',
      err instanceof Error ? err.message : err,
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
