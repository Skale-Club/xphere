'use client'

import * as React from 'react'
import { Phone, PhoneCall } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { toggleDialPad } from './dial-pad-context'
import { useTwilioDevice } from './twilio-device-provider'

export function DialPadHeaderButton() {
  const device = useTwilioDevice()
  const isOnCall = device.activeCall !== null

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => toggleDialPad()}
          aria-label="Dial pad"
          className={cn(
            'inline-flex h-8 w-8 items-center justify-center rounded-[8px] motion-fast',
            isOnCall
              ? 'bg-accent text-white animate-pulse'
              : 'text-text-secondary hover:text-text-primary hover:bg-bg-secondary',
          )}
        >
          {isOnCall ? <PhoneCall className="h-[15px] w-[15px]" /> : <Phone className="h-[15px] w-[15px]" />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Dial pad</TooltipContent>
    </Tooltip>
  )
}
