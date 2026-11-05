// src/lib/calls/upload-recording.ts
// Downloads a Twilio recording and stores it privately. Two stores, in order:
//
//   1. Cloudflare R2, when the logical bucket `recordings` is listed in
//      STORAGE_R2_BUCKETS (see src/lib/storage). call_logs.recording_url then
//      holds the app path /api/media/recordings/<org>/<callSid>/<file>, which
//      the session-gated player proxy (/api/calls/[id]/recording) resolves.
//   2. Hetzner Object Storage (S3-compatible), when HETZNER_S3_* is set. This is
//      the original path and is unchanged.
//
// With neither, it returns the Twilio URL so the link stays usable without
// storage setup (the player proxy adds the Twilio credentials).
//
// Legacy Hetzner env vars (unset in practice):
//   HETZNER_S3_ENDPOINT       | e.g. https://fsn1.your-objectstorage.com
//   HETZNER_S3_REGION         | e.g. fsn1
//   HETZNER_S3_ACCESS_KEY     | Hetzner access key
//   HETZNER_S3_SECRET_KEY     | Hetzner secret key
//   HETZNER_S3_BUCKET         | bucket name (e.g. operator-recordings)
//   HETZNER_S3_PUBLIC_BASE_URL | optional public CDN base URL prepended to keys
//
// Storage layout: `recordings/<org_id>/<call_sid>/<recording_sid>.<ext>`

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import * as storage from '@/lib/storage'

export interface UploadRecordingParams {
  orgId: string
  callSid: string
  recordingSid: string
  recordingUrl: string  // Twilio recording URL (without .mp3 | see appendExt)
  recordingDuration?: number
  twilioAccountSid: string
  twilioAuthToken: string
}

export interface UploadRecordingResult {
  storedUrl: string
  uploaded: boolean
  /** Surfaced to callers so they can persist it for analytics; passes through Twilio when nothing else. */
  contentType: string
}

function hasHetznerConfig(): boolean {
  return Boolean(
    process.env.HETZNER_S3_ENDPOINT &&
    process.env.HETZNER_S3_ACCESS_KEY &&
    process.env.HETZNER_S3_SECRET_KEY &&
    process.env.HETZNER_S3_BUCKET,
  )
}

/** Where a new recording would be stored right now. */
export function recordingStore(): 'r2' | 'hetzner' | 'none' {
  if (storage.isR2Enabled('recordings')) return 'r2'
  return hasHetznerConfig() ? 'hetzner' : 'none'
}

/**
 * Stores one recording object for a call and returns the URL to keep in
 * call_logs.recording_url. Throws on failure or when no store is configured.
 */
export async function putRecordingObject(params: {
  orgId: string
  callSid: string
  fileName: string
  body: Uint8Array
  contentType: string
}): Promise<string> {
  const { orgId, callSid, fileName, body, contentType } = params
  const mode = recordingStore()
  if (mode === 'none') throw new Error('Recording storage is not configured')

  if (mode === 'r2') {
    const path = `${orgId}/${callSid}/${fileName}`
    const { error } = await storage.put('recordings', path, body, { contentType, upsert: true })
    if (error) throw new Error(`Recording upload failed: ${error.message}`)
    return storage.mediaPath('recordings', path)
  }

  const key = `recordings/${orgId}/${callSid}/${fileName}`
  const bucket = process.env.HETZNER_S3_BUCKET!
  await getS3().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      // Recordings are private by default | surface them through a signed URL or
      // a tenant-aware proxy. We deliberately do NOT set ACL: public-read.
    }),
  )
  const publicBase = process.env.HETZNER_S3_PUBLIC_BASE_URL
  return publicBase
    ? `${publicBase.replace(/\/$/, '')}/${key}`
    : `${process.env.HETZNER_S3_ENDPOINT!.replace(/\/$/, '')}/${bucket}/${key}`
}

let cachedClient: S3Client | null = null
function getS3(): S3Client {
  if (cachedClient) return cachedClient
  cachedClient = new S3Client({
    endpoint: process.env.HETZNER_S3_ENDPOINT!,
    region: process.env.HETZNER_S3_REGION ?? 'auto',
    credentials: {
      accessKeyId: process.env.HETZNER_S3_ACCESS_KEY!,
      secretAccessKey: process.env.HETZNER_S3_SECRET_KEY!,
    },
    forcePathStyle: true,
    // A stuck request must fail, never hang. The SDK ships with no request
    // timeout and a 50-socket pool, so one socket that is never released stays
    // checked out for the life of the process; enough of them and every later
    // call queues behind them with nothing to break the wait.
    requestHandler: {
      connectionTimeout: 5_000,
      requestTimeout: 30_000,
      httpsAgent: { maxSockets: 200 },
    },
  })
  return cachedClient
}

/**
 * Fetch the recording audio (mp3 by default) using Twilio basic-auth, then PUT
 * it to Hetzner. Returns the resulting object URL. In dev (no Hetzner config),
 * returns the original Twilio URL so the player still works for the developer.
 */
export async function uploadRecordingToHetzner(
  params: UploadRecordingParams,
): Promise<UploadRecordingResult> {
  const mp3Url = appendMp3(params.recordingUrl)

  if (recordingStore() === 'none') {
    // Dev path | surface Twilio's URL directly. NB: Twilio recordings require
    // basic auth, so this is only usable for quick local checks.
    console.warn('[upload-recording] no recording store configured (R2 `recordings` / HETZNER_S3_*) | returning Twilio URL as fallback')
    return { storedUrl: mp3Url, uploaded: false, contentType: 'audio/mpeg' }
  }

  // 1. Download the audio from Twilio (HTTP basic auth)
  const basicAuth = `Basic ${btoa(`${params.twilioAccountSid}:${params.twilioAuthToken}`)}`
  const res = await fetch(mp3Url, {
    method: 'GET',
    headers: { Authorization: basicAuth },
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`Recording fetch failed ${res.status}: ${await res.text().catch(() => '')}`)
  }
  const contentType = res.headers.get('content-type') ?? 'audio/mpeg'
  const audio = new Uint8Array(await res.arrayBuffer())

  // 2. Store it (R2 or Hetzner) and build the canonical URL
  const storedUrl = await putRecordingObject({
    orgId: params.orgId,
    callSid: params.callSid,
    fileName: `${params.recordingSid}.mp3`,
    body: audio,
    contentType,
  })

  return { storedUrl, uploaded: true, contentType }
}

function appendMp3(url: string): string {
  if (url.endsWith('.mp3') || url.endsWith('.wav')) return url
  return `${url}.mp3`
}
