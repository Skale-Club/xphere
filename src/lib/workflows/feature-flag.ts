// SEED-025 Phase F: feature flag permanently enabled (deprecated).
//
// The unified workflow engine is now the only path. This function is kept
// for import compatibility but always returns true. It will be removed in
// the next cleanup pass once all callers are deleted.
//
// @deprecated - always returns true; remove callers and this file.

export function isUnifiedEngineEnabled(): boolean {
  return true
}
