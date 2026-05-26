'use client'

import * as React from 'react'
import { Phone } from 'lucide-react'

import { EmptyState } from '@/components/empty-states/empty-state'
import { AddPhoneNumberDialog } from '@/components/phone-numbers/add-phone-number-dialog'

interface Props {
  twilioConnected: boolean
}

export function CallsOnboardingGate({ twilioConnected }: Props) {
  const [open, setOpen] = React.useState(false)

  return (
    <>
      <EmptyState
        icon={Phone}
        title="Connect your first number to start"
        description="Calls, SMS and workflows in Xphere are powered by a Twilio number. Vapi assistants and campaigns layer on top once a number is connected."
        action={{ label: 'Add a phone number', onClick: () => setOpen(true) }}
        secondary={
          twilioConnected
            ? { label: 'Manage Twilio integration', href: '/integrations/twilio' }
            : undefined
        }
      />
      <AddPhoneNumberDialog
        open={open}
        onOpenChange={setOpen}
        twilioConnected={twilioConnected}
      />
    </>
  )
}
