import { getPlaybookSources, hasPlatformOpenRouterKey } from './_actions/playbook'
import { PlaybookManager } from '@/components/admin/ads-playbook/playbook-manager'

export const dynamic = 'force-dynamic'

export default async function AdminAdsPlaybookPage() {
  const [sources, hasKey] = await Promise.all([
    getPlaybookSources(),
    hasPlatformOpenRouterKey(),
  ])

  return (
    <div className="w-full p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-text-primary">Knowledge Base</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Manage the trusted sources Copilot and MCP use for campaign diagnostics and media plans.
        </p>
      </div>
      <PlaybookManager
        sources={sources as Parameters<typeof PlaybookManager>[0]['sources']}
        disabled={!hasKey}
      />
    </div>
  )
}
