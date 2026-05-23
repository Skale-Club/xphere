export interface ContactNameParts {
  first_name?: string | null
  last_name?: string | null
  name?: string | null
}

function cleanNamePart(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export function composeContactName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string | null {
  return [cleanNamePart(firstName), cleanNamePart(lastName)].filter(Boolean).join(' ') || null
}

export function splitContactName(name: string | null | undefined): {
  firstName: string | null
  lastName: string | null
} {
  const trimmed = cleanNamePart(name)
  if (!trimmed) return { firstName: null, lastName: null }

  const [first, ...rest] = trimmed.split(/\s+/)
  return {
    firstName: first || null,
    lastName: rest.length > 0 ? rest.join(' ') : null,
  }
}

export function displayContactName(
  contact: ContactNameParts | null | undefined,
  fallback = 'Unnamed contact',
): string {
  if (!contact) return fallback
  return (
    composeContactName(contact.first_name, contact.last_name) ??
    cleanNamePart(contact.name) ??
    fallback
  )
}

export function initialsFromContactName(
  contact: ContactNameParts | null | undefined,
  fallback = '?',
): string {
  const display = displayContactName(contact, fallback)
  return display.replace(/[^a-zA-Z0-9]/g, '').charAt(0).toUpperCase() || fallback
}
