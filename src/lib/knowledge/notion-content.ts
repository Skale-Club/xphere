export type GlobalKnowledgePlatform = 'meta' | 'google' | 'global'

export function normalizeNotionMarkdown(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim()
}

export async function hashNotionContent(markdown: string): Promise<string> {
  const bytes = new TextEncoder().encode(normalizeNotionMarkdown(markdown))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function buildGlobalKnowledgeDocumentMetadata(params: {
  sourceId: string
  revisionId: string
  notionPageId: string
  sourceName: string
  platform: GlobalKnowledgePlatform
}) {
  return {
    scope: 'global_knowledge',
    platform: params.platform,
    global_knowledge_source_id: params.sourceId,
    global_knowledge_revision_id: params.revisionId,
    notion_page_id: params.notionPageId,
    source_name: params.sourceName,
  }
}

