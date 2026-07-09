// Variable interpolation for flow node parameters.
// Syntax: {{ path.to.value }} | walks a dot-separated path through the run state.
//
// Examples:
//   "Hello {{ trigger.payload.name }}" + state.trigger.payload.name = "Alice"
//     → "Hello Alice"
//   "{{ steps.act_1.output.contact_id }}" + state.steps.act_1.output.contact_id = "c_42"
//     → "c_42"
// Non-resolvable paths become empty strings.

// Allow hyphens in path segments so node ids like `send-sms` resolve (the sync
// engine already accepts them). Leading char stays restricted to avoid matching
// stray `{{ }}` with operators.
const PATH_PATTERN = /\{\{\s*([a-zA-Z_$][\w$.-]*)\s*\}\}/g

export function interpolate(template: unknown, state: Record<string, unknown>): unknown {
  if (typeof template === 'string') return interpolateString(template, state)
  if (Array.isArray(template)) return template.map((v) => interpolate(v, state))
  if (template !== null && typeof template === 'object') {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(template)) {
      result[k] = interpolate(v, state)
    }
    return result
  }
  return template
}

function interpolateString(template: string, state: Record<string, unknown>): string {
  return template.replace(PATH_PATTERN, (_, path: string) => {
    const value = resolvePath(state, path)
    if (value === undefined || value === null) return ''
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return String(value)
    }
    try {
      return JSON.stringify(value)
    } catch {
      return ''
    }
  })
}

function resolvePath(obj: unknown, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

// Evaluates a condition expression. Linear-first scope: supports very small
// surface | `path op value` where op is ==, !=, >, <, >=, <=, contains.
// JSONata can be wired in later as a richer alternative.
export function evaluateCondition(expression: string, state: Record<string, unknown>): boolean {
  if (!expression.trim()) return true

  const match = expression.match(/^\s*([\w.]+)\s*(==|!=|>=|<=|>|<|contains)\s*(.+?)\s*$/)
  if (!match) {
    // Treat any non-empty resolved value as truthy
    const v = resolvePath(state, expression.trim())
    return Boolean(v)
  }

  const [, lhsPath, op, rhsRaw] = match
  const lhs = resolvePath(state, lhsPath)
  const rhs = parseValue(rhsRaw)

  switch (op) {
    case '==': return lhs == rhs
    case '!=': return lhs != rhs
    case '>':  return Number(lhs) > Number(rhs)
    case '<':  return Number(lhs) < Number(rhs)
    case '>=': return Number(lhs) >= Number(rhs)
    case '<=': return Number(lhs) <= Number(rhs)
    case 'contains': return String(lhs ?? '').includes(String(rhs))
    default:   return false
  }
}

function parseValue(raw: string): unknown {
  const trimmed = raw.trim()
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed === 'null') return null
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  const num = Number(trimmed)
  if (!Number.isNaN(num)) return num
  return trimmed
}
