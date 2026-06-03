import { getMcpToken } from '@/app/(dashboard)/projects/actions'
import { McpSettingsClient } from './mcp-settings-client'
import { PageContainer } from '@/components/layout/page-header'

export default async function McpSettingsPage() {
  const token = await getMcpToken()

  return (
    <PageContainer className="space-y-6">
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold">MCP Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Connect external AI agents to Xphere via MCP. One token activates both links.
          </p>
        </div>
        <McpSettingsClient initialToken={token} />
      </div>
    </PageContainer>
  )
}
