// GET /api/vapi/assistants
// Proxies Vapi GET /assistant to list available assistants.
// Reads the Vapi API key from the org's integration record (provider: vapi).

export const runtime = 'nodejs'

import { getVapiApiKey, listVapiAssistants, VapiApiError } from '@/lib/vapi/client'
import { createLogger } from '@/lib/obs/logger'

const obs = createLogger({ route: 'api/vapi/assistants' })

export async function GET(): Promise<Response> {
  const apiKey = await getVapiApiKey()
  if (!apiKey) {
    return Response.json(
      { error: 'Vapi integration not configured. Add it in Integrations.' },
      { status: 400 }
    )
  }

  try {
    const assistants = await listVapiAssistants(apiKey)
    return Response.json(assistants)
  } catch (err) {
    if (err instanceof VapiApiError) {
      return Response.json(
        { error: 'Failed to fetch assistants from Vapi' },
        { status: err.status || 502 }
      )
    }
    obs.error('vapi_assistants_error', { error: err })
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
