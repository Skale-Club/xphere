'use client'

import * as React from 'react'
import { toast } from 'sonner'
import {
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Loader2,
  PhoneCall,
  Globe,
  Smartphone,
  PhoneForwarded,
  Server,
  Users,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type {
  CallRoutingStage,
  CallRoutingTarget,
  CallRoutingTargetType,
} from '@/types/database'
import { saveRoutingChain, type RoutingChainState } from '@/app/(dashboard)/settings/calls/actions'

interface MemberOption {
  user_id: string
  display_name: string
  email: string | null
}

interface Props {
  initial: RoutingChainState
  members: MemberOption[]
}

const TARGET_META: Record<
  CallRoutingTargetType,
  {
    label: string
    needs: 'user' | 'number' | 'none'
    icon: React.ComponentType<{ className?: string }>
  }
> = {
  team: { label: 'All users', needs: 'none', icon: Users },
  browser: { label: 'Browser softphone', needs: 'user', icon: Globe },
  pwa: { label: 'Mobile app (PWA)', needs: 'user', icon: Smartphone },
  cell: { label: 'Cell phone number', needs: 'number', icon: PhoneCall },
  sip: { label: 'SIP', needs: 'user', icon: Server },
  forward: { label: 'Forward to number', needs: 'number', icon: PhoneForwarded },
}

const TARGET_ORDER: CallRoutingTargetType[] = ['team', 'browser', 'pwa', 'cell', 'sip', 'forward']

function newTarget(): CallRoutingTarget {
  return { type: 'browser' }
}

function newStage(): CallRoutingStage {
  return { enabled: true, timeout_seconds: 25, targets: [newTarget()] }
}

export function RoutingChainEditor({ initial, members }: Props) {
  const [isActive, setIsActive] = React.useState(initial.is_active)
  const [stages, setStages] = React.useState<CallRoutingStage[]>(initial.stages)
  const [saving, setSaving] = React.useState(false)

  const updateStage = (i: number, patch: Partial<CallRoutingStage>) =>
    setStages((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))

  const moveStage = (i: number, dir: -1 | 1) =>
    setStages((prev) => {
      const next = [...prev]
      const j = i + dir
      if (j < 0 || j >= next.length) return prev
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  const removeStage = (i: number) =>
    setStages((prev) => prev.filter((_, idx) => idx !== i))

  const updateTarget = (si: number, ti: number, patch: Partial<CallRoutingTarget>) =>
    setStages((prev) =>
      prev.map((s, idx) =>
        idx === si
          ? { ...s, targets: s.targets.map((t, j) => (j === ti ? { ...t, ...patch } : t)) }
          : s,
      ),
    )

  const addTarget = (si: number) =>
    setStages((prev) =>
      prev.map((s, idx) => (idx === si ? { ...s, targets: [...s.targets, newTarget()] } : s)),
    )

  const removeTarget = (si: number, ti: number) =>
    setStages((prev) =>
      prev.map((s, idx) =>
        idx === si ? { ...s, targets: s.targets.filter((_, j) => j !== ti) } : s,
      ),
    )

  async function handleSave() {
    setSaving(true)
    try {
      const res = await saveRoutingChain({ is_active: isActive, stages })
      if (res.error) toast.error(res.error)
      else toast.success('Call routing saved')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 py-2">
      {/* Header + kill switch */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Call routing</h1>
          <p className="mt-1 text-[13px] text-text-secondary">
            Set the priority order for inbound calls. Each stage rings every destination at
            the same time. Whoever answers first gets the call; if nobody answers within
            the timeout, the call moves to the next stage.
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 pt-1">
          <Switch checked={isActive} onCheckedChange={setIsActive} />
          <span className="text-[13px] text-text-secondary">{isActive ? 'Active' : 'Off'}</span>
        </label>
      </div>

      {!isActive && (
        <div className="rounded-[10px] border border-border-subtle bg-bg-secondary px-4 py-3 text-[13px] text-text-tertiary">
          Routing is off. Inbound calls use each phone number&apos;s default behavior.
        </div>
      )}

      {/* Stages */}
      <div className="space-y-4">
        {stages.map((stage, si) => (
          <div
            key={si}
            className="rounded-[12px] border border-border-subtle bg-bg-secondary p-4 space-y-4"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/15 text-[12px] font-semibold text-accent">
                  {si + 1}
                </span>
                <span className="text-[13px] font-medium text-text-primary">Stage {si + 1}</span>
                <label className="ml-2 flex items-center gap-1.5">
                  <Switch
                    checked={stage.enabled}
                    onCheckedChange={(v) => updateStage(si, { enabled: v })}
                  />
                  <span className="text-[11.5px] text-text-tertiary">
                    {stage.enabled ? 'enabled' : 'paused'}
                  </span>
                </label>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={si === 0}
                  onClick={() => moveStage(si, -1)}
                  aria-label="Move stage up"
                >
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={si === stages.length - 1}
                  onClick={() => moveStage(si, 1)}
                  aria-label="Move stage down"
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive"
                  onClick={() => removeStage(si)}
                  aria-label="Remove stage"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Targets */}
            <div className="space-y-2">
              {stage.targets.map((target, ti) => {
                const meta = TARGET_META[target.type]
                return (
                  <div key={ti} className="flex items-center gap-2">
                    <Select
                      value={target.type}
                      onValueChange={(v) =>
                        updateTarget(si, ti, {
                          type: v as CallRoutingTargetType,
                          user_id: undefined,
                          number: undefined,
                        })
                      }
                    >
                      <SelectTrigger className="w-[200px] shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TARGET_ORDER.map((type) => {
                          const Icon = TARGET_META[type].icon
                          return (
                            <SelectItem key={type} value={type}>
                              <span className="flex items-center gap-2">
                                <Icon className="h-3.5 w-3.5" />
                                {TARGET_META[type].label}
                              </span>
                            </SelectItem>
                          )
                        })}
                      </SelectContent>
                    </Select>

                    {meta.needs === 'user' ? (
                      <Select
                        value={target.user_id}
                        onValueChange={(v) => updateTarget(si, ti, { user_id: v })}
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="Select a user" />
                        </SelectTrigger>
                        <SelectContent>
                          {members.map((m) => (
                            <SelectItem key={m.user_id} value={m.user_id}>
                              {m.display_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : meta.needs === 'number' ? (
                      <Input
                        value={target.number ?? ''}
                        onChange={(e) => updateTarget(si, ti, { number: e.target.value })}
                        placeholder="+5511999999999"
                        className="flex-1"
                      />
                    ) : (
                      <span className="flex-1 px-2 text-[12px] text-text-tertiary">
                        Rings every team member with a browser/PWA phone at the same time.
                      </span>
                    )}

                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-text-tertiary"
                      disabled={stage.targets.length === 1}
                      onClick={() => removeTarget(si, ti)}
                      aria-label="Remove destination"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )
              })}

              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[12px] text-accent"
                onClick={() => addTarget(si)}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add destination
              </Button>
            </div>

            {/* Timeout */}
            <div className="flex items-center gap-3 border-t border-border-subtle pt-3">
              <Label className="text-[12px] text-text-secondary">Ring for</Label>
              <Input
                type="number"
                min={5}
                max={120}
                value={stage.timeout_seconds}
                onChange={(e) =>
                  updateStage(si, { timeout_seconds: parseInt(e.target.value, 10) || 25 })
                }
                className="h-8 w-20"
              />
              <span className="text-[12px] text-text-tertiary">
                seconds before moving to the next stage
              </span>
            </div>
          </div>
        ))}
      </div>

      <Button variant="outline" onClick={() => setStages((p) => [...p, newStage()])}>
        <Plus className="mr-1.5 h-4 w-4" />
        Add stage
      </Button>

      {/* Save */}
      <div className="flex justify-end border-t border-border-subtle pt-4">
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          Save routing
        </Button>
      </div>
    </div>
  )
}
