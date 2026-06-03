'use client'

import * as React from 'react'
import { Loader2, Phone } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { PhoneNumberEditor } from '@/components/phone-numbers/phone-number-editor'
import {
  listOrgMembersForSelect,
  type OrgMemberOption,
  type TwilioPhoneNumberRow,
} from '@/app/(dashboard)/integrations/twilio/numbers-actions'

/**
 * Full per-number editor in a dialog — replaces navigating to the
 * /settings/phone-numbers/[id] detail page. Org members (for the owner select)
 * are fetched lazily the first time the dialog opens.
 */
export function EditPhoneNumberDialog({
  number,
  open,
  onOpenChange,
}: {
  number: TwilioPhoneNumberRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [members, setMembers] = React.useState<OrgMemberOption[]>([])
  const [loadingMembers, setLoadingMembers] = React.useState(false)

  React.useEffect(() => {
    if (open && members.length === 0) {
      setLoadingMembers(true)
      listOrgMembersForSelect()
        .then((m) => setMembers(m))
        .finally(() => setLoadingMembers(false))
    }
  }, [open, members.length])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[640px]">
        {number && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Phone className="h-4 w-4" />
                {number.inbox_label?.trim() || number.friendly_name || number.e164}
              </DialogTitle>
              <DialogDescription className="font-mono">{number.e164}</DialogDescription>
            </DialogHeader>

            {loadingMembers && members.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-text-secondary">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading…
              </div>
            ) : (
              // key remounts the editor when switching numbers so its form state resets.
              <PhoneNumberEditor
                key={number.id}
                number={number}
                members={members}
                onClose={() => onOpenChange(false)}
              />
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
