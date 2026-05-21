/**
 * SupabaseImportStorage | v1 implementation of ContactImportStorage backed by
 * Supabase Storage (contact-imports bucket, per-org path policy).
 *
 * Post-Hetzner migration: replace with storage-node.ts targeting S3/MinIO/R2
 * via @aws-sdk/client-s3. This file is the only thing that changes.
 */
import { createClient } from '@/lib/supabase/server'
import type { ContactImportStorage } from './storage'

const BUCKET = 'contact-imports'

export class SupabaseImportStorage implements ContactImportStorage {
  async getSignedUploadUrl(
    orgId: string,
    importId: string,
    filename: string,
  ): Promise<{ url: string; path: string }> {
    const supabase = await createClient()
    const path = `${orgId}/${importId}/${filename}`
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUploadUrl(path)
    if (error || !data) {
      throw new Error(`Failed to create signed upload URL: ${error?.message ?? 'unknown'}`)
    }
    return { url: data.signedUrl, path }
  }

  async streamFile(path: string): Promise<ReadableStream<Uint8Array>> {
    const supabase = await createClient()
    const { data, error } = await supabase.storage.from(BUCKET).download(path)
    if (error || !data) {
      throw new Error(`Failed to stream import file: ${error?.message ?? 'unknown'}`)
    }
    // Blob.stream() returns ReadableStream<Uint8Array>
    return data.stream() as ReadableStream<Uint8Array>
  }
}
