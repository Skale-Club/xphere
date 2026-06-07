'use client'

// Configure which OTHER agents this agent may call ("delegate to"). Backed by
// agent_partners; the runtime already turns these into delegation tools. This
// is purely the on/off + "when to delegate" config UI.

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Users, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  addAgentPartner,
  removeAgentPartner,
  type AgentPartnerListItem,
} from '@/app/(dashboard)/agents/_actions/partners'

interface PartnerOption {
  id: string
  name: string
  slug: string
}

interface AgentPartnersManagerProps {
  agentId: string
  initialPartners: AgentPartnerListItem[]
  /** All active org agents (used to pick partners; self is filtered out). */
  availableAgents: PartnerOption[]
}

export function AgentPartnersManager({
  agentId,
  initialPartners,
  availableAgents,
}: AgentPartnersManagerProps) {
  const router = useRouter()
  const [partners, setPartners] = React.useState(initialPartners)
  const [selected, setSelected] = React.useState<string>('')
  const [description, setDescription] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const attachedIds = new Set(partners.map((p) => p.partner_agent_id))
  const options = availableAgents.filter(
    (a) => a.id !== agentId && !attachedIds.has(a.id)
  )

  async function handleAdd() {
    if (!selected) {
      toast.error('Pick an agent to delegate to.')
      return
    }
    setBusy(true)
    try {
      const res = await addAgentPartner(agentId, selected, description)
      if (res.error) {
        toast.error(res.error)
        return
      }
      const picked = availableAgents.find((a) => a.id === selected)
      setPartners((prev) => [
        ...prev,
        {
          id: res.id!,
          partner_agent_id: selected,
          partner_name: picked?.name ?? '(unknown)',
          partner_slug: picked?.slug ?? '',
          invocation_description: description.trim(),
        },
      ])
      setSelected('')
      setDescription('')
      toast.success('Partner added')
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove(id: string) {
    setBusy(true)
    try {
      const res = await removeAgentPartner(id, agentId)
      if (res && 'error' in res && res.error) {
        toast.error(res.error)
        return
      }
      setPartners((prev) => prev.filter((p) => p.id !== id))
      toast.success('Partner removed')
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      {partners.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This agent doesn&apos;t delegate to any other agents yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {partners.map((p) => (
            <li
              key={p.id}
              className="flex items-start justify-between gap-3 rounded-[8px] border border-border bg-bg-primary px-3 py-2"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-sm font-medium text-text-primary">
                  <Users className="h-3.5 w-3.5 text-text-tertiary" />
                  {p.partner_name}
                </div>
                {p.invocation_description && (
                  <p className="mt-0.5 text-xs text-text-secondary">
                    {p.invocation_description}
                  </p>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-text-tertiary"
                onClick={() => void handleRemove(p.id)}
                disabled={busy}
                aria-label={`Remove ${p.partner_name}`}
              >
                <X className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2 rounded-[8px] border border-dashed border-border p-3">
        <Select value={selected} onValueChange={setSelected} disabled={busy || options.length === 0}>
          <SelectTrigger>
            <SelectValue
              placeholder={
                options.length === 0 ? 'No other agents available' : 'Select an agent to delegate to'
              }
            />
          </SelectTrigger>
          <SelectContent>
            {options.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="When should this agent delegate to the partner?"
          disabled={busy}
        />
        <Button
          type="button"
          size="sm"
          onClick={() => void handleAdd()}
          disabled={busy || !selected}
          className="gap-1"
        >
          <Plus className="h-3.5 w-3.5" />
          Add partner
        </Button>
      </div>
    </div>
  )
}
