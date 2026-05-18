'use client'

// Records the remote audio stream from an active Twilio browser call using the
// MediaRecorder API and uploads the result to /api/recording/upload when the
// call disconnects. Only active when shouldRecord=true and a call is connected.

import * as React from 'react'
import type { Call } from '@twilio/voice-sdk'

export function useCallRecorder(call: Call | null, shouldRecord: boolean) {
  const recorderRef = React.useRef<MediaRecorder | null>(null)
  const chunksRef = React.useRef<BlobPart[]>([])

  React.useEffect(() => {
    if (!call || !shouldRecord) return

    let recorder: MediaRecorder | null = null

    function startRecording() {
      try {
        // getRemoteStream() is available on Twilio Voice SDK Call objects
        const stream = (call as unknown as { getRemoteStream?: () => MediaStream | undefined }).getRemoteStream?.()
        if (!stream) return

        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : MediaRecorder.isTypeSupported('audio/webm')
            ? 'audio/webm'
            : ''

        recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
        recorderRef.current = recorder
        chunksRef.current = []

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data)
        }

        recorder.onstop = async () => {
          const blob = new Blob(chunksRef.current, { type: recorder?.mimeType ?? 'audio/webm' })
          if (blob.size === 0) return

          const callSid = (call.parameters as Record<string, string>).CallSid
          if (!callSid) return

          try {
            const form = new FormData()
            form.append('audio', blob, `recording.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`)
            form.append('callSid', callSid)
            await fetch('/api/recording/upload', { method: 'POST', body: form })
          } catch (err) {
            console.warn('[use-call-recorder] upload failed:', err)
          }
        }

        recorder.start(5_000) // collect chunks every 5 s
      } catch (err) {
        console.warn('[use-call-recorder] start failed:', err)
      }
    }

    // The call may already be accepted by the time this effect runs
    if ((call as unknown as { status?: () => string }).status?.() === 'open') {
      startRecording()
    } else {
      call.on('accept', startRecording)
    }

    call.on('disconnect', () => {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop()
      }
    })

    return () => {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop()
      }
      recorderRef.current = null
    }
  }, [call, shouldRecord])
}
