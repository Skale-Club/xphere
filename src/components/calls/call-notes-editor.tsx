'use client'

import * as React from 'react'
import { Check, Loader2 } from 'lucide-react'

import { Textarea } from '@/components/ui/textarea'
import { updateCallNotes } from '@/app/(dashboard)/calls/settings-actions'

interface CallNotesEditorProps {
  callId: string
  initialNotes: string
}

export function CallNotesEditor({ callId, initialNotes }: CallNotesEditorProps) {
  const [notes, setNotes] = React.useState(initialNotes)
  const [savedAt, setSavedAt] = React.useState<Date | null>(null)
  const [saving, setSaving] = React.useState(false)
  const lastSaved = React.useRef(initialNotes)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    if (notes === lastSaved.current) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      setSaving(true)
      const res = await updateCallNotes(callId, notes)
      setSaving(false)
      if (!res?.error) {
        lastSaved.current = notes
        setSavedAt(new Date())
      }
    }, 600)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [notes, callId])

  return (
    <div className="rounded-[14px] border border-border bg-bg-secondary p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-medium text-text-primary">Notes</h3>
        <div className="text-[11px] text-text-tertiary flex items-center gap-1.5">
          {saving ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Saving…</span>
            </>
          ) : savedAt ? (
            <>
              <Check className="h-3 w-3 text-accent" />
              <span>Saved {savedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </>
          ) : null}
        </div>
      </div>
      <Textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Add notes about this call | they auto-save as you type."
        rows={6}
        className="resize-none"
      />
    </div>
  )
}
