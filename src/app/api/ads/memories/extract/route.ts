import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'

import { createClient, getUser } from '@/lib/supabase/server'
import { createMemory } from '@/lib/ads/journey-db'
import type { AdsMemoryType } from '@/lib/ads/journey-db'

export const runtime = 'nodejs'

function err(msg: string, status = 400) {
  return Response.json({ error: msg }, { status })
}

const ExtractSchema = z.object({
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).min(2),
  platform: z.enum(['meta', 'google']).optional(),
})

// POST /api/ads/memories/extract
// Receives a completed conversation and uses Claude to extract 0-3 memories.
// Saves them as 'needs_review' and returns the proposed list.
export async function POST(request: NextRequest): Promise<Response> {
  const user = await getUser()
  if (!user) return err('Unauthorized', 401)

  let body: unknown
  try { body = await request.json() } catch { return err('Invalid JSON') }

  const parsed = ExtractSchema.safeParse(body)
  if (!parsed.success) return err(parsed.error.message)

  const { messages, platform } = parsed.data

  // Only extract from conversations that have meaningful content
  const userMessages = messages.filter((m) => m.role === 'user')
  const assistantMessages = messages.filter((m) => m.role === 'assistant' && m.content.length > 50)
  if (userMessages.length < 1 || assistantMessages.length < 1) {
    return Response.json({ memories: [] })
  }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return err('No active org')

  const conversationText = messages
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n')

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  let extracted: Array<{
    type: string
    title: string
    content: string
    campaign_name?: string
    confidence: number
  }> = []

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `Analyze this ads management conversation and extract 0-3 key insights, decisions, plans, risks, or observations worth remembering for future sessions.

Only extract things that are genuinely useful context for future conversations: strategic decisions made, performance insights discovered, plans established, risks identified, or goals set.
Skip small talk, tool output summaries, or anything already obvious.

Return ONLY valid JSON in this exact format:
{"memories":[{"type":"insight|decision|plan|risk|observation|result|goal","title":"short title max 80 chars","content":"concise description max 300 chars","campaign_name":"campaign name if specific","confidence":1-5}]}

If nothing notable: {"memories":[]}

Conversation:
${conversationText.slice(0, 6000)}`,
        },
      ],
    })

    const text = response.content.find((b) => b.type === 'text')?.text ?? ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed2 = JSON.parse(jsonMatch[0]) as { memories?: unknown[] }
      if (Array.isArray(parsed2.memories)) {
        extracted = parsed2.memories.slice(0, 3) as typeof extracted
      }
    }
  } catch {
    return Response.json({ memories: [] })
  }

  const created: Array<{ id: string; title: string; type: string }> = []

  for (const m of extracted) {
    const validTypes = ['insight', 'decision', 'plan', 'risk', 'observation', 'result', 'goal']
    if (!validTypes.includes(m.type)) continue
    if (!m.title?.trim() || !m.content?.trim()) continue

    const id = await createMemory({
      orgId: orgId as string,
      type: m.type as AdsMemoryType,
      source: 'chat',
      platform,
      title: m.title.trim().slice(0, 200),
      content: m.content.trim().slice(0, 2000),
      campaignName: m.campaign_name?.trim(),
      confidence: Math.min(5, Math.max(1, Math.round(m.confidence ?? 3))),
      proposed: true,
      status: 'needs_review',
    })

    if (id) created.push({ id, title: m.title, type: m.type })
  }

  return Response.json({ memories: created })
}
