// Central tool registry | all McpToolDef arrays are concatenated here and
// the main /api/mcp endpoint pulls from this single list.

import type { McpToolDef } from './tool-types'
import { projectsTools } from './tools/projects'
import { trafficTools } from './tools/traffic'
import { contactsTools } from './tools/contacts'
import { opportunitiesTools } from './tools/opportunities'
import { conversationsTools } from './tools/conversations'
import { tasksTools } from './tools/tasks'

export const ALL_MCP_TOOLS: McpToolDef[] = [
  ...projectsTools,
  ...trafficTools,
  ...contactsTools,
  ...opportunitiesTools,
  ...conversationsTools,
  ...tasksTools,
]

const TOOLS_BY_NAME = new Map(ALL_MCP_TOOLS.map((t) => [t.name, t]))

export function findTool(name: string): McpToolDef | undefined {
  return TOOLS_BY_NAME.get(name)
}
