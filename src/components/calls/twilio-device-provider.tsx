'use client'

/**
 * TwilioDeviceProvider | wraps the dashboard for users in routing_mode='browser'.
 *
 * Lifecycle:
 *   1. Fetch /api/twilio/token (server-side mints a VoiceGrant for the user)
 *   2. Construct a Twilio Voice SDK Device + register()
 *   3. Listen for `incoming` events → push to local state, surface banner
 *   4. Provide `placeCall(to)` / `accept()` / `reject()` helpers to children
 *
 * The Device is created lazily | only if the server's token endpoint succeeds.
 * Users on phone_forward / sip modes skip Voice SDK entirely.
 */

import * as React from 'react'
import type { Device, Call } from '@twilio/voice-sdk'

type DeviceState = 'idle' | 'registering' | 'ready' | 'on-call' | 'unsupported' | 'error'

export interface IncomingCall {
  parameters: Record<string, string>
  accept: () => void
  reject: () => void
}

interface TwilioDeviceCtx {
  state: DeviceState
  error: string | null
  identity: string | null
  incoming: Call | null
  activeCall: Call | null
  acceptIncoming: () => void
  rejectIncoming: () => void
  placeCall: (to: string) => Promise<Call | null>
  hangUp: () => void
}

const ctx = React.createContext<TwilioDeviceCtx | null>(null)

export function useTwilioDevice(): TwilioDeviceCtx {
  const value = React.useContext(ctx)
  if (!value) {
    return {
      state: 'idle',
      error: null,
      identity: null,
      incoming: null,
      activeCall: null,
      acceptIncoming: () => undefined,
      rejectIncoming: () => undefined,
      placeCall: async () => null,
      hangUp: () => undefined,
    }
  }
  return value
}

export interface TwilioDeviceProviderProps {
  /** Render device only when the user has opted into browser mode. */
  enabled?: boolean
  children: React.ReactNode
}

export function TwilioDeviceProvider({ enabled = true, children }: TwilioDeviceProviderProps) {
  const [state, setState] = React.useState<DeviceState>('idle')
  const [error, setError] = React.useState<string | null>(null)
  const [identity, setIdentity] = React.useState<string | null>(null)
  const [incoming, setIncoming] = React.useState<Call | null>(null)
  const [activeCall, setActiveCall] = React.useState<Call | null>(null)
  const deviceRef = React.useRef<Device | null>(null)

  React.useEffect(() => {
    if (!enabled) return
    let cancelled = false

    async function init() {
      setState('registering')
      try {
        const res = await fetch('/api/twilio/token', { method: 'POST' })
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(data.error ?? `Token request failed (${res.status})`)
        }
        const data = (await res.json()) as { token: string; identity: string }
        if (cancelled) return

        const { Device } = await import('@twilio/voice-sdk')
        const device = new Device(data.token, {
          logLevel: 'WARN',
          appName: 'Xphere',
          appVersion: '2.1',
        })

        device.on('registered', () => {
          if (cancelled) return
          setIdentity(data.identity)
          setState('ready')
        })
        device.on('error', (err: Error) => {
          if (cancelled) return
          setError(err.message)
          setState('error')
        })
        device.on('incoming', (call: Call) => {
          if (cancelled) return
          setIncoming(call)
          call.on('cancel', () => setIncoming(null))
          call.on('disconnect', () => {
            setIncoming(null)
            setActiveCall(null)
            setState('ready')
          })
        })
        device.on('tokenWillExpire', async () => {
          try {
            const r = await fetch('/api/twilio/token', { method: 'POST' })
            const j = (await r.json()) as { token?: string }
            if (j.token) device.updateToken(j.token)
          } catch (err) {
            console.warn('[twilio-device] token refresh failed', err)
          }
        })

        await device.register()
        deviceRef.current = device
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Voice SDK init failed')
        setState('error')
      }
    }

    init()
    return () => {
      cancelled = true
      deviceRef.current?.destroy()
      deviceRef.current = null
    }
  }, [enabled])

  const acceptIncoming = React.useCallback(() => {
    if (!incoming) return
    incoming.accept()
    setActiveCall(incoming)
    setState('on-call')
  }, [incoming])

  const rejectIncoming = React.useCallback(() => {
    if (!incoming) return
    incoming.reject()
    setIncoming(null)
  }, [incoming])

  const placeCall = React.useCallback(async (to: string): Promise<Call | null> => {
    const device = deviceRef.current
    if (!device) return null
    setState('on-call')
    try {
      const call = await device.connect({ params: { To: to } })
      setActiveCall(call)
      call.on('disconnect', () => {
        setActiveCall(null)
        setState('ready')
      })
      call.on('error', () => {
        setActiveCall(null)
        setState('error')
      })
      return call
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Outbound dial failed')
      setState('error')
      return null
    }
  }, [])

  const hangUp = React.useCallback(() => {
    activeCall?.disconnect()
    setActiveCall(null)
    setState('ready')
  }, [activeCall])

  const value: TwilioDeviceCtx = React.useMemo(
    () => ({ state, error, identity, incoming, activeCall, acceptIncoming, rejectIncoming, placeCall, hangUp }),
    [state, error, identity, incoming, activeCall, acceptIncoming, rejectIncoming, placeCall, hangUp],
  )

  return <ctx.Provider value={value}>{children}</ctx.Provider>
}
