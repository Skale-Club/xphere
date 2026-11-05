/**
 * R2ImportStorage | ContactImportStorage backed by the contact-imports bucket on
 * Cloudflare R2, through src/lib/storage. The browser PUTs the CSV straight to a
 * presigned URL (the R2 bucket needs a CORS rule allowing PUT from the app
 * origin, and the app's CSP connect-src names the R2 host; next.config.ts adds
 * it whenever STORAGE_R2_BUCKETS is set).
 *
 * getImportStorage() picks this one when contact-imports is listed in
 * STORAGE_R2_BUCKETS and the Supabase implementation otherwise, so callers
 * never branch.
 */
import * as storage from '@/lib/storage'
import type { ContactImportStorage } from './storage'
import { SupabaseImportStorage } from './storage-supabase'

const BUCKET = 'contact-imports' as const

export class R2ImportStorage implements ContactImportStorage {
  async getSignedUploadUrl(
    orgId: string,
    importId: string,
    filename: string,
  ): Promise<{ url: string; path: string }> {
    const path = `${orgId}/${importId}/${filename}`
    const { url } = await storage.signedUploadUrl(BUCKET, path)
    return { url, path }
  }

  async streamFile(path: string): Promise<ReadableStream<Uint8Array>> {
    const { data, error } = await storage.get(BUCKET, path)
    if (error || !data) {
      throw new Error(`Failed to stream import file: ${error?.message ?? 'unknown'}`)
    }
    return data.stream() as ReadableStream<Uint8Array>
  }
}

export function getImportStorage(): ContactImportStorage {
  return storage.isR2Enabled(BUCKET) ? new R2ImportStorage() : new SupabaseImportStorage()
}
