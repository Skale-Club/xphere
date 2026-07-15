/**
 * Orphan-asset detection for the email-assets bucket
 * (email-builder-hardening PLAN.md Phase 5).
 *
 * Pure — given the org's Storage objects and a "haystack" of text drawn from
 * every email_templates.document/html_snapshot and
 * email_section_templates.document row for the org, decides which objects
 * are safe to delete: unreferenced AND older than a grace period. Matching
 * is deliberately simple string-inclusion on the object's storage path
 * rather than parsing the EmailDocument shape — the block schema evolves
 * independently in the editor, and an uploaded asset's public URL always
 * contains its storage path verbatim (see upload/route.ts), so substring
 * matching against a stringified blob of every document/snapshot is robust
 * to shape changes.
 *
 * The route (src/app/api/email-templates/assets/cleanup/route.ts) owns all
 * I/O: listing the bucket, querying the two tables, and calling remove().
 */

export type OrphanCandidate = {
  /** Full storage path, e.g. "{orgId}/{timestamp}-{filename}.png". */
  path: string
  /** ISO 8601 creation timestamp, or null if unknown. */
  createdAt: string | null
}

export type OrphanPartition = {
  toDelete: OrphanCandidate[]
  toKeep: OrphanCandidate[]
}

const DEFAULT_MIN_AGE_DAYS = 7

/**
 * True when `candidate.path` does not appear anywhere in `referenceHaystack`
 * AND the object is at least `minAgeDays` old. Objects with an unknown or
 * unparsable creation date are kept — conservative by design, never delete
 * without a clear age.
 */
export function isOrphanedAsset(
  candidate: OrphanCandidate,
  referenceHaystack: string,
  now: Date = new Date(),
  minAgeDays: number = DEFAULT_MIN_AGE_DAYS,
): boolean {
  if (!candidate.path) return false
  if (referenceHaystack.includes(candidate.path)) return false
  if (!candidate.createdAt) return false

  const createdMs = new Date(candidate.createdAt).getTime()
  if (Number.isNaN(createdMs)) return false

  const ageMs = now.getTime() - createdMs
  return ageMs >= minAgeDays * 24 * 60 * 60 * 1000
}

/** Partitions a full object list into deletable orphans vs everything else. */
export function partitionOrphanAssets(
  candidates: OrphanCandidate[],
  referenceHaystack: string,
  now: Date = new Date(),
  minAgeDays: number = DEFAULT_MIN_AGE_DAYS,
): OrphanPartition {
  const toDelete: OrphanCandidate[] = []
  const toKeep: OrphanCandidate[] = []
  for (const candidate of candidates) {
    if (isOrphanedAsset(candidate, referenceHaystack, now, minAgeDays)) {
      toDelete.push(candidate)
    } else {
      toKeep.push(candidate)
    }
  }
  return { toDelete, toKeep }
}

/**
 * Flattens an arbitrary set of document/snapshot values (jsonb objects,
 * html strings, null) into one searchable string. Non-string values are
 * JSON-stringified so nested image `src`/`link`/`backgroundImage` URLs are
 * captured without needing to know the EmailDocument shape.
 */
export function buildReferenceHaystack(parts: unknown[]): string {
  return parts
    .map((part) => {
      if (typeof part === 'string') return part
      if (part === null || part === undefined) return ''
      try {
        return JSON.stringify(part)
      } catch {
        return ''
      }
    })
    .join('\n')
}
