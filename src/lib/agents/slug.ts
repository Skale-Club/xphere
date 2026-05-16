/**
 * Slugify a display name to the slug format required by `agents.slug`.
 * Lowercase, alphanumeric + hyphen only, no leading/trailing hyphens, max 50 chars.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
}
