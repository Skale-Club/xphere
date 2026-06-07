'use client'

// Tool picker + save for the "Prompt & Actions" section. Wraps the controlled
// ToolPicker with local state and persists via setAgentTools.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { ToolPicker } from './tool-picker'
import { setAgentTools } from '@/app/(dashboard)/agents/actions'
import type { ToolPickerData } from '@/app/(dashboard)/agents/_actions/tools'

interface AgentToolsCardProps {
  agentId: string
  toolPickerData: ToolPickerData
  initialToolIds: string[]
}

export function AgentToolsCard({
  agentId,
  toolPickerData,
  initialToolIds,
}: AgentToolsCardProps) {
  const router = useRouter()
  const [toolIds, setToolIds] = useState<string[]>(initialToolIds)
  const [savedIds, setSavedIds] = useState<string[]>(initialToolIds)
  const [isPending, startTransition] = useTransition()

  const dirty =
    toolIds.length !== savedIds.length ||
    toolIds.some((id) => !savedIds.includes(id))

  function save() {
    startTransition(async () => {
      const res = await setAgentTools(agentId, toolIds)
      if (res && 'error' in res && res.error) {
        toast.error(res.error)
        return
      }
      setSavedIds(toolIds)
      toast.success('Tools updated')
      router.refresh()
    })
  }

  return (
    <div className="space-y-3">
      <ToolPicker data={toolPickerData} value={toolIds} onChange={setToolIds} />
      <div className="flex justify-end">
        <Button type="button" size="sm" disabled={isPending || !dirty} onClick={save}>
          {isPending ? 'Saving…' : 'Save tools'}
        </Button>
      </div>
    </div>
  )
}
