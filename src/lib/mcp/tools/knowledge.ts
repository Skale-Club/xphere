// MCP tools for the knowledge base.
// Table: knowledge_sources (organization_id — legacy column).
// Embeddings stored in `documents` with pgvector; query via `match_documents` RPC.

import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { getProviderKey } from '@/lib/integrations/get-provider-key'
import { embed } from '@/lib/knowledge/embed'
import { chunkText } from '@/lib/knowledge/chunk-text'
import type { McpToolDef } from '../tool-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return createServiceRoleClient() as any }

export const knowledgeTools: McpToolDef[] = [
  {
    name: 'knowledge_list',
    title: 'List knowledge sources',
    description: 'List knowledge base sources in the current org. Optional status filter.',
    area: 'general_xphere',
    inputSchema: z.object({
      status: z.enum(['processing', 'ready', 'error']).optional(),
    }).strict(),
    handler: async ({ status }, { auth }) => {
      let q = db()
        .from('knowledge_sources')
        .select('id, name, source_type, source_url, status, error_detail, chunk_count, created_at, updated_at')
        .eq('organization_id', auth.orgId)
        .order('created_at', { ascending: false })
      if (status) q = q.eq('status', status)
      const { data } = await q
      return { sources: data ?? [] }
    },
  },
  {
    name: 'knowledge_get',
    title: 'Get knowledge source',
    description: 'Fetch a single knowledge source by id.',
    area: 'general_xphere',
    inputSchema: z.object({ source_id: z.string().uuid() }).strict(),
    handler: async ({ source_id }, { auth }) => {
      const { data } = await db()
        .from('knowledge_sources')
        .select('*')
        .eq('id', source_id)
        .eq('organization_id', auth.orgId)
        .maybeSingle()
      if (!data) return { error: 'not_found', status: 404 }
      return data
    },
  },
  {
    name: 'knowledge_search',
    title: 'Semantic search of the knowledge base',
    description: 'Embeds the query with OpenAI text-embedding-3-small and runs a similarity search across the org\'s knowledge. Returns raw matches (content + source_id + similarity) so the agent can synthesize an answer.',
    area: 'general_xphere',
    inputSchema: z.object({
      query: z.string().min(1),
      top_k: z.number().int().positive().max(20).optional(),
    }).strict(),
    handler: async ({ query, top_k = 5 }, { auth }) => {
      const supabase = db()
      const openaiKey = await getProviderKey('openai', auth.orgId, supabase)
      if (!openaiKey) {
        return { error: 'no_openai_key', detail: 'org has no OpenAI integration configured — required to embed the query' }
      }
      let vector: number[]
      try {
        vector = await embed(query.trim(), openaiKey)
      } catch (e) {
        return { error: 'embed_failed', detail: e instanceof Error ? e.message : String(e) }
      }
      // The match_documents RPC accepts (query_embedding, match_count, filter)
      // and filters by `metadata->>org_id` via the `filter` JSONB. The existing
      // queryKnowledge uses { org_id } via LangChain's wrapper, which the RPC
      // expands to a filter on metadata.
      const { data, error } = await supabase.rpc('match_documents', {
        query_embedding: vector,
        match_count: top_k,
        filter: { org_id: auth.orgId },
      })
      if (error) return { error: 'search_failed', detail: error.message }
      type DocMatch = { content: string; metadata: Record<string, unknown>; similarity?: number }
      const matches = (data as DocMatch[] | null ?? []).map((m) => ({
        content: m.content,
        source_id: (m.metadata?.knowledge_source_id as string | undefined) ?? null,
        similarity: m.similarity ?? null,
      }))
      return { matches }
    },
  },
  {
    name: 'knowledge_add_text',
    title: 'Add a text snippet to the knowledge base',
    description: 'Ingests a text snippet inline: creates a knowledge source, chunks the text, embeds each chunk via OpenAI text-embedding-3-small, and inserts into the documents table. Synchronous — returns when ready. For large pastes consider splitting at the caller.',
    area: 'general_xphere',
    inputSchema: z.object({
      name: z.string().min(1).max(200),
      content: z.string().min(1).max(200_000),
    }).strict(),
    handler: async ({ name, content }, { auth }) => {
      const supabase = db()
      const openaiKey = await getProviderKey('openai', auth.orgId, supabase)
      if (!openaiKey) {
        return { error: 'no_openai_key', detail: 'org has no OpenAI integration configured' }
      }

      // 1) Create the knowledge_source row in processing state.
      const { data: source, error: insertErr } = await supabase
        .from('knowledge_sources')
        .insert({
          organization_id: auth.orgId,
          name: name.trim(),
          source_type: 'text',
          source_url: null,
          status: 'processing',
          chunk_count: 0,
        })
        .select('id')
        .single()
      if (insertErr) return { error: 'insert_failed', detail: insertErr.message }

      // 2) Chunk + embed + insert documents.
      const chunks = chunkText(content, 500, 50)
      if (chunks.length === 0) {
        await supabase
          .from('knowledge_sources')
          .update({ status: 'error', error_detail: 'no chunks produced from input' })
          .eq('id', source.id)
        return { error: 'empty_content', detail: 'input produced zero chunks' }
      }

      try {
        const docRows: Array<{ content: string; embedding: number[]; metadata: Record<string, unknown>; knowledge_source_id: string }> = []
        for (const chunk of chunks) {
          const vector = await embed(chunk, openaiKey)
          docRows.push({
            content: chunk,
            embedding: vector,
            metadata: { org_id: auth.orgId, knowledge_source_id: source.id, name: name.trim() },
            knowledge_source_id: source.id,
          })
        }
        const { error: docErr } = await supabase.from('documents').insert(docRows)
        if (docErr) throw new Error(docErr.message)

        await supabase
          .from('knowledge_sources')
          .update({ status: 'ready', chunk_count: chunks.length })
          .eq('id', source.id)

        return { source_id: source.id, status: 'ready', chunk_count: chunks.length }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        await supabase
          .from('knowledge_sources')
          .update({ status: 'error', error_detail: msg })
          .eq('id', source.id)
        return { error: 'embedding_failed', detail: msg }
      }
    },
  },
]
