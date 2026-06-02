// src/lib/obs/logger.ts
// Structured JSON logger with bound context (correlation ids like trace_id / org_id).
// Zero-dependency, Edge- and Node-safe. Emits one JSON object per line to stdout/stderr
// so logs become queryable once shipped (Coolify stdout -> log store).
//
// Usage:
//   import { createLogger } from '@/lib/obs/logger'
//   const log = createLogger({ traceId, orgId, route: '/api/vapi/tools' })
//   log.info('agent_turn_start', { agentId })
//   log.error('tool_failed', { tool, error: err })
//   const child = log.child({ agentId }) // adds / overrides context for downstream logs
//
// Output shape (one line):
//   {"level":"info","event":"agent_turn_start","time":"2026-...Z","traceId":"...","orgId":"...","agentId":"..."}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogContext = Record<string, unknown>

export interface Logger {
  debug(event: string, fields?: LogContext): void
  info(event: string, fields?: LogContext): void
  warn(event: string, fields?: LogContext): void
  error(event: string, fields?: LogContext): void
  /** Returns a new logger with `context` merged on top of the current context. */
  child(context: LogContext): Logger
}

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

function thresholdLevel(): number {
  const raw = (process.env.LOG_LEVEL ?? 'info').toLowerCase()
  return LEVELS[raw as LogLevel] ?? LEVELS.info
}

// Make arbitrary values JSON-safe: unwrap Errors, drop `undefined`, guard cycles.
function normalize(value: unknown, seen: WeakSet<object>): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack }
  }
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value as object)) return '[Circular]'
  seen.add(value as object)
  if (Array.isArray(value)) return value.map((v) => normalize(v, seen))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v !== undefined) out[k] = normalize(v, seen)
  }
  return out
}

function emit(level: LogLevel, base: LogContext, event: string, fields?: LogContext): void {
  if (LEVELS[level] < thresholdLevel()) return
  const record = { level, event, time: new Date().toISOString(), ...base, ...(fields ?? {}) }
  let line: string
  try {
    line = JSON.stringify(normalize(record, new WeakSet()))
  } catch {
    line = JSON.stringify({ level, event, time: new Date().toISOString(), logError: 'serialize_failed' })
  }
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

/** Create a structured logger with optional bound context (e.g. correlation ids). */
export function createLogger(context: LogContext = {}): Logger {
  return {
    debug: (event, fields) => emit('debug', context, event, fields),
    info: (event, fields) => emit('info', context, event, fields),
    warn: (event, fields) => emit('warn', context, event, fields),
    error: (event, fields) => emit('error', context, event, fields),
    child: (extra) => createLogger({ ...context, ...extra }),
  }
}
