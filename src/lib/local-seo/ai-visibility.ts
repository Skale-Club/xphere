import 'server-only'

// AI visibility (Phase 7): ask assistants that search the web "what are the
// best <keyword> in <area>?" and record whether the business is mentioned, at
// which position of the answer's list, and who else is. Runs through
// OpenRouter with the org's key (or the platform's); web-search models are
// configurable with LOCAL_SEO_AI_MODELS.

import { randomUUID } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'
import { createOpenRouterClient, resolveOpenRouterCredential } from '@/lib/llm/openrouter'

import { guessArea } from './citations'
import { normalizeName } from './matching'

type Admin = SupabaseClient<Database>

// Perplexity Sonar searches natively; ":online" adds OpenRouter's web plugin.
const DEFAULT_MODELS = ['perplexity/sonar', 'openai/gpt-4o-mini:online']
const MAX_PROMPTS = 3

export function aiModels(): string[] {
  const raw = process.env.LOCAL_SEO_AI_MODELS?.split(',').map((s) => s.trim()).filter(Boolean)
  return raw?.length ? raw : DEFAULT_MODELS
}

export function buildPrompt(keyword: string, area: string, language: string): string {
  return language.startsWith('pt')
    ? `Quais são as melhores opções de ${keyword}${area ? ` em ${area}` : ''}? Liste as 5 melhores com o nome do estabelecimento e um motivo curto.`
    : `What are the best ${keyword} options${area ? ` in ${area}` : ''}? List the top 5 with the business name and a short reason.`
}

/** Words that identify a business less than its distinctive name does. */
const GENERIC = new Set(['the', 'and', 'de', 'da', 'do', 'e', 'barbearia', 'barber', 'shop', 'salon', 'salao', 'restaurante', 'restaurant', 'cafe', 'clinica', 'clinic', 'ltda', 'llc', 'inc', 'co'])

function distinctive(name: string): string {
  const words = normalizeName(name).split(' ').filter((w) => w && !GENERIC.has(w))
  return words.join(' ') || normalizeName(name)
}

export type AiVerdict = { mentioned: boolean; position: number | null; competitors: string[]; excerpt: string | null }

/** Find the business in an answer and the businesses listed around it. Pure. */
export function analyzeAnswer(answer: string, businessName: string): AiVerdict {
  const lines = answer.split('\n').map((l) => l.trim()).filter(Boolean)
  const items = lines.filter((l) => /^(\d+[.)]|[-*•])\s+/.test(l))
  const nameOf = (line: string) => {
    const bold = line.match(/\*\*(.+?)\*\*/)?.[1]
    const plain = line.replace(/^(\d+[.)]|[-*•])\s+/, '').split(/\s[–—-]\s|:\s|\(/)[0]
    return (bold ?? plain).replace(/[*_[\]]/g, '').trim().slice(0, 120)
  }
  const target = distinctive(businessName)
  const mentionedIn = (text: string) => target.length >= 3 && normalizeName(text).includes(target)

  const index = items.findIndex(mentionedIn)
  const anyLine = lines.find(mentionedIn) ?? null
  return {
    mentioned: index >= 0 || anyLine !== null,
    position: index >= 0 ? index + 1 : null,
    competitors: items
      .filter((l) => !mentionedIn(l))
      .map(nameOf)
      .filter(Boolean)
      .slice(0, 10),
    excerpt: (index >= 0 ? items[index] : anyLine)?.slice(0, 400) ?? answer.slice(0, 300),
  }
}

export async function runAiVisibilityCheck(
  admin: Admin,
  input: { orgId: string; locationId: string; area?: string },
): Promise<{ ok: true; runId: string; mentioned: number; total: number } | { ok: false; error: string }> {
  const { data: loc } = await admin.from('local_seo_locations').select('*').eq('id', input.locationId).eq('org_id', input.orgId).maybeSingle()
  if (!loc) return { ok: false, error: 'Location not found.' }
  const { data: keywords } = await admin
    .from('local_seo_keywords')
    .select('keyword')
    .eq('location_id', loc.id)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(MAX_PROMPTS)
  if (!keywords?.length) return { ok: false, error: 'Add keywords to this location first.' }

  let client
  try {
    client = createOpenRouterClient((await resolveOpenRouterCredential(input.orgId, admin)).apiKey)
  } catch {
    return { ok: false, error: 'No AI key is configured for this organization.' }
  }

  const area = (input.area ?? guessArea(loc.address)).trim()
  const runId = randomUUID()
  const jobs = keywords.flatMap((k) => aiModels().map((model) => ({ prompt: buildPrompt(k.keyword, area, loc.language), model })))
  const rows = await Promise.all(
    jobs.map(async ({ prompt, model }) => {
      try {
        const res = await client.chat.completions.create({ model, max_tokens: 900, temperature: 0.2, messages: [{ role: 'user', content: prompt }] })
        const v = analyzeAnswer(res.choices[0]?.message?.content ?? '', loc.business_name)
        return { prompt, model, mentioned: v.mentioned, position: v.position, competitors: v.competitors, excerpt: v.excerpt, error: null }
      } catch (err) {
        return { prompt, model, mentioned: false, position: null, competitors: [], excerpt: null, error: (err as Error).message.slice(0, 300) }
      }
    }),
  )
  await admin.from('local_seo_ai_checks').insert(rows.map((r) => ({ ...r, org_id: input.orgId, location_id: loc.id, run_id: runId })))
  return { ok: true, runId, mentioned: rows.filter((r) => r.mentioned).length, total: rows.length }
}
