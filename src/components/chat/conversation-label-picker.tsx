'use client'

/**
 * Per-conversation label picker (SEED-035).
 *
 * Lives in the chat header beside the StatusSelector. Renders a popover with
 * the org's labels — clicking toggles assignment for the current conversation.
 * Optimistic: mutates `selectedLabelIds` immediately and rolls back on error.
 */

import { useMemo, useState } from 'react'
import { Check, Tag } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { ConversationLabel } from '@/types/chat'

interface ConversationLabelPickerProps {
  conversationId: string
  allLabels: Array<{ id: string; name: string; color: string }>
  selectedLabels: ConversationLabel[]
  onChange: (next: ConversationLabel[]) => void
}

export function ConversationLabelPicker({
  conversationId,
  allLabels,
  selectedLabels,
  onChange,
}: ConversationLabelPickerProps) {
  const [open, setOpen] = useState(false)
  const selectedIds = useMemo(
    () => new Set(selectedLabels.map((l) => l.id)),
    [selectedLabels],
  )

  async function toggle(label: { id: string; name: string; color: string }) {
    const wasSelected = selectedIds.has(label.id)
    const optimistic = wasSelected
      ? selectedLabels.filter((l) => l.id !== label.id)
      : [...selectedLabels, label]
    onChange(optimistic)

    try {
      const res = wasSelected
        ? await fetch(
            `/api/chat/conversations/${conversationId}/labels/${label.id}`,
            { method: 'DELETE' },
          )
        : await fetch(`/api/chat/conversations/${conversationId}/labels`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ label_id: label.id }),
          })
      if (!res.ok) throw new Error()
    } catch {
      // rollback
      onChange(selectedLabels)
      toast.error('Failed to update label')
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'h-8 w-8',
                  selectedLabels.length > 0 && 'text-accent',
                )}
                aria-label="Manage labels"
              >
                <Tag className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>Labels</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent align="end" className="w-[240px] p-0">
        <div className="border-b border-border-subtle px-3 py-2 text-[12px] font-semibold">
          Labels
        </div>
        <ScrollArea className="max-h-[280px]">
          {allLabels.length === 0 ? (
            <div className="p-3 text-[11.5px] text-text-tertiary">
              No labels yet. Create them in <span className="font-medium">Workspace settings</span>.
            </div>
          ) : (
            <div className="p-1.5">
              {allLabels.map((l) => {
                const selected = selectedIds.has(l.id)
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => toggle(l)}
                    className="flex w-full items-center justify-between gap-2 rounded-[5px] px-2 py-1.5 text-left text-[12px] text-text-primary hover:bg-bg-tertiary/60"
                  >
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: l.color }}
                      />
                      <span className="truncate">{l.name}</span>
                    </span>
                    {selected && <Check className="h-3.5 w-3.5 text-accent shrink-0" />}
                  </button>
                )
              })}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}
