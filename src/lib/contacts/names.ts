export interface ContactNameParts {
  first_name?: string | null
  last_name?: string | null
  name?: string | null
}

function cleanNamePart(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

// Name particles that stay lowercase when they aren't the leading word
// (Portuguese/Spanish/Italian/French/Dutch/German). "Vanildo de Souza", not
// "Vanildo De Souza".
const LOWER_PARTICLES = new Set([
  'de', 'da', 'das', 'do', 'dos', 'e', // Portuguese
  'del', 'la', 'las', 'los', 'y', // Spanish
  'di', 'du', 'le', // Italian/French
  'van', 'von', 'der', 'den', 'ter', // Dutch/German
])

// Capitalize one whitespace-delimited word, preserving hyphen and apostrophe
// boundaries: "mary-jane" → "Mary-Jane", "o'brien" → "O'Brien".
function capitalizeWord(word: string): string {
  return word
    .split(/([-'’])/)
    .map((seg) => {
      if (seg === '-' || seg === "'" || seg === '’' || !seg) return seg
      return seg.charAt(0).toUpperCase() + seg.slice(1).toLowerCase()
    })
    .join('')
}

/**
 * Smart title-casing for person names. Capitalizes each word but keeps known
 * particles ("de", "van", "del"…) lowercase unless they lead the string, and
 * handles hyphenated / apostrophe names. Returns null for empty input.
 *
 * `leading` controls whether the first word is always capitalized: pass `true`
 * for a first name or a full name, `false` for a standalone last name so a
 * surname like "de souza" stays "de Souza".
 */
export function titleCaseName(
  value: string | null | undefined,
  { leading = true }: { leading?: boolean } = {},
): string | null {
  const trimmed = cleanNamePart(value)
  if (!trimmed) return null
  return trimmed
    .split(/\s+/)
    .map((word, i) => {
      const isFirstWord = i === 0
      if (!(leading && isFirstWord) && LOWER_PARTICLES.has(word.toLowerCase())) {
        return word.toLowerCase()
      }
      return capitalizeWord(word)
    })
    .join(' ')
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
