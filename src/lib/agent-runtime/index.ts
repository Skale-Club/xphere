// src/lib/agent-runtime/index.ts
// Public API of the agent-runtime module.
// Phase 35 will import runAgent from here to wire it into the web widget endpoint.

export { runAgent } from './run-agent'
export type { AgentRunResult, AgentRunOptions } from './types'
