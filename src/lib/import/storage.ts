/**
 * ContactImportStorage | Hetzner-portable storage interface for the import pipeline.
 *
 * v1 implementation: SupabaseImportStorage (storage-supabase.ts)
 * Post-Hetzner swap: implement against S3/MinIO/R2 via @aws-sdk/client-s3 in
 * storage-node.ts, then update the factory/DI binding. Zero callers change.
 *
 * Canonical path pattern enforced by the Phase 74 upload action:
 *   contact-imports/{org_id}/{import_id}/{filename}
 */
export interface ContactImportStorage {
  /**
   * Generate a signed URL for a direct-to-Storage browser upload.
   * The URL is single-use and scoped to the org's path prefix.
   *
   * @param orgId    - UUID of the uploading org (used as the path prefix)
   * @param importId - UUID of the contact_imports row (subfolder)
   * @param filename - Original filename from the user's file picker
   * @returns { url: string; path: string } where path is the Storage object key
   *          that must be persisted in contact_imports.storage_path
   */
  getSignedUploadUrl(
    orgId: string,
    importId: string,
    filename: string,
  ): Promise<{ url: string; path: string }>

  /**
   * Open a readable stream over the stored CSV file.
   * Used by the parse worker and processing worker to avoid loading the entire
   * file into memory (supports files up to 50 MB / 200,000 rows).
   *
   * @param path - The storage_path value from the contact_imports row
   * @returns A ReadableStream of the file bytes
   */
  streamFile(path: string): Promise<ReadableStream<Uint8Array>>
}
