// Central registry: collects all domain tools.

import type { CopilotTool, CopilotToolRegistry } from './types'
import { contactTools } from './contacts'
import { accountTools } from './accounts'
import { pipelineTools } from './pipeline'
import { taskTools } from './tasks'
import { noteTools } from './notes'
import { workflowTools } from './workflows'
import { trafficTools } from './traffic'

export const ALL_TOOLS: CopilotToolRegistry = {
  ...contactTools,
  ...accountTools,
  ...pipelineTools,
  ...taskTools,
  ...noteTools,
  ...workflowTools,
  ...trafficTools,
}

export function getActiveTools(writeMode: boolean): CopilotToolRegistry {
  const out: CopilotToolRegistry = {}
  for (const [name, tool] of Object.entries(ALL_TOOLS)) {
    if (tool.mode === 'read') out[name] = tool
    else if (writeMode) out[name] = tool
  }
  return out
}

export type { CopilotTool, CopilotToolRegistry }
