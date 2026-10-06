// A pointer from something the AI did (a proposed ads change, a journey
// memory) to the Global Knowledge source that grounded it. Stored as JSONB on
// ads_change_requests.knowledge_refs and ads_memories.knowledge_refs, so the
// outcome reviewer can later say "this advice, from this lesson, produced
// this result".

import { z } from 'zod'

export type KnowledgeRef = {
  source_id: string
  source_name: string | null
  url: string | null
}

export const KnowledgeRefInputSchema = z
  .object({
    source_id: z.string().uuid().describe('global_knowledge_source_id returned by global_knowledge_search'),
    source_name: z.string().max(300).optional(),
    url: z.string().url().max(2000).optional(),
  })
  .strict()

export const KnowledgeRefsInputSchema = z.array(KnowledgeRefInputSchema).max(20)

export type KnowledgeRefInput = z.infer<typeof KnowledgeRefInputSchema>

/** Dedupe by source and fill the nullable shape stored in the database. */
export function normalizeKnowledgeRefs(refs: readonly KnowledgeRefInput[] | null | undefined): KnowledgeRef[] {
  const seen = new Map<string, KnowledgeRef>()
  for (const ref of refs ?? []) {
    if (seen.has(ref.source_id)) continue
    seen.set(ref.source_id, {
      source_id: ref.source_id,
      source_name: ref.source_name?.trim() || null,
      url: ref.url ?? null,
    })
  }
  return Array.from(seen.values())
}

/** Read refs back from a JSONB column, tolerating legacy/malformed rows. */
export function parseStoredKnowledgeRefs(value: unknown): KnowledgeRef[] {
  if (!Array.isArray(value)) return []
  const out: KnowledgeRef[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    if (typeof record.source_id !== 'string') continue
    out.push({
      source_id: record.source_id,
      source_name: typeof record.source_name === 'string' ? record.source_name : null,
      url: typeof record.url === 'string' ? record.url : null,
    })
  }
  return out
}
