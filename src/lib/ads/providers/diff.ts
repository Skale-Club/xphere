import { formatCurrency } from '../currency'
import type { DiffEntry } from '../commands/types'

function display(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (Array.isArray(value)) return value.length ? value.join(', ') : '(all)'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function diffField(field: string, label: string, before: unknown, after: unknown): DiffEntry {
  return { field, label, before: before ?? null, after, beforeDisplay: display(before), afterDisplay: display(after) }
}

export function diffMoney(field: string, label: string, before: number | null, after: number, currency: string): DiffEntry {
  return {
    field,
    label,
    before,
    after,
    beforeDisplay: before == null ? '—' : formatCurrency(before, currency),
    afterDisplay: formatCurrency(after, currency),
  }
}

/** Drop entries whose value doesn't actually change. */
export function effective(diff: DiffEntry[]): DiffEntry[] {
  return diff.filter((d) => JSON.stringify(d.before) !== JSON.stringify(d.after))
}

/** Compare intended fields against a fresh read, tolerant of number/string drift. */
export function compareFields(
  intended: Record<string, unknown>,
  observed: Record<string, unknown>,
): Array<{ field: string; expected: unknown; actual: unknown }> {
  const mismatches: Array<{ field: string; expected: unknown; actual: unknown }> = []
  for (const [field, expected] of Object.entries(intended)) {
    const actual = observed[field]
    const same =
      typeof expected === 'number' || typeof actual === 'number'
        ? Math.abs(Number(expected) - Number(actual)) < 1e-6
        : JSON.stringify(normalize(expected)) === JSON.stringify(normalize(actual))
    if (!same) mismatches.push({ field, expected, actual })
  }
  return mismatches
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return [...value].map(normalize).sort()
  return value ?? null
}
