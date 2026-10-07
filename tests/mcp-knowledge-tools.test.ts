import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FakeDb } from './helpers/fake-supabase'

const state = vi.hoisted(() => ({ db: null as unknown }))

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => state.db,
}))
vi.mock('@/lib/integrations/get-provider-key', () => ({
  getProviderKey: vi.fn(async () => 'org-openai-key'),
}))
vi.mock('@/lib/knowledge/embed', () => ({
  embed: vi.fn(async () => [0.1, 0.2, 0.3]),
}))

import { knowledgeTools } from '@/lib/mcp/tools/knowledge'

const auth = {
  kind: 'legacy_token' as const,
  orgId: '11111111-1111-4111-8111-111111111111',
  userId: null,
  actor: 'mcp:test',
  scope: 'mcp:all',
}

describe('MCP knowledge tools', () => {
  beforeEach(() => {
    state.db = new FakeDb()
  })

  it('passes the requested result limit and tenant filter to match_documents', async () => {
    const db = state.db as FakeDb
    let rpcArgs: Record<string, unknown> | undefined
    db.rpcs.set('match_documents', (args) => {
      rpcArgs = args
      return [{
        content: 'The answer is in this chunk.',
        metadata: { knowledge_source_id: '22222222-2222-4222-8222-222222222222' },
        similarity: 0.91,
      }]
    })

    const tool = knowledgeTools.find((candidate) => candidate.name === 'knowledge_search')
    expect(tool).toBeDefined()

    const result = await tool!.handler({ query: 'answer', top_k: 3 }, { auth })

    expect(rpcArgs).toEqual({
      query_embedding: [0.1, 0.2, 0.3],
      match_count: 3,
      filter: { org_id: auth.orgId },
    })
    expect(result).toEqual({
      matches: [{
        content: 'The answer is in this chunk.',
        source_id: '22222222-2222-4222-8222-222222222222',
        similarity: 0.91,
      }],
    })
  })
})
