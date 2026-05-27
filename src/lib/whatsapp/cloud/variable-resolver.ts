/**
 * Resolve template variable mappings into concrete strings for a recipient.
 *
 * A mapping is `{ body: [{ source: 'contact.first_name' }, ...], header: [...] }`.
 * Sources understood:
 *   - `contact.<field>`           → contacts.first_name / last_name / email / phone / company / name
 *   - `custom_fields.<key>`       → contacts.custom_fields[key]
 *   - `literal:<string>`          → the literal string after `literal:`
 *
 * Missing values resolve to the empty string by default (Meta will reject
 * empty positional params; callers should validate before sending).
 */

export interface VariableMapping {
  body?: Array<{ source: string }>
  header?: Array<{ source: string }>
}

export interface ContactShape {
  first_name: string | null
  last_name: string | null
  name: string | null
  email: string | null
  phone: string | null
  company: string | null
  custom_fields: Record<string, unknown> | null
}

export function resolveVariables(
  mapping: VariableMapping | null | undefined,
  contact: ContactShape,
): { body: string[]; header: string[] } {
  const body = (mapping?.body ?? []).map((entry) => resolveOne(entry.source, contact))
  const header = (mapping?.header ?? []).map((entry) => resolveOne(entry.source, contact))
  return { body, header }
}

function resolveOne(source: string, contact: ContactShape): string {
  if (!source) return ''

  if (source.startsWith('literal:')) {
    return source.slice('literal:'.length)
  }

  if (source.startsWith('contact.')) {
    const field = source.slice('contact.'.length) as keyof ContactShape
    const value = contact[field]
    return typeof value === 'string' ? value : value == null ? '' : String(value)
  }

  if (source.startsWith('custom_fields.')) {
    const key = source.slice('custom_fields.'.length)
    const value = contact.custom_fields?.[key]
    return value == null ? '' : String(value)
  }

  return ''
}
