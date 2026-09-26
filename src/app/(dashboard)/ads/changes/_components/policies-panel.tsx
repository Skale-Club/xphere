'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { Database } from '@/types/database'
import type { EffectivePolicy } from '@/lib/ads/commands/policies'
import { platformLabel } from './format'

type PolicyDbRow = Database['public']['Tables']['ads_account_policies']['Row']

type Account = { platform: 'meta' | 'google'; adAccountId: string; adAccountName: string | null }

type Scope = { key: string; label: string; platform: 'meta' | 'google' | null; adAccountId: string | null }

type TriState = 'inherit' | 'true' | 'false'
type AiModeChoice = 'inherit' | 'read_only' | 'propose' | 'execute_with_confirmation'

type FormState = {
  max_daily_budget: string
  max_budget_increase_pct: string
  allow_enable: TriState
  allow_bidding_changes: TriState
  allow_bulk: TriState
  ai_mode: AiModeChoice
  require_approval_min_risk: string
  approval_ttl_minutes: string
  protected_campaign_ids: string
}

const BLANK_FORM: FormState = {
  max_daily_budget: '',
  max_budget_increase_pct: '',
  allow_enable: 'inherit',
  allow_bidding_changes: 'inherit',
  allow_bulk: 'inherit',
  ai_mode: 'inherit',
  require_approval_min_risk: '',
  approval_ttl_minutes: '',
  protected_campaign_ids: '',
}

const AI_MODE_HELP: Record<AiModeChoice, string> = {
  inherit: 'Uses whatever the broader scope has set.',
  read_only: 'The AI can read this account but never propose a change.',
  propose: 'The AI can prepare a diff; a human approves it in Ads → Changes.',
  execute_with_confirmation:
    'An MCP client (e.g. Codex) may apply a change after echoing the confirmation token it received at preview — its tool instructions still tell it to ask the operator first.',
}

function rowToForm(row: PolicyDbRow | undefined): FormState {
  if (!row) return { ...BLANK_FORM }
  return {
    max_daily_budget: row.max_daily_budget != null ? String(row.max_daily_budget) : '',
    max_budget_increase_pct: row.max_budget_increase_pct != null ? String(row.max_budget_increase_pct) : '',
    allow_enable: row.allow_enable == null ? 'inherit' : row.allow_enable ? 'true' : 'false',
    allow_bidding_changes: row.allow_bidding_changes == null ? 'inherit' : row.allow_bidding_changes ? 'true' : 'false',
    allow_bulk: row.allow_bulk == null ? 'inherit' : row.allow_bulk ? 'true' : 'false',
    ai_mode: (row.ai_mode as AiModeChoice | null) ?? 'inherit',
    require_approval_min_risk: row.require_approval_min_risk != null ? String(row.require_approval_min_risk) : '',
    approval_ttl_minutes: row.approval_ttl_minutes != null ? String(row.approval_ttl_minutes) : '',
    protected_campaign_ids: (row.protected_campaign_ids ?? []).join(', '),
  }
}

export function PoliciesPanel({ accounts, canAdmin }: { accounts: Account[]; canAdmin: boolean }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [rows, setRows] = useState<PolicyDbRow[]>([])
  const [defaults, setDefaults] = useState<EffectivePolicy | null>(null)
  const [scopeKey, setScopeKey] = useState('global')
  const [form, setForm] = useState<FormState>(BLANK_FORM)

  const scopes = useMemo<Scope[]>(() => {
    const base: Scope[] = [
      { key: 'global', label: 'All platforms (org default)', platform: null, adAccountId: null },
      { key: 'meta', label: 'Meta (all accounts)', platform: 'meta', adAccountId: null },
      { key: 'google', label: 'Google (all accounts)', platform: 'google', adAccountId: null },
    ]
    const seen = new Set<string>()
    const accountScopes: Scope[] = []
    for (const a of accounts) {
      const key = `${a.platform}:${a.adAccountId}`
      if (seen.has(key)) continue
      seen.add(key)
      accountScopes.push({
        key,
        label: `${platformLabel(a.platform)} · ${a.adAccountName ?? a.adAccountId}`,
        platform: a.platform,
        adAccountId: a.adAccountId,
      })
    }
    return [...base, ...accountScopes]
  }, [accounts])

  useEffect(() => {
    if (!open) return
    setLoading(true)
    fetch('/api/ads/policies')
      .then((res) => res.json())
      .then((json: { policies: PolicyDbRow[]; defaults: EffectivePolicy }) => {
        setRows(json.policies ?? [])
        setDefaults(json.defaults)
      })
      .catch(() => toast.error('Failed to load account policies'))
      .finally(() => setLoading(false))
  }, [open])

  useEffect(() => {
    const scope = scopes.find((s) => s.key === scopeKey)
    if (!scope) return
    const row = rows.find((r) => r.platform === scope.platform && r.ad_account_id === scope.adAccountId)
    setForm(rowToForm(row))
  }, [scopeKey, rows, scopes])

  async function save() {
    const scope = scopes.find((s) => s.key === scopeKey)
    if (!scope) return
    setSaving(true)
    try {
      const protectedIds = form.protected_campaign_ids
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)

      const body = {
        platform: scope.platform,
        ad_account_id: scope.adAccountId,
        max_daily_budget: form.max_daily_budget === '' ? null : Number(form.max_daily_budget),
        max_budget_increase_pct: form.max_budget_increase_pct === '' ? null : Number(form.max_budget_increase_pct),
        allow_enable: form.allow_enable === 'inherit' ? null : form.allow_enable === 'true',
        allow_bidding_changes: form.allow_bidding_changes === 'inherit' ? null : form.allow_bidding_changes === 'true',
        allow_bulk: form.allow_bulk === 'inherit' ? null : form.allow_bulk === 'true',
        ai_mode: form.ai_mode === 'inherit' ? null : form.ai_mode,
        require_approval_min_risk: form.require_approval_min_risk === '' ? null : Number(form.require_approval_min_risk),
        approval_ttl_minutes: form.approval_ttl_minutes === '' ? null : Number(form.approval_ttl_minutes),
        protected_campaign_ids: protectedIds,
      }

      const res = await fetch('/api/ads/policies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = (await res.json().catch(() => ({}))) as { policy?: PolicyDbRow; error?: string }
      if (!res.ok || !json.policy) {
        toast.error(json.error ?? 'Failed to save policy')
        return
      }
      setRows((prev) => {
        const idx = prev.findIndex((r) => r.id === json.policy!.id)
        if (idx === -1) return [...prev, json.policy!]
        const next = [...prev]
        next[idx] = json.policy!
        return next
      })
      toast.success('Guardrails updated.')
    } catch {
      toast.error('Failed to save policy')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <ShieldCheck className="h-3.5 w-3.5" />
        Guardrails
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>Ad account guardrails</DialogTitle>
            <DialogDescription>
              Budget ceilings, protected campaigns and what the AI may do — org-wide defaults with per-account overrides. Empty fields inherit from the broader scope.
            </DialogDescription>
          </DialogHeader>

          {!canAdmin ? (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-[12.5px] text-amber-400">
              You need the <span className="font-medium">ads.admin</span> permission to view or change guardrails.
            </div>
          ) : loading ? (
            <div className="flex justify-center py-14">
              <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" />
            </div>
          ) : (
            <div className="grid grid-cols-[200px_1fr] gap-5">
              {/* Scope list */}
              <div className="space-y-1">
                {scopes.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => setScopeKey(s.key)}
                    className={cn(
                      'block w-full truncate rounded-md px-2.5 py-1.5 text-left text-[12.5px] transition-colors',
                      s.key === scopeKey
                        ? 'bg-bg-tertiary font-medium text-text-primary'
                        : 'text-text-secondary hover:bg-bg-secondary hover:text-text-primary',
                    )}
                    title={s.label}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              {/* Form */}
              <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="max_daily_budget">Max daily budget</Label>
                    <Input
                      id="max_daily_budget"
                      type="number"
                      min="0"
                      value={form.max_daily_budget}
                      onChange={(e) => setForm((f) => ({ ...f, max_daily_budget: e.target.value }))}
                      placeholder={defaults ? `Inherit (${defaults.maxDailyBudget})` : 'Inherit'}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="max_budget_increase_pct">Max budget increase per change (%)</Label>
                    <Input
                      id="max_budget_increase_pct"
                      type="number"
                      min="0"
                      value={form.max_budget_increase_pct}
                      onChange={(e) => setForm((f) => ({ ...f, max_budget_increase_pct: e.target.value }))}
                      placeholder={defaults ? `Inherit (${defaults.maxBudgetIncreasePct})` : 'Inherit'}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <TriStateField
                    label="Allow enabling"
                    value={form.allow_enable}
                    onChange={(v) => setForm((f) => ({ ...f, allow_enable: v }))}
                  />
                  <TriStateField
                    label="Allow bidding changes"
                    value={form.allow_bidding_changes}
                    onChange={(v) => setForm((f) => ({ ...f, allow_bidding_changes: v }))}
                  />
                  <TriStateField
                    label="Allow bulk changes"
                    value={form.allow_bulk}
                    onChange={(v) => setForm((f) => ({ ...f, allow_bulk: v }))}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>AI mode</Label>
                  <Select value={form.ai_mode} onValueChange={(v) => setForm((f) => ({ ...f, ai_mode: v as AiModeChoice }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="inherit">Inherit</SelectItem>
                      <SelectItem value="read_only">Read only</SelectItem>
                      <SelectItem value="propose">Propose</SelectItem>
                      <SelectItem value="execute_with_confirmation">Execute with confirmation</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[11.5px] text-text-tertiary">{AI_MODE_HELP[form.ai_mode]}</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="require_approval_min_risk">Require approval at risk level ≥</Label>
                    <Input
                      id="require_approval_min_risk"
                      type="number"
                      min="1"
                      max="5"
                      value={form.require_approval_min_risk}
                      onChange={(e) => setForm((f) => ({ ...f, require_approval_min_risk: e.target.value }))}
                      placeholder={defaults ? `Inherit (${defaults.requireApprovalMinRisk})` : 'Inherit'}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="approval_ttl_minutes">Approval window (minutes)</Label>
                    <Input
                      id="approval_ttl_minutes"
                      type="number"
                      min="5"
                      max="10080"
                      value={form.approval_ttl_minutes}
                      onChange={(e) => setForm((f) => ({ ...f, approval_ttl_minutes: e.target.value }))}
                      placeholder={defaults ? `Inherit (${defaults.approvalTtlMinutes})` : 'Inherit'}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="protected_campaign_ids">Protected campaign IDs</Label>
                  <Input
                    id="protected_campaign_ids"
                    value={form.protected_campaign_ids}
                    onChange={(e) => setForm((f) => ({ ...f, protected_campaign_ids: e.target.value }))}
                    placeholder="Comma-separated campaign IDs, e.g. 123456, 789012"
                  />
                  <p className="text-[11.5px] text-text-tertiary">
                    Protection accumulates across scopes — clearing this list here does not unprotect a campaign another scope protects.
                  </p>
                </div>
              </div>
            </div>
          )}

          {canAdmin && !loading && (
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
                Close
              </Button>
              <Button variant="primary" onClick={save} loading={saving}>
                Save guardrails
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function TriStateField({
  label,
  value,
  onChange,
}: {
  label: string
  value: TriState
  onChange: (v: TriState) => void
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select value={value} onValueChange={(v) => onChange(v as TriState)}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="inherit">Inherit</SelectItem>
          <SelectItem value="true">Allow</SelectItem>
          <SelectItem value="false">Don&apos;t allow</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
