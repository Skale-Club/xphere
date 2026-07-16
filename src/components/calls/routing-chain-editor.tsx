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
  Archive,
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
import { saveRoutingChain, type RoutingChainState } from '@/app/(dashboard)/calls/routing-actions'
import {
  createSharedDestination,
  archiveCallDestination,
  type CallDestinationOption,
} from '@/app/(dashboard)/calls/destination-actions'

interface MemberOption {
  user_id: string
  display_name: string
  email: string | null
}

interface Props {
  initial: RoutingChainState
  members: MemberOption[]
  destinations: CallDestinationOption[]
}

const TARGET_META: Record<
  CallRoutingTargetType,
  {
    label: string
    needs: 'user' | 'number' | 'destination' | 'none'
    icon: React.ComponentType<{ className?: string }>
  }
> = {
  team: { label: 'All users', needs: 'none', icon: Users },
  member: { label: 'Team member', needs: 'user', icon: Users },
  destination: { label: 'Shared destination', needs: 'destination', icon: PhoneCall },
  forward: { label: 'External number', needs: 'number', icon: PhoneForwarded },
  // Legacy granular targets — kept so pre-v3.5 chains render and stay editable.
  browser: { label: 'Browser softphone', needs: 'user', icon: Globe },
  pwa: { label: 'Mobile app (PWA)', needs: 'user', icon: Smartphone },
  cell: { label: 'Cell phone number', needs: 'number', icon: PhoneCall },
  sip: { label: 'SIP', needs: 'user', icon: Server },
}

// Semantic targets shown to everyone; legacy types appear in the dropdown only
// when the target being edited already uses one.
const TARGET_ORDER: CallRoutingTargetType[] = ['team', 'member', 'destination', 'forward']
const LEGACY_TYPES: CallRoutingTargetType[] = ['browser', 'pwa', 'cell', 'sip']

function newTarget(): CallRoutingTarget {
  return { type: 'member' }
}

function newStage(): CallRoutingStage {
  return { enabled: true, timeout_seconds: 25, targets: [newTarget()] }
}

// Mirrors ChainSchema.stages.max(10) in routing-actions.ts (server is the
// source of truth; this only lets the UI stop the user before the server
// round-trip fails with a generic toast).
const MAX_STAGES = 10

export function RoutingChainEditor({ initial, members, destinations }: Props) {
  const [isActive, setIsActive] = React.useState(initial.is_active)
  const [stages, setStages] = React.useState<CallRoutingStage[]>(initial.stages)
  const [saving, setSaving] = React.useState(false)
  const [destOptions, setDestOptions] = React.useState<CallDestinationOption[]>(destinations)
  // Inline "new shared destination" mini-form, keyed to the target being edited.
  const [newDest, setNewDest] = React.useState<{
    si: number
    ti: number
    name: string
    number: string
    saving: boolean
  } | null>(null)

  const handleCreateDestination = async () => {
    if (!newDest || newDest.saving) return
    setNewDest({ ...newDest, saving: true })
    const res = await createSharedDestination({ name: newDest.name, number: newDest.number })
    if (res.error || !res.destination) {
      toast.error(res.error ?? 'Could not create destination.')
      setNewDest({ ...newDest, saving: false })
      return
    }
    setDestOptions((prev) => [...prev, res.destination!])
    updateTarget(newDest.si, newDest.ti, { destination_id: res.destination.id })
    setNewDest(null)
    toast.success(`Destination "${res.destination.name}" created.`)
  }

  const handleArchiveDestination = async (destination: CallDestinationOption) => {
    if (
      typeof window !== 'undefined' &&
      !window.confirm(`Archive "${destination.name}"? It will no longer be selectable for new stages.`)
    ) {
      return
    }
    const res = await archiveCallDestination(destination.id)
    if (res.error) {
      toast.error(res.error)
      return
    }
    setDestOptions((prev) => prev.filter((d) => d.id !== destination.id))
    toast.success(`Destination "${destination.name}" archived.`)
  }

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
    <div className="w-full space-y-6 py-2">
      {/* Header + kill switch */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[13px] text-text-secondary">
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
                const typeOptions = LEGACY_TYPES.includes(target.type)
                  ? [...TARGET_ORDER, target.type]
                  : TARGET_ORDER
                const isCreatingHere = newDest?.si === si && newDest?.ti === ti
                return (
                  <div key={ti} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Select
                        value={target.type}
                        onValueChange={(v) => {
                          setNewDest(null)
                          updateTarget(si, ti, {
                            type: v as CallRoutingTargetType,
                            user_id: undefined,
                            number: undefined,
                            destination_id: undefined,
                          })
                        }}
                      >
                        <SelectTrigger className="w-[200px] shrink-0">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {typeOptions.map((type) => {
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
                      ) : meta.needs === 'destination' ? (
                        <Select
                          value={isCreatingHere ? '__new__' : target.destination_id}
                          onValueChange={(v) => {
                            if (v === '__new__') {
                              setNewDest({ si, ti, name: '', number: '', saving: false })
                            } else {
                              setNewDest(null)
                              updateTarget(si, ti, { destination_id: v })
                            }
                          }}
                        >
                          <SelectTrigger className="flex-1">
                            <SelectValue placeholder="Select a shared destination" />
                          </SelectTrigger>
                          <SelectContent>
                            {destOptions
                              .filter((d) => d.kind === 'shared')
                              .map((d) => (
                                // Archive button is a SIBLING of SelectItem, not nested
                                // inside it — Radix Select treats the whole Item subtree
                                // as one click target, so a nested button would either be
                                // unreachable or accidentally trigger selection.
                                <div key={d.id} className="relative flex items-center">
                                  <SelectItem value={d.id} className="flex-1 pr-8">
                                    {d.name} {d.number ? `· ${d.number}` : ''}
                                  </SelectItem>
                                  <button
                                    type="button"
                                    aria-label={`Archive ${d.name}`}
                                    className="absolute right-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-text-tertiary hover:bg-destructive/10 hover:text-destructive"
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      e.preventDefault()
                                      void handleArchiveDestination(d)
                                    }}
                                  >
                                    <Archive className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              ))}
                            <SelectItem value="__new__">
                              <span className="flex items-center gap-2 text-accent">
                                <Plus className="h-3.5 w-3.5" />
                                New shared destination…
                              </span>
                            </SelectItem>
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
                          Rings every member everywhere they answer — browser/PWA and their
                          forward number — at the same time.
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

                    {isCreatingHere && newDest && (
                      <div className="ml-[208px] flex items-center gap-2 rounded-[10px] border border-border-subtle bg-bg-tertiary/40 p-2">
                        <Input
                          value={newDest.name}
                          onChange={(e) => setNewDest({ ...newDest, name: e.target.value })}
                          placeholder="Name (e.g. Reception)"
                          className="h-8 flex-1"
                        />
                        <Input
                          value={newDest.number}
                          onChange={(e) => setNewDest({ ...newDest, number: e.target.value })}
                          placeholder="+15085551234"
                          className="h-8 w-44"
                        />
                        <Button
                          size="sm"
                          className="h-8"
                          disabled={newDest.saving}
                          onClick={handleCreateDestination}
                        >
                          {newDest.saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                          Create
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8"
                          onClick={() => setNewDest(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    )}
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

      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          disabled={stages.length >= MAX_STAGES}
          onClick={() => setStages((p) => [...p, newStage()])}
        >
          <Plus className="mr-1.5 h-4 w-4" />
          Add stage
        </Button>
        {stages.length >= MAX_STAGES && (
          <span className="text-[12px] text-text-tertiary">
            Maximum of {MAX_STAGES} stages reached.
          </span>
        )}
      </div>

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
