// src/app/api/recording/upload/route.ts
// Receives a browser-captured call recording (MediaRecorder output), stores it
// privately (R2 `recordings` bucket, or the legacy Hetzner store) and updates
// call_logs.recording_url. Playback goes through /api/calls/[id]/recording.
//
// POST multipart/form-data
//   audio    | audio Blob (audio/webm, audio/mp4, audio/ogg)
//   callSid  | Twilio CallSid to match the call_logs row
//
// The response tells the truth about the audio: 200 { ok: true } only once the
// object is stored and the row updated; 503 when no recording store is
// configured (the audio is NOT kept); 502 when the store or the row update
// failed. It never says ok for audio it threw away.

import { createClient, getUser } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { putRecordingObject, recordingStore } from '@/lib/calls/upload-recording'

export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  const user = await getUser()
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return Response.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }

  const audioEntry = formData.get('audio')
  const callSid = formData.get('callSid')

  if (!audioEntry || !(audioEntry instanceof Blob)) {
    return Response.json({ error: 'Missing audio blob' }, { status: 400 })
  }
  if (!callSid || typeof callSid !== 'string') {
    return Response.json({ error: 'Missing callSid' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return Response.json({ error: 'No active organization' }, { status: 400 })

  // Verify the call belongs to this org
  const admin = createServiceRoleClient()
  const { data: callLog } = await admin
    .from('call_logs')
    .select('id, org_id, recording_url')
    .eq('call_sid', callSid)
    .eq('org_id', orgId)
    .maybeSingle()

  if (!callLog) {
    return Response.json({ error: 'Call not found' }, { status: 404 })
  }

  const audioBuffer = new Uint8Array(await audioEntry.arrayBuffer())
  const contentType = audioEntry.type || 'audio/webm'
  const ext = contentType.includes('mp4') ? 'mp4' : contentType.includes('ogg') ? 'ogg' : 'webm'

  if (recordingStore() === 'none') {
    // Nowhere to put the audio: say so instead of pretending it was kept.
    return Response.json(
      { ok: false, uploaded: false, error: 'Recording storage is not configured' },
      { status: 503 },
    )
  }

  try {
    const url = await putRecordingObject({
      orgId,
      callSid,
      fileName: `browser_recording.${ext}`,
      body: audioBuffer,
      contentType,
    })

    const { error: updateError } = await admin
      .from('call_logs')
      .update({ recording_url: url })
      .eq('id', callLog.id)
    if (updateError) throw new Error(updateError.message)
  } catch (err) {
    console.error('[recording/upload] upload error:', err)
    return Response.json({ ok: false, uploaded: false, error: 'Recording upload failed' }, { status: 502 })
  }

  return Response.json({ ok: true, uploaded: true })
}
