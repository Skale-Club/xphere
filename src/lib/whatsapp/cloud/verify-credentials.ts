/**
 * Validate manual-paste WhatsApp Cloud credentials by talking to Meta.
 *
 * Used by the "Test connection" button in the integration panel and on
 * "Connect" before persisting. Returns the customer-visible phone number
 * (display_phone_number, e.g. "+1 555-1234") so we can save it for UI.
 */

import { metaFetch, MetaApiException } from './client'

interface VerifyInput {
  wabaId: string
  phoneNumberId: string
  accessToken: string
}

interface VerifyOk {
  ok: true
  displayPhoneNumber: string | null
  verifiedName: string | null
  qualityRating: string | null
}

interface VerifyErr {
  ok: false
  error: string
  code?: number
}

export async function verifyCredentials(input: VerifyInput): Promise<VerifyOk | VerifyErr> {
  if (!input.wabaId || !input.phoneNumberId || !input.accessToken) {
    return { ok: false, error: 'Missing required credentials' }
  }

  try {
    // 1) Phone number lookup — the cheapest call that proves token + phone-id alignment.
    const phone = await metaFetch<{
      display_phone_number?: string
      verified_name?: string
      quality_rating?: string
    }>(
      { accessToken: input.accessToken },
      `/${input.phoneNumberId}`,
      { query: { fields: 'display_phone_number,verified_name,quality_rating' } },
    )

    // 2) Sanity-check that this phone is under the supplied WABA.
    const phonesOnWaba = await metaFetch<{ data?: Array<{ id: string }> }>(
      { accessToken: input.accessToken },
      `/${input.wabaId}/phone_numbers`,
      { query: { fields: 'id' } },
    )
    const phoneIds = (phonesOnWaba.data ?? []).map((p) => p.id)
    if (!phoneIds.includes(input.phoneNumberId)) {
      return {
        ok: false,
        error: 'The provided Phone Number ID does not belong to the WABA ID. Double-check both values in Meta Business Manager.',
      }
    }

    return {
      ok: true,
      displayPhoneNumber: phone.display_phone_number ?? null,
      verifiedName: phone.verified_name ?? null,
      qualityRating: phone.quality_rating ?? null,
    }
  } catch (err) {
    if (err instanceof MetaApiException) {
      return { ok: false, error: err.metaError.message, code: err.metaError.code }
    }
    return { ok: false, error: err instanceof Error ? err.message : 'Connection failed' }
  }
}
