'use client'

// Choose which org knowledge sources this agent may use. Stored in
// agents.kb_scope: null/empty means "use all org knowledge". Toggle off the
// "use all" switch to restrict the agent to a hand-picked set.

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { BookOpen, FileText, Globe } from 'lucide-react'
import { toast } from 'sonner'

import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { setAgentKbScope } from '@/app/(dashboard)/agents/actions'

interface KnowledgeSourceItem {
  id: string
  name: string
  source_type: string
  status: string
  chunk_count: number
}

interface AgentKnowledgeSelectorProps {
  agentId: string
  sources: KnowledgeSourceItem[]
  /** Current kb_scope. null/empty = use all org knowledge. */
  initialScope: string[] | null
}

export function AgentKnowledgeSelector({
  agentId,
  sources,
  initialScope,
}: AgentKnowledgeSelectorProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const hasScope = !!initialScope && initialScope.length > 0
  const [useAll, setUseAll] = React.useState(!hasScope)
  const [selected, setSelected] = React.useState<Set<string>>(
    new Set(initialScope ?? [])
  )

  function toggle(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function save() {
    const scope = useAll ? null : Array.from(selected)
    if (!useAll && scope!.length === 0) {
      toast.error('Select at least one source, or turn on "Use all".')
      return
    }
    startTransition(async () => {
      const res = await setAgentKbScope(agentId, scope)
      if (res && 'error' in res && res.error) {
        toast.error(res.error)
        return
      }
      toast.success('Knowledge updated')
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <label className="flex items-center justify-between rounded-[8px] border border-border bg-bg-primary p-3">
        <div>
          <p className="text-sm font-medium text-text-primary">
            Use all organization knowledge
          </p>
          <p className="text-xs text-text-secondary">
            When on, this agent can search every knowledge source in the org.
          </p>
        </div>
        <Switch checked={useAll} onCheckedChange={setUseAll} />
      </label>

      {!useAll && (
        <div className="space-y-2">
          {sources.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No knowledge sources yet. Add them under Settings → Knowledge.
            </p>
          ) : (
            sources.map((s) => {
              const checked = selected.has(s.id)
              const Icon = s.source_type === 'url' ? Globe : FileText
              return (
                <label
                  key={s.id}
                  className="flex cursor-pointer items-center gap-3 rounded-[8px] border border-border bg-bg-primary px-3 py-2"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(v) => toggle(s.id, v === true)}
                  />
                  <Icon className="h-4 w-4 shrink-0 text-text-tertiary" />
                  <span className="min-w-0 flex-1 truncate text-sm text-text-primary">
                    {s.name}
                  </span>
                  <Badge
                    variant={
                      s.status === 'ready'
                        ? 'success'
                        : s.status === 'error'
                          ? 'danger'
                          : 'outline'
                    }
                    className="shrink-0 text-[10px]"
                  >
                    {s.status}
                  </Badge>
                </label>
              )
            })
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button type="button" onClick={save} disabled={isPending} size="sm" className="gap-1">
          <BookOpen className="h-3.5 w-3.5" />
          {isPending ? 'Saving…' : 'Save knowledge'}
        </Button>
      </div>
    </div>
  )
}
