// GET /api/vapi/phone-numbers
// Proxies Vapi GET /phone-number to list available outbound phone numbers.
// Reads the Vapi API key from the org's integration record (provider: vapi).

export const runtime = 'nodejs'

import { getVapiApiKey, listVapiPhoneNumbers, VapiApiError } from '@/lib/vapi/client'
import { createLogger } from '@/lib/obs/logger'

const obs = createLogger({ route: 'api/vapi/phone-numbers' })

export async function GET(): Promise<Response> {
  const apiKey = await getVapiApiKey()
  if (!apiKey) {
    return Response.json(
      { error: 'Vapi integration not configured. Add it in Integrations.' },
      { status: 400 }
    )
  }

  try {
    const numbers = await listVapiPhoneNumbers(apiKey)
    return Response.json(numbers)
  } catch (err) {
    if (err instanceof VapiApiError) {
      return Response.json(
        { error: 'Failed to fetch phone numbers from Vapi' },
        { status: err.status || 502 }
      )
    }
    obs.error('vapi_phone_numbers_error', { error: err })
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
