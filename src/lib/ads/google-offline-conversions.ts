// src/lib/ads/google-offline-conversions.ts
//
// Offline click-conversion upload to Google Ads -- Phase E4 of
// .planning/clients/o-bigode-portugues/PHASE-E-SPEC.md.
//
// When a mirrored Xkedule booking resolves to 'showed' (Xkedule's
// `completed` status -- "cliente atendido"; see mapStatus in
// lib/xkedule/mirror.ts), report it back to Google Ads as an offline
// conversion against whichever click id brought the visitor in, so the
// account can eventually optimize toward "customer actually served" instead
// of stopping at "booking created".
//
// Config lives on organizations.settings (an existing jsonb column -- see
// src/types/database.ts) under the key `google_ads_offline_conversion_action`,
// holding the conversion action's full resource name
// ("customers/<id>/conversionActions/<id>"). This was the least invasive
// option available: ads_connections has no metadata/settings column of its
// own, and the resource name already embeds the customer id, so no second
// field is needed to know which Google Ads account to call. See the phase
// report for the exact value to set for org b5bd24d8-aed0-4983-9750-
// d02d88a6b161 once the "Cliente atendido" import conversion action exists
// in that account.
//
// Consent (EEA requirement): the attribution bundle carries the visitor's
// Consent Mode v2 signals (`consent_ad_user_data`, `consent_ad_personalization`,
// 'granted' | 'denied' | null). They are sent as ClickConversion.consent;
// null/absent maps to UNSPECIFIED. Currency falls back to the booking's own
// currency, then organizations.default_currency, then 'USD'.
//
// Online-conversion retraction: the website's GTM fires an online "Marcacao
// Online" conversion at booking time with orderId = the Xkedule booking id.
// When the booking is later cancelled, retractBookingConversionIfEligible()
// sends an uploadConversionAdjustments RETRACTION for that orderId so Google
// stops counting it. Config key (organizations.settings, same resource-name
// format as above): `google_ads_online_booking_conversion_action`. For the
// Bigode org (b5bd24d8-aed0-4983-9750-d02d88a6b161) the value is
// "customers/7385502411/conversionActions/7784727960" (NOT written by code --
// set it in organizations.settings by hand). Adjustments match by orderId, so
// no click id is needed.
//
// This module must NEVER throw into its caller (the xkedule webhook) --
// every path either returns silently (not eligible / not configured) or
// swallows its own error after logging it via lib/logger.ts's event_logs
// sink, which already fans out severity:'error' rows to Sentry.

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'
import { log } from '@/lib/logger'
import {
  parseTokens,
  uploadClickConversions,
  uploadConversionAdjustments,
  type ClickConversionUploadResult,
  type ConversionAdjustmentUploadResult,
} from './google-api'
import { withConnectionHealth } from './connection-health'
import type { BookingAttribution } from '@/lib/xkedule/attribution'

const EVENT_TYPE = 'ads.google_offline_conversion'
const RETRACTION_EVENT_TYPE = 'ads.google_conversion_retraction'
const SOURCE = 'xkedule-webhook'

// ─── Pure helpers (no network, no DB — see tests/google-offline-conversions.test.ts) ──

export type ClickIdField = 'gclid' | 'gbraid' | 'wbraid'

/** The subset of the attribution bundle resolveClickId needs — kept as its own narrow shape rather than reusing BookingAttribution directly, since that type is itself `{...} | null | undefined` and awkward to destructure a Pick from. */
export interface ClickIdCarrier {
  gclid?: string | null
  gbraid?: string | null
  wbraid?: string | null
}

/** Which single click id to report. Google's API accepts exactly one per conversion; gclid (by far the common case) takes priority when more than one somehow got captured. */
export function resolveClickId(
  attribution: ClickIdCarrier | null | undefined,
): { field: ClickIdField; value: string } | null {
  if (!attribution) return null
  if (attribution.gclid) return { field: 'gclid', value: attribution.gclid }
  if (attribution.gbraid) return { field: 'gbraid', value: attribution.gbraid }
  if (attribution.wbraid) return { field: 'wbraid', value: attribution.wbraid }
  return null
}

/**
 * Google's required conversionDateTime format: "yyyy-mm-dd hh:mm:ss+hh:mm".
 * `utcOffsetMinutes` defaults to 0 (UTC, i.e. "+00:00") -- bookings are
 * stored/compared in UTC (start_at/end_at) and Xkedule's tenant timezone
 * isn't carried onto the attribution bundle, so UTC is the only offset this
 * module can state with certainty without a wider change.
 */
export function formatConversionDateTime(date: Date, utcOffsetMinutes = 0): string {
  const shifted = new Date(date.getTime() + utcOffsetMinutes * 60_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  const y = shifted.getUTCFullYear()
  const mo = pad(shifted.getUTCMonth() + 1)
  const d = pad(shifted.getUTCDate())
  const h = pad(shifted.getUTCHours())
  const mi = pad(shifted.getUTCMinutes())
  const s = pad(shifted.getUTCSeconds())
  const sign = utcOffsetMinutes >= 0 ? '+' : '-'
  const offAbs = Math.abs(utcOffsetMinutes)
  const offH = pad(Math.floor(offAbs / 60))
  const offM = pad(offAbs % 60)
  return `${y}-${mo}-${d} ${h}:${mi}:${s}${sign}${offH}:${offM}`
}

export type ConsentSignal = 'granted' | 'denied' | null | undefined
export type GoogleConsentStatus = 'GRANTED' | 'DENIED' | 'UNSPECIFIED'

/** granted -> GRANTED, denied -> DENIED, anything else (null/undefined/unknown) -> UNSPECIFIED. */
export function mapConsentStatus(signal: ConsentSignal): GoogleConsentStatus {
  if (signal === 'granted') return 'GRANTED'
  if (signal === 'denied') return 'DENIED'
  return 'UNSPECIFIED'
}

/** Currency for the upload: the booking's own, else the org default, else USD. Blank strings count as absent. */
export function resolveConversionCurrency(
  bookingCurrency: string | null | undefined,
  orgDefaultCurrency: string | null | undefined,
): string {
  const pick = (v: string | null | undefined) => (typeof v === 'string' && v.trim() ? v.trim().toUpperCase() : null)
  return pick(bookingCurrency) ?? pick(orgDefaultCurrency) ?? 'USD'
}

export interface ClickConversionInput {
  conversionActionResourceName: string
  gclid?: string | null
  gbraid?: string | null
  wbraid?: string | null
  conversionDateTime: Date
  conversionValue: number | null
  currencyCode: string
  /** Booking id -- Google dedups repeat uploads of the same order_id, making retries/redeliveries idempotent. */
  orderId: string
  consentAdUserData?: ConsentSignal
  consentAdPersonalization?: ConsentSignal
}

export interface ClickConversionPayload {
  conversions: Array<{
    conversionAction: string
    conversionDateTime: string
    conversionValue?: number
    currencyCode: string
    orderId: string
    consent: { adUserData: GoogleConsentStatus; adPersonalization: GoogleConsentStatus }
    gclid?: string
    gbraid?: string
    wbraid?: string
  }>
  partialFailure: true
}

/**
 * Pure builder for the uploadClickConversions request body. Throws if none
 * of gclid/gbraid/wbraid is present -- callers must check resolveClickId()
 * first (uploadBookingConversionIfEligible below does, and returns early
 * instead of calling this when there's nothing to report).
 */
export function buildUploadClickConversionsPayload(input: ClickConversionInput): ClickConversionPayload {
  const clickId = resolveClickId(input)
  if (!clickId) throw new Error('buildUploadClickConversionsPayload: no click id (gclid/gbraid/wbraid) present')

  const conversion: ClickConversionPayload['conversions'][number] = {
    conversionAction: input.conversionActionResourceName,
    conversionDateTime: formatConversionDateTime(input.conversionDateTime),
    currencyCode: input.currencyCode,
    orderId: input.orderId,
    consent: {
      adUserData: mapConsentStatus(input.consentAdUserData),
      adPersonalization: mapConsentStatus(input.consentAdPersonalization),
    },
    [clickId.field]: clickId.value,
  }
  if (input.conversionValue != null) conversion.conversionValue = input.conversionValue

  return { conversions: [conversion], partialFailure: true }
}

export interface ConversionAdjustmentInput {
  conversionActionResourceName: string
  /** The conversion's orderId -- for the online booking conversion, the Xkedule booking id (what the site pushes as transaction_id). */
  orderId: string
  adjustmentDateTime: Date
}

export interface ConversionAdjustmentsPayload {
  conversionAdjustments: Array<{
    conversionAction: string
    adjustmentType: 'RETRACTION'
    adjustmentDateTime: string
    orderId: string
  }>
  partialFailure: true
}

/** Pure builder for the uploadConversionAdjustments request body (a single RETRACTION matched by orderId). */
export function buildConversionAdjustmentsPayload(input: ConversionAdjustmentInput): ConversionAdjustmentsPayload {
  return {
    conversionAdjustments: [
      {
        conversionAction: input.conversionActionResourceName,
        adjustmentType: 'RETRACTION',
        adjustmentDateTime: formatConversionDateTime(input.adjustmentDateTime),
        orderId: input.orderId,
      },
    ],
    partialFailure: true,
  }
}

/** "customers/1234567890/conversionActions/987654321" ->"1234567890". Null if the resource name doesn't match the expected shape. */
export function customerIdFromConversionActionResourceName(resourceName: string): string | null {
  const m = /^customers\/(\d+)\/conversionActions\/\d+$/.exec(resourceName.trim())
  return m ? m[1] : null
}

// ─── Orchestration (DB + network — not covered by the pure-function tests above) ──

export interface UploadBookingConversionParams {
  orgId: string
  bookingId: string
  /** ISO timestamp — the booking's end_at, used as the conversion moment. */
  bookingEndAt: string
  totalPrice: number | null
  currency: string | null
  attribution: BookingAttribution | null
}

/**
 * Entry point called by the xkedule webhook once a booking resolves to
 * 'showed'. Resolves the org's configured conversion action + usable Google
 * Ads connection, uploads the conversion, and records the outcome via
 * lib/logger.ts (event_logs, event_type 'ads.google_offline_conversion').
 * Never throws.
 */
export async function uploadBookingConversionIfEligible(params: UploadBookingConversionParams): Promise<void> {
  const clickId = resolveClickId(params.attribution)
  if (!clickId) return // nothing to report -- not an error, just no click on this booking

  try {
    const supabase = createServiceRoleClient()

    const { data: org } = await supabase
      .from('organizations')
      .select('settings, default_currency')
      .eq('id', params.orgId)
      .maybeSingle()
    const settings = (org?.settings ?? {}) as Record<string, unknown>
    const conversionActionResourceName =
      typeof settings.google_ads_offline_conversion_action === 'string'
        ? settings.google_ads_offline_conversion_action
        : null

    if (!conversionActionResourceName) {
      // Not configured for this org -- expected for every org until the
      // "Cliente atendido" import conversion action is created and wired up
      // (see the phase report). Not an error.
      return
    }

    const customerId = customerIdFromConversionActionResourceName(conversionActionResourceName)
    if (!customerId) {
      await log({
        event_type: EVENT_TYPE,
        source: SOURCE,
        status: 'skipped',
        severity: 'warn',
        org_id: params.orgId,
        correlation_id: params.bookingId,
        payload: { booking_id: params.bookingId, reason: 'invalid_conversion_action_resource_name', conversionActionResourceName },
      })
      return
    }

    const { data: conn } = await supabase
      .from('ads_connections')
      .select('encrypted_access_token')
      .eq('org_id', params.orgId)
      .eq('platform', 'google')
      .eq('ad_account_id', customerId)
      .eq('usable', true)
      .maybeSingle()

    if (!conn) {
      await log({
        event_type: EVENT_TYPE,
        source: SOURCE,
        status: 'skipped',
        severity: 'warn',
        org_id: params.orgId,
        correlation_id: params.bookingId,
        payload: { booking_id: params.bookingId, reason: 'no_usable_google_connection', customer_id: customerId },
      })
      return
    }

    const tokens = parseTokens(await decrypt(conn.encrypted_access_token))

    const payload = buildUploadClickConversionsPayload({
      conversionActionResourceName,
      gclid: clickId.field === 'gclid' ? clickId.value : undefined,
      gbraid: clickId.field === 'gbraid' ? clickId.value : undefined,
      wbraid: clickId.field === 'wbraid' ? clickId.value : undefined,
      conversionDateTime: new Date(params.bookingEndAt),
      conversionValue: params.totalPrice,
      currencyCode: resolveConversionCurrency(params.currency, org?.default_currency),
      orderId: params.bookingId,
      consentAdUserData: params.attribution?.consent_ad_user_data,
      consentAdPersonalization: params.attribution?.consent_ad_personalization,
    })

    const result: ClickConversionUploadResult = await withConnectionHealth(
      { orgId: params.orgId, platform: 'google', adAccountId: customerId },
      () => uploadClickConversions(customerId, tokens.refresh_token, payload),
    )

    const failed = !!result.partialFailureError
    await log({
      event_type: EVENT_TYPE,
      source: SOURCE,
      status: failed ? 'failed' : 'ok',
      severity: failed ? 'error' : 'info',
      org_id: params.orgId,
      correlation_id: params.bookingId,
      payload: { booking_id: params.bookingId, customer_id: customerId, click_id_field: clickId.field, result },
      error_message: failed ? JSON.stringify(result.partialFailureError) : undefined,
    })
  } catch (err) {
    await log({
      event_type: EVENT_TYPE,
      source: SOURCE,
      status: 'failed',
      severity: 'error',
      org_id: params.orgId,
      correlation_id: params.bookingId,
      error_message: err instanceof Error ? err.message : String(err),
    }).catch(() => {})
  }
}

export interface RetractBookingConversionParams {
  orgId: string
  /** Xphere's mirror row uuid -- used only as the log correlation id. */
  bookingId: string
  /** The Xkedule booking id (bookings.external_id / webhook booking.id) -- the orderId of the online conversion. */
  externalBookingId: string
  /** When the cancellation happened (webhook occurred_at). */
  cancelledAt: Date
}

/**
 * Called by the xkedule webhook when a booking transitions to 'cancelled'.
 * Retracts the online "Marcacao Online" conversion (orderId = Xkedule booking
 * id) so Google stops counting a booking that no longer exists. Skips
 * silently when `google_ads_online_booking_conversion_action` isn't set for
 * the org; needs no click id. Logs to event_logs
 * ('ads.google_conversion_retraction'). Never throws.
 */
export async function retractBookingConversionIfEligible(params: RetractBookingConversionParams): Promise<void> {
  try {
    const supabase = createServiceRoleClient()

    const { data: org } = await supabase
      .from('organizations')
      .select('settings')
      .eq('id', params.orgId)
      .maybeSingle()
    const settings = (org?.settings ?? {}) as Record<string, unknown>
    const conversionActionResourceName =
      typeof settings.google_ads_online_booking_conversion_action === 'string'
        ? settings.google_ads_online_booking_conversion_action
        : null

    if (!conversionActionResourceName) return // not configured for this org -- expected, not an error

    const logBase = {
      event_type: RETRACTION_EVENT_TYPE,
      source: SOURCE,
      org_id: params.orgId,
      correlation_id: params.bookingId,
    }

    const customerId = customerIdFromConversionActionResourceName(conversionActionResourceName)
    if (!customerId) {
      await log({
        ...logBase,
        status: 'skipped',
        severity: 'warn',
        payload: {
          booking_id: params.bookingId,
          order_id: params.externalBookingId,
          reason: 'invalid_conversion_action_resource_name',
          conversionActionResourceName,
        },
      })
      return
    }

    const { data: conn } = await supabase
      .from('ads_connections')
      .select('encrypted_access_token')
      .eq('org_id', params.orgId)
      .eq('platform', 'google')
      .eq('ad_account_id', customerId)
      .eq('usable', true)
      .maybeSingle()

    if (!conn) {
      await log({
        ...logBase,
        status: 'skipped',
        severity: 'warn',
        payload: {
          booking_id: params.bookingId,
          order_id: params.externalBookingId,
          reason: 'no_usable_google_connection',
          customer_id: customerId,
        },
      })
      return
    }

    const tokens = parseTokens(await decrypt(conn.encrypted_access_token))

    const payload = buildConversionAdjustmentsPayload({
      conversionActionResourceName,
      orderId: params.externalBookingId,
      adjustmentDateTime: params.cancelledAt,
    })

    const result: ConversionAdjustmentUploadResult = await withConnectionHealth(
      { orgId: params.orgId, platform: 'google', adAccountId: customerId },
      () => uploadConversionAdjustments(customerId, tokens.refresh_token, payload),
    )

    const failed = !!result.partialFailureError
    await log({
      ...logBase,
      status: failed ? 'failed' : 'ok',
      severity: failed ? 'error' : 'info',
      payload: { booking_id: params.bookingId, order_id: params.externalBookingId, customer_id: customerId, result },
      error_message: failed ? JSON.stringify(result.partialFailureError) : undefined,
    })
  } catch (err) {
    await log({
      event_type: RETRACTION_EVENT_TYPE,
      source: SOURCE,
      status: 'failed',
      severity: 'error',
      org_id: params.orgId,
      correlation_id: params.bookingId,
      error_message: err instanceof Error ? err.message : String(err),
    }).catch(() => {})
  }
}
