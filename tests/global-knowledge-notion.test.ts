import { describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'

describe('Global Knowledge Notion OAuth', () => {
  it('builds the public Notion authorization URL with the canonical callback and CSRF state', async () => {
    const { buildNotionAuthorizationUrl } = await import('@/lib/notion/client')

    const result = buildNotionAuthorizationUrl('csrf-token', {
      clientId: 'notion-client-id',
      redirectUri: 'https://xphere.app/api/notion/callback',
    })
    const url = new URL(result)

    expect(url.origin + url.pathname).toBe('https://api.notion.com/v1/oauth/authorize')
    expect(url.searchParams.get('client_id')).toBe('notion-client-id')
    expect(url.searchParams.get('redirect_uri')).toBe('https://xphere.app/api/notion/callback')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('owner')).toBe('user')
    expect(url.searchParams.get('state')).toBe('csrf-token')
  })
})

describe('Global Knowledge Notion webhook', () => {
  it('accepts only payloads signed with the Notion verification token', async () => {
    const { verifyNotionWebhookSignature } = await import('@/lib/notion/webhook')
    const rawBody = JSON.stringify({ id: 'event-1', type: 'page.content_updated' })
    const token = 'secret-verification-token'
    const signature = `sha256=${createHmac('sha256', token).update(rawBody).digest('hex')}`

    await expect(verifyNotionWebhookSignature(rawBody, signature, token)).resolves.toBe(true)
    await expect(verifyNotionWebhookSignature(`${rawBody} `, signature, token)).resolves.toBe(false)
    await expect(verifyNotionWebhookSignature(rawBody, 'sha256=invalid', token)).resolves.toBe(false)
  })
})

describe('Global Knowledge Notion revisions', () => {
  it('hashes canonical page content and tags chunks with the active revision identity', async () => {
    const {
      buildGlobalKnowledgeDocumentMetadata,
      hashNotionContent,
    } = await import('@/lib/knowledge/notion-content')

    const first = await hashNotionContent('# Title\r\n\r\nBody   \r\n')
    const equivalent = await hashNotionContent('# Title\n\nBody\n')
    const changed = await hashNotionContent('# Title\n\nChanged body\n')

    expect(first).toBe(equivalent)
    expect(changed).not.toBe(first)
    expect(buildGlobalKnowledgeDocumentMetadata({
      sourceId: 'source-1',
      revisionId: 'revision-1',
      notionPageId: 'page-1',
      sourceName: 'Title',
      platform: 'global',
    })).toEqual({
      scope: 'global_knowledge',
      platform: 'global',
      global_knowledge_source_id: 'source-1',
      global_knowledge_revision_id: 'revision-1',
      notion_page_id: 'page-1',
      source_name: 'Title',
    })
  })
})
