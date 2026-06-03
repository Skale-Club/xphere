'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { MapPin, Phone, User, Video } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { updateSchedulingPreferences } from '@/app/(dashboard)/scheduling/_actions/scheduling-profile'

type LocationType = 'google_meet' | 'my_address' | 'client_address' | 'phone'

const LOCATION_OPTIONS: {
  value: LocationType
  label: string
  icon: React.ReactNode
  description: string
}[] = [
  {
    value: 'google_meet',
    label: 'Google Meet',
    icon: <Video className="h-4 w-4 text-indigo-400" />,
    description: 'Generate a Google Meet link automatically for each booking.',
  },
  {
    value: 'my_address',
    label: 'My address',
    icon: <MapPin className="h-4 w-4 text-indigo-400" />,
    description: 'The meeting happens at your location. You\'ll be asked for the address.',
  },
  {
    value: 'client_address',
    label: "Client's address",
    icon: <User className="h-4 w-4 text-indigo-400" />,
    description: "The meeting happens at the client's location. They'll provide the address.",
  },
  {
    value: 'phone',
    label: 'Phone call',
    icon: <Phone className="h-4 w-4 text-indigo-400" />,
    description: 'A phone number will be collected from the booker.',
  },
]

interface Props {
  defaultLocationType: LocationType
}

export function MeetingPreferences({ defaultLocationType }: Props) {
  const [isPending, startTransition] = useTransition()
  const [locationType, setLocationType] = useState<LocationType>(defaultLocationType)

  const selected = LOCATION_OPTIONS.find((o) => o.value === locationType)

  function handleSave() {
    startTransition(async () => {
      const result = await updateSchedulingPreferences({ default_location_type: locationType })
      if (!result.ok) { toast.error(result.error); return }
      toast.success('Preferences saved')
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[15px] font-semibold text-text-primary">User preferences</h2>
        <p className="mt-1 text-[12.5px] text-text-tertiary">
          Set your preferences for your account.
        </p>
      </div>

      <div className="rounded-[14px] border border-border bg-bg-secondary divide-y divide-border-subtle overflow-hidden">
        <div className="px-5 py-4">
          <div className="flex items-start gap-6">
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-text-primary">Scheduling options</p>
            </div>

            <div className="w-64 space-y-3">
              <div className="space-y-1.5">
                <Label className="text-[12px] text-text-secondary">Meeting location</Label>
                <Select
                  value={locationType}
                  onValueChange={(v) => setLocationType(v as LocationType)}
                >
                  <SelectTrigger className="h-9 text-[13px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LOCATION_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        <div className="flex items-center gap-2">
                          {opt.icon}
                          <span>{opt.label}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selected && (
                <p className="text-[11.5px] text-text-tertiary leading-relaxed">
                  {selected.description}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={isPending} size="sm">
          {isPending ? 'Saving…' : 'Save preferences'}
        </Button>
      </div>
    </div>
  )
}
