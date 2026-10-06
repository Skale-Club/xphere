// src/lib/xkedule/attribution.ts
//
// Parser for the `attribution` object on Xkedule's booking.* webhooks --
// Phase E3 of .planning/clients/o-bigode-portugues/PHASE-E-SPEC.md.
//
// This is a FIXED contract shared with a parallel agent implementing the
// Xkedule side: field names and shape below must not change without
// updating both repos. The contract (PHASE-E-SPEC.md "Contrato de dados"):
//
//   attribution: {
//     xphere_visitor_id: uuid | null,
//     gclid, gbraid, wbraid, fbclid: string | null,
//     utm_source, utm_medium, utm_campaign, utm_term, utm_content: string | null,
//     landing_page, referrer: url | null,
//     captured_at: ISO-8601,
//     consent_ad_user_data, consent_ad_personalization: 'granted' | 'denied' | null,
//   }
//
// The two consent_* fields carry the visitor's Google Consent Mode v2 signals
// at capture time and are forwarded verbatim on the Google Ads offline
// conversion upload (ClickConversion.consent -- required for EEA traffic).
// Absent/null means "unknown" (-> UNSPECIFIED upstream). Unlike the other
// fields, an unrecognised consent value degrades to null instead of failing
// the object, so a bad value never costs us the gclid.
//
// "Ausente ou null quando não há dados ... O Xphere tem de tolerar a
// ausência" -- every field is optional/nullable, and the whole object may be
// missing (a booking created in the admin has none). This parser is
// deliberately lenient: any type mismatch on the object itself yields `null`
// (dropped, never throws) so a malformed attribution payload never blocks
// the booking mirror; unknown keys are silently ignored (zod's default
// object behavior -- no `.strict()`).
import { z } from 'zod'

/** 'granted' | 'denied' | null. Anything else (wrong type, unknown string) becomes null rather than invalidating the whole attribution object. */
const consentSchema = z.enum(['granted', 'denied']).nullable().optional().catch(null)

export const attributionSchema = z
  .object({
    // Not validated as z.string().uuid(): a slightly malformed id here
    // should not blow up the whole attribution object and lose the gclid
    // along with it. linkVisitorToContact() below is itself a no-op if the
    // value doesn't match any analytics_visitors row for this org.
    xphere_visitor_id: z.string().nullable().optional(),
    gclid: z.string().nullable().optional(),
    gbraid: z.string().nullable().optional(),
    wbraid: z.string().nullable().optional(),
    fbclid: z.string().nullable().optional(),
    utm_source: z.string().nullable().optional(),
    utm_medium: z.string().nullable().optional(),
    utm_campaign: z.string().nullable().optional(),
    utm_term: z.string().nullable().optional(),
    utm_content: z.string().nullable().optional(),
    landing_page: z.string().nullable().optional(),
    referrer: z.string().nullable().optional(),
    captured_at: z.string().nullable().optional(),
    consent_ad_user_data: consentSchema,
    consent_ad_personalization: consentSchema,
  })
  .nullable()
  .optional()

export type BookingAttribution = z.infer<typeof attributionSchema>

/**
 * Extracts the raw `attribution` value from a webhook body, tolerant of
 * either placement -- top-level (sibling of `booking`) or nested under
 * `booking.attribution`. The exact envelope position isn't pinned down by
 * the spec's data contract (only the object's own shape is), so this checks
 * both rather than assume one and silently drop attribution data the
 * Xkedule side sends in the other spot.
 */
export function extractAttributionInput(rawBody: unknown): unknown {
  if (!rawBody || typeof rawBody !== 'object') return undefined
  const obj = rawBody as Record<string, unknown>
  if (obj.attribution !== undefined) return obj.attribution
  const booking = obj.booking
  if (booking && typeof booking === 'object') {
    const nested = (booking as Record<string, unknown>).attribution
    if (nested !== undefined) return nested
  }
  return undefined
}

/**
 * Tolerant parse: an invalid/malformed `attribution` value never fails the
 * webhook -- it's dropped (returns null) so the booking still mirrors.
 */
export function parseAttribution(raw: unknown): BookingAttribution | null {
  const result = attributionSchema.safeParse(raw)
  if (!result.success) return null
  return result.data ?? null
}
