// GET /api/vapi/assistants
// Proxies Vapi GET /assistant to list available assistants.
// Reads the Vapi API key from the org's integration record (provider: vapi).

export const runtime = 'nodejs'

import { createClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto'

export async function GET(): Promise<Response> {
  const supabase = await createClient()

  const { data: integration, error } = await supabase
    .from('integrations')
    .select('encrypted_api_key')
    .eq('provider', 'vapi')
    .eq('is_active', true)
    .single()

  if (error || !integration) {
    return Response.json(
      { error: 'Vapi integration not configured. Add it in Integrations.' },
      { status: 400 }
    )
  }

  let vapiApiKey: string
  try {
    vapiApiKey = await decrypt(integration.encrypted_api_key)
  } catch {
    return Response.json({ error: 'Failed to read Vapi credentials.' }, { status: 500 })
  }

  try {
    const response = await fetch('https://api.vapi.ai/assistant', {
      headers: {
        'Authorization': `Bearer ${vapiApiKey}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      return Response.json(
        { error: 'Failed to fetch assistants from Vapi' },
        { status: response.status }
      )
    }

    const data = await response.json()
    return Response.json(data)
  } catch (err) {
    console.error('[vapi/assistants] Error:', err)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
