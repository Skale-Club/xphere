'use client'

import * as React from 'react'
import { Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Dialer } from './dialer'

export function NewCallButton() {
  const [open, setOpen] = React.useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-3.5 w-3.5" />
          New call
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Place a call</DialogTitle>
        </DialogHeader>
        <Dialer onComplete={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  )
}
