import { describe, it, expect } from 'vitest'
import {
  checkUploadQuota,
  MAX_UPLOAD_OBJECTS,
  MAX_UPLOAD_TOTAL_BYTES,
  type QuotaObject,
} from '@/lib/email/upload-quota'

// Phase 5 — Consolidation & cleanup (email-builder-hardening PLAN.md).
// Covers Finding #8: per-org upload quota (count/bytes) for the
// email-assets bucket.

function objectsOfSize(count: number, sizeBytes: number): QuotaObject[] {
  return Array.from({ length: count }, () => ({ sizeBytes }))
}

describe('checkUploadQuota', () => {
  it('allows an org with no existing assets', () => {
    const result = checkUploadQuota([])
    expect(result.ok).toBe(true)
  })

  it('allows an org comfortably under both caps', () => {
    const result = checkUploadQuota(objectsOfSize(10, 1024))
    expect(result.ok).toBe(true)
  })

  it('rejects when object count has reached the cap', () => {
    const result = checkUploadQuota(objectsOfSize(MAX_UPLOAD_OBJECTS, 1))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain(String(MAX_UPLOAD_OBJECTS))
    }
  })

  it('rejects when object count exceeds the cap', () => {
    const result = checkUploadQuota(objectsOfSize(MAX_UPLOAD_OBJECTS + 5, 1))
    expect(result.ok).toBe(false)
  })

  it('allows an org one object under the count cap', () => {
    const result = checkUploadQuota(objectsOfSize(MAX_UPLOAD_OBJECTS - 1, 1))
    expect(result.ok).toBe(true)
  })

  it('rejects when cumulative byte size exceeds the cap', () => {
    const result = checkUploadQuota([{ sizeBytes: MAX_UPLOAD_TOTAL_BYTES + 1 }])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.toLowerCase()).toContain('mb')
    }
  })

  it('allows an org exactly at the byte cap (not over)', () => {
    const result = checkUploadQuota([{ sizeBytes: MAX_UPLOAD_TOTAL_BYTES }])
    expect(result.ok).toBe(true)
  })

  it('sums multiple objects when checking the byte cap', () => {
    const half = Math.floor(MAX_UPLOAD_TOTAL_BYTES / 2)
    const underCap = checkUploadQuota([{ sizeBytes: half }, { sizeBytes: half - 1 }])
    expect(underCap.ok).toBe(true)

    const overCap = checkUploadQuota([{ sizeBytes: half }, { sizeBytes: half + 2 }])
    expect(overCap.ok).toBe(false)
  })

  it('treats missing/zero sizeBytes as zero rather than throwing', () => {
    const result = checkUploadQuota([{ sizeBytes: 0 }, { sizeBytes: 0 }])
    expect(result.ok).toBe(true)
  })

  it('object-count cap is checked before the byte cap short-circuits', () => {
    // Well under the byte cap but over the count cap.
    const result = checkUploadQuota(objectsOfSize(MAX_UPLOAD_OBJECTS + 1, 1))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('maximum of')
    }
  })
})
