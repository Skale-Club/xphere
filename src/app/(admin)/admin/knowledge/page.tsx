import {
  getGlobalKnowledgeNotionState,
  getGlobalKnowledgeSources,
  hasPlatformOpenRouterKey,
} from './_actions/knowledge'
import { GlobalKnowledgeManager } from '@/components/admin/global-knowledge/knowledge-manager'

export const dynamic = 'force-dynamic'

export default async function AdminGlobalKnowledgePage() {
  const [sources, hasKey, notionState] = await Promise.all([
    getGlobalKnowledgeSources(),
    hasPlatformOpenRouterKey(),
    getGlobalKnowledgeNotionState(),
  ])

  return (
    <div className="w-full p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-text-primary">Knowledge Base</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Manage the trusted sources Copilot and MCP use for campaign diagnostics and media plans.
        </p>
      </div>
      <GlobalKnowledgeManager
        sources={sources as Parameters<typeof GlobalKnowledgeManager>[0]['sources']}
        disabled={!hasKey}
        notionState={notionState as Parameters<typeof GlobalKnowledgeManager>[0]['notionState']}
      />
    </div>
  )
}
