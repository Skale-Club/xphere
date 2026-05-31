'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'

import { Button, type ButtonProps } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { NewCampaignWizard } from './new-campaign-wizard'

interface NewCampaignDialogProps {
  assistants: Array<{ id: string; name: string }>
  hasTwilio: boolean
  hasResend: boolean
  hasWhatsApp: boolean
  /** Visual style of the trigger button. Defaults to 'outline' (empty-state CTA); pass 'primary' for the header. */
  variant?: ButtonProps['variant']
}

export function NewCampaignDialog({
  assistants,
  hasTwilio,
  hasResend,
  hasWhatsApp,
  variant = 'outline',
}: NewCampaignDialogProps) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={variant}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          New Campaign
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New campaign</DialogTitle>
          <DialogDescription>
            Set up a multi-channel outreach campaign for your contacts.
          </DialogDescription>
        </DialogHeader>
        <NewCampaignWizard
          assistants={assistants}
          hasTwilio={hasTwilio}
          hasResend={hasResend}
          hasWhatsApp={hasWhatsApp}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
