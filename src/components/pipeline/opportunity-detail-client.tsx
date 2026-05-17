'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Send } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ActivityFeedItem } from './activity-feed-item'
import {
  addNote,
  moveOpportunity,
  type ActivityWithMeta,
} from '@/app/(dashboard)/pipeline/actions'
import type { Database } from '@/types/database'

type StageRow = Database['public']['Tables']['pipeline_stages']['Row']

interface Props {
  opportunityId: string
  stages: StageRow[]
  currentStageId: string
  activities: ActivityWithMeta[]
}

export function OpportunityDetailClient({
  opportunityId,
  stages,
  currentStageId,
  activities,
}: Props) {
  const router = useRouter()
  const [note, setNote] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)

  async function handleAddNote() {
    if (!note.trim()) return
    setSubmitting(true)
    const res = await addNote(opportunityId, note.trim())
    setSubmitting(false)
    if (res.error) {
      toast.error(res.error)
      return
    }
    setNote('')
    router.refresh()
  }

  async function handleStageChange(stageId: string) {
    if (stageId === currentStageId) return
    const res = await moveOpportunity(opportunityId, stageId)
    if (res && 'error' in res && res.error) {
      toast.error(res.error)
      return
    }
    toast.success('Stage updated')
    router.refresh()
  }

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-[13px]">Activity</CardTitle>
        <div className="flex items-center gap-2">
          <span className="text-[10.5px] uppercase tracking-wide text-text-tertiary">Stage</span>
          <Select value={currentStageId} onValueChange={handleStageChange}>
            <SelectTrigger className="h-7 text-[12px] w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {stages.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                    {s.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Composer */}
        <div className="rounded-[10px] border border-border-subtle bg-bg-primary p-3 space-y-2">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a note about this opportunity…"
            rows={3}
            maxLength={4000}
            className="resize-none"
          />
          <div className="flex items-center justify-between">
            <span className="text-[10.5px] text-text-tertiary">{note.length}/4000</span>
            <Button onClick={handleAddNote} disabled={!note.trim() || submitting} size="sm">
              <Send className="h-3.5 w-3.5" /> {submitting ? 'Adding…' : 'Add note'}
            </Button>
          </div>
        </div>

        {/* Feed */}
        {activities.length === 0 ? (
          <div className="text-center py-10 text-[12.5px] text-text-tertiary">
            No activity yet. Add a note above or move the deal between stages.
          </div>
        ) : (
          <div>
            {activities.map((a, i) => (
              <ActivityFeedItem
                key={a.id}
                activity={a}
                last={i === activities.length - 1}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
