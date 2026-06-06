// src/lib/knowledge/query-knowledge.ts
// Hot path: LangChain SupabaseVectorStore similarity search → synthesize answer
// AI provider resolved via shared resolver (OpenRouter first, Anthropic fallback).
// Budget: ~50ms embed + ~50ms search + ~200ms synthesis = ~300ms (within 500ms Vapi limit)
//
// Q4: Similarity threshold (default 0.5) — low-quality chunks are filtered out
//     before synthesis, reducing hallucinations on sparse KB hits.
// Q5: rawMode option — skips synthesis and returns formatted chunks with source
//     citations. Callers that inject the KB result into a system prompt (e.g.
//     run-agent.ts) should set rawMode:true so the agent LLM has full context.
//     Voice/tool paths that return the KB answer directly (execute-action.ts)
//     keep rawMode:false (default) for synthesized brevity.

import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { SupabaseVectorStore } from '@langchain/community/vectorstores/supabase'
import { OpenAIEmbeddings } from '@langchain/openai'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { getProviderKey } from '@/lib/integrations/get-provider-key'
import { resolveCopilotProvider } from '@/lib/copilot/resolve-provider'
import { createLogger } from '@/lib/obs/logger'

const FALLBACK_RESPONSE = "I don't have information about that in my knowledge base."

// Q4: Minimum cosine similarity score for a chunk to be included.
// Supabase returns values in [0, 1] where 1 = identical.
const DEFAULT_SIMILARITY_THRESHOLD = 0.5

export type QueryKnowledgeOpts = {
  /**
   * When true, skips LLM synthesis and returns raw chunks formatted with
   * source metadata. Ideal for system-prompt injection where the downstream
   * agent LLM can reason directly over the full chunk text.  (Q5)
   */
  rawMode?: boolean
  /**
   * Minimum cosine similarity score [0–1] for a chunk to be included.
   * Chunks below this threshold are discarded before synthesis or injection.
   * Defaults to 0.5.  (Q4)
   */
  threshold?: number
}

export async function queryKnowledge(
  query: string,
  organizationId: string,
  supabase: SupabaseClient<Database>,
  opts?: QueryKnowledgeOpts,
): Promise<string> {
  const log = createLogger({ organizationId })
  const rawMode = opts?.rawMode ?? false
  const threshold = opts?.threshold ?? DEFAULT_SIMILARITY_THRESHOLD

  try {
    if (!query.trim()) return FALLBACK_RESPONSE

    // Step 1: Fetch OpenAI key for embedding
    const openaiKey = await getProviderKey('openai', organizationId, supabase)
    if (!openaiKey) return FALLBACK_RESPONSE

    // Step 2: Build LangChain SupabaseVectorStore with org-scoped filter
    const embeddings = new OpenAIEmbeddings({
      apiKey: openaiKey,
      model: 'text-embedding-3-small',
    })

    // LangChain's SupabaseVectorStore types against an untyped SupabaseClient,
    // but it only uses .from()/.rpc() at runtime | both work with our typed client.
    const vectorStore = new SupabaseVectorStore(embeddings, {
      client: supabase as unknown as SupabaseClient,
      tableName: 'documents',
      queryName: 'match_documents',
    })

    // Step 3: Similarity search with scores — Q4 threshold filtering (~100ms)
    const rawResults = await vectorStore.similaritySearchWithScore(query.trim(), 5, {
      org_id: organizationId,
    })

    // Q4: Discard chunks below threshold
    const results = rawResults.filter(([, score]) => score >= threshold)

    if (results.length === 0) return FALLBACK_RESPONSE

    // Q5: rawMode — return formatted chunks with source citations
    if (rawMode) {
      const chunks = results.map(([doc, score], i) => {
        const source = (doc.metadata as Record<string, unknown>)?.source
          ?? (doc.metadata as Record<string, unknown>)?.file_name
          ?? `chunk-${i + 1}`
        return `[Source: ${source} | score: ${score.toFixed(3)}]\n${doc.pageContent}`
      })
      return chunks.join('\n\n---\n\n')
    }

    // Step 4: Synthesize answer | resolver picks OpenRouter first, Anthropic last (~200ms)
    const context = results.map(([doc]) => doc.pageContent).join('\n\n---\n\n')

    const synthesisPrompt = `Answer the following question using ONLY the provided context. Be concise | 2-3 sentences maximum. If the context does not contain the answer, say you don't have that information.\n\nContext:\n${context}\n\nQuestion: ${query}`

    // Hot path: prefer Haiku for sub-500ms latency.
    const provider = await resolveCopilotProvider(organizationId, {
      openrouterModel: 'anthropic/claude-haiku-4-5',
      anthropicModel: 'claude-haiku-4-5-20251001',
    })
    if (!provider) return FALLBACK_RESPONSE

    if (provider.kind === 'openrouter') {
      const client = new OpenAI({
        apiKey: provider.apiKey,
        baseURL: 'https://openrouter.ai/api/v1',
      })
      const completion = await client.chat.completions.create({
        model: provider.model,
        max_tokens: 256,
        messages: [{ role: 'user', content: synthesisPrompt }],
      })
      return completion.choices[0]?.message?.content ?? FALLBACK_RESPONSE
    }

    const anthropicClient = new Anthropic({ apiKey: provider.apiKey })
    const message = await anthropicClient.messages.create({
      model: provider.model,
      max_tokens: 256,
      messages: [{ role: 'user', content: synthesisPrompt }],
    })

    const textBlock = message.content.find((b) => b.type === 'text')
    return textBlock?.text ?? FALLBACK_RESPONSE

  } catch (err) {
    log.error('query_knowledge_failed', { error: (err as Error).message })
    return FALLBACK_RESPONSE
  }
}
