// SEED-025 Phase C: unified workflow engine is now ON by default.
//
// Opt out by setting UNIFIED_WORKFLOW_ENGINE=off.
// The resolver returns the same ToolConfigWithIntegration shape whether
// reading from legacy tool_configs or from workflows WHERE kind='tool',
// so all callers (Vapi, ManyChat, Evolution, Meta, Twilio, agent runtime)
// continue to work unchanged.

export function isUnifiedEngineEnabled(): boolean {
  return process.env.UNIFIED_WORKFLOW_ENGINE !== 'off'
}
