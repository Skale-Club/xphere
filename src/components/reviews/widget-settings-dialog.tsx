'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Settings2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { SerpApiKeyForm } from './serpapi-key-form'
import { BusinessSearch } from './business-search'

interface WidgetSettingsDialogProps {
  currentHint: string | null
  hasApiKey: boolean
  currentPlaceId: string | null
}

export function WidgetSettingsDialog({ currentHint, hasApiKey, currentPlaceId }: WidgetSettingsDialogProps) {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        // Re-fetch the page when closing so any business/key change is reflected.
        if (!next) router.refresh()
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="secondary" className="h-8 gap-1.5 text-[12px]">
          <Settings2 className="h-3.5 w-3.5" />
          Settings
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Widget settings</DialogTitle>
          <DialogDescription>
            Update your SerpAPI key and the connected Google business for this widget.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          <div className="space-y-3">
            <p className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
              SerpAPI key
            </p>
            <SerpApiKeyForm currentHint={currentHint} />
          </div>

          <Separator />

          <div className="space-y-3">
            <p className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
              Connected business
            </p>
            <BusinessSearch hasApiKey={hasApiKey} currentPlaceId={currentPlaceId} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
