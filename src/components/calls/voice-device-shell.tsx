'use client'

import * as React from 'react'

import { TwilioDeviceProvider } from './twilio-device-provider'
import { IncomingCallBanner } from './incoming-call-banner'

interface VoiceDeviceShellProps {
  enabled: boolean
  children: React.ReactNode
}

/**
 * Mounted from the dashboard layout. Only spins up the Twilio Voice Device when
 * the active user's routing_mode is 'browser' — otherwise it's a pass-through
 * to keep bundle weight off other dashboards.
 */
export function VoiceDeviceShell({ enabled, children }: VoiceDeviceShellProps) {
  if (!enabled) return <>{children}</>
  return (
    <TwilioDeviceProvider enabled>
      {children}
      <IncomingCallBanner />
    </TwilioDeviceProvider>
  )
}
