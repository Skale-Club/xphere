import { getMcpToken } from '@/app/(dashboard)/projects/actions'
import { McpSettingsClient } from './mcp-settings-client'

export default async function McpSettingsPage() {
  const token = await getMcpToken()

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div>
        <h1 className="text-xl font-semibold">MCP Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Connect external AI agents to Xphere via MCP. One token activates both links.
        </p>
      </div>
      <McpSettingsClient initialToken={token} />
    </div>
  )
}
