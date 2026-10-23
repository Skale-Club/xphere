// Game events ride the generic analytics pipeline as event_type = 'game'
// with an event_name (match_start, screen_view, ...). Plan: BS-ANALYTICS-001.
//
// Validation lives here so the ingest path and the tests share one source of
// truth. It mirrors the database CHECK in migration 1332:
//   event_name ~ '^[a-z][a-z0-9_]{0,47}$'

export const GAME_EVENT_TYPE = 'game'

export const GAME_EVENT_NAME_MAX_LENGTH = 48
export const GAME_METADATA_MAX_BYTES = 4096

const GAME_EVENT_NAME_RE = /^[a-z][a-z0-9_]{0,47}$/

/** True for lowercase snake_case names of 1..48 characters starting with a letter. */
export function isValidGameEventName(name: unknown): name is string {
  return typeof name === 'string' && GAME_EVENT_NAME_RE.test(name)
}

/**
 * Returns the metadata to store, or null when it must be rejected.
 * A game event's metadata must be a plain JSON object (not an array, not null)
 * whose serialized form is at most GAME_METADATA_MAX_BYTES bytes. Missing
 * metadata is allowed and becomes {}.
 */
export function sanitizeGameMetadata(metadata: unknown): Record<string, unknown> | null {
  if (metadata === undefined || metadata === null) return {}
  if (typeof metadata !== 'object' || Array.isArray(metadata)) return null
  let serialized: string
  try {
    serialized = JSON.stringify(metadata)
  } catch {
    return null
  }
  if (Buffer.byteLength(serialized, 'utf8') > GAME_METADATA_MAX_BYTES) return null
  return metadata as Record<string, unknown>
}

export interface ValidGameEvent {
  event_name: string
  metadata: Record<string, unknown>
}

/** Validates the game-specific part of an ingest payload. null = drop the event. */
export function validateGameEvent(payload: {
  event_name?: unknown
  metadata?: unknown
}): ValidGameEvent | null {
  if (!isValidGameEventName(payload.event_name)) return null
  const metadata = sanitizeGameMetadata(payload.metadata)
  if (!metadata) return null
  return { event_name: payload.event_name, metadata }
}

// ─── Session context (connection type, screen size) ───────────────────────────

const CONNECTION_TYPES = new Set(['slow-2g', '2g', '3g', '4g'])

/** navigator.connection.effectiveType, or null for anything unexpected. */
export function normalizeConnectionType(value: unknown): string | null {
  return typeof value === 'string' && CONNECTION_TYPES.has(value) ? value : null
}

/** Screen dimension in CSS pixels, or null when absent / implausible. */
export function normalizeScreenDimension(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const n = Math.round(value)
  return n >= 1 && n <= 20000 ? n : null
}
