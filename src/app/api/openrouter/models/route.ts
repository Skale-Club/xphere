// SEED-042 | OpenRouter models proxy.
// Used by the OpenRouter integration panel to populate model selectors.
// Looks up the org's stored OpenRouter key, queries openrouter.ai/api/v1/models
// and normalises the response to { id, name, modalities[] }.

import { createClient, getUser } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto'

export const runtime = 'nodejs'

interface NormalisedModel {
  id: string
  name: string
  modalities: string[]
}

interface OpenRouterApiModel {
  id?: string
  name?: string
  architecture?: {
    input_modalities?: string[]
    modality?: string
  }
}

function inferModalities(m: OpenRouterApiModel): string[] {
  const set = new Set<string>()
  const inputs = m.architecture?.input_modalities ?? []
  for (const i of inputs) {
    const v = i.toLowerCase()
    if (v.includes('text')) set.add('text')
    if (v.includes('image')) set.add('image')
    if (v.includes('audio') || v.includes('voice')) set.add('audio')
  }
  const single = m.architecture?.modality?.toLowerCase() ?? ''
  if (single.includes('text')) set.add('text')
  if (single.includes('image')) set.add('image')
  if (single.includes('audio') || single.includes('voice')) set.add('audio')
  if (set.size === 0) set.add('text') // default
  return Array.from(set)
}

export async function GET(): Promise<Response> {
  try {
    const user = await getUser()
    if (!user) return Response.json({ models: [] }, { status: 401 })

    const supabase = await createClient()
    const { data: row } = await supabase
      .from('integrations')
      .select('encrypted_api_key')
      .eq('provider', 'openrouter')
      .limit(1)
      .maybeSingle()

    if (!row?.encrypted_api_key) {
      return Response.json({ models: [] })
    }

    let apiKey: string
    try {
      apiKey = await decrypt(row.encrypted_api_key)
    } catch {
      return Response.json({ models: [] })
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)

    let upstream: Response
    try {
      upstream = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      })
    } catch {
      clearTimeout(timeout)
      return Response.json({ models: [] })
    }
    clearTimeout(timeout)

    if (!upstream.ok) {
      return Response.json({ models: [] })
    }

    const body = (await upstream.json().catch(() => null)) as
      | { data?: OpenRouterApiModel[] }
      | null
    const raw = body?.data ?? []

    const models: NormalisedModel[] = raw
      .filter((m): m is OpenRouterApiModel & { id: string } => typeof m.id === 'string')
      .map((m) => ({
        id: m.id,
        name: m.name ?? m.id,
        modalities: inferModalities(m),
      }))

    return Response.json({ models })
  } catch {
    return Response.json({ models: [] })
  }
}
