/**
 * Per-org upload quota decision for the email-assets bucket
 * (email-builder-hardening PLAN.md Phase 5, Finding #8).
 *
 * Pure — takes the org's existing Storage objects (as already listed by the
 * caller via the service-role client) and decides whether a new upload
 * should be rejected. No I/O here so the policy is trivially unit-testable;
 * the route (src/app/api/email-templates/upload/route.ts) owns the actual
 * `storage.list()` call and the 400 response.
 */

/** Max number of objects (images) an org may have in the email-assets bucket. */
export const MAX_UPLOAD_OBJECTS = 500

/** Max cumulative bytes an org may have in the email-assets bucket. */
export const MAX_UPLOAD_TOTAL_BYTES = 512 * 1024 * 1024 // 512 MB

export type QuotaObject = {
  /** Size in bytes, from Storage FileObject.metadata.size. */
  sizeBytes: number
}

export type QuotaCheckResult =
  | { ok: true }
  | { ok: false; error: string }

/**
 * Decide whether an org may upload another asset, based on the objects it
 * already has. Does NOT factor in the size of the incoming file — the cap is
 * on existing usage, matching PLAN.md's "the org already has ≥ 500 objects
 * OR the sum of existing object sizes exceeds 512 MB".
 */
export function checkUploadQuota(existingObjects: QuotaObject[]): QuotaCheckResult {
  if (existingObjects.length >= MAX_UPLOAD_OBJECTS) {
    return {
      ok: false,
      error: `This org has reached the maximum of ${MAX_UPLOAD_OBJECTS} uploaded email assets. Delete unused images before uploading more.`,
    }
  }

  const totalBytes = existingObjects.reduce((sum, obj) => sum + (obj.sizeBytes || 0), 0)
  if (totalBytes > MAX_UPLOAD_TOTAL_BYTES) {
    const capMb = Math.round(MAX_UPLOAD_TOTAL_BYTES / (1024 * 1024))
    return {
      ok: false,
      error: `This org has reached the maximum of ${capMb} MB of uploaded email assets. Delete unused images before uploading more.`,
    }
  }

  return { ok: true }
}
