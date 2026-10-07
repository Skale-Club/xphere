'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Bot,
  Globe,
  Loader2,
  Lock,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  UserCheck,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { PlatformMark } from '@/components/ads/platform-mark'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { Database } from '@/types/database'
import type { EffectivePolicy } from '@/lib/ads/commands/policies'
import { platformLabel, riskLabel } from './format'

type PolicyDbRow = Database['public']['Tables']['ads_account_policies']['Row']

type Account = { platform: 'meta' | 'google' | 'google_business'; adAccountId: string; adAccountName: string | null }

type Scope = { key: string; label: string; platform: 'meta' | 'google' | 'google_business' | null; adAccountId: string | null }

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
  inherit: 'Follow the broader scope.',
  read_only: 'Can read the account, never propose a change.',
  propose: 'Prepares changes; a person approves them here in Changes.',
  execute_with_confirmation:
    'May apply a change after echoing the token it got at preview. Its instructions still tell it to ask you first.',
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
      { key: 'google_business', label: 'Google Business (all locations)', platform: 'google_business', adAccountId: null },
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

  const scope = scopes.find((s) => s.key === scopeKey) ?? scopes[0]
  const parentLabel =
    scope.platform === null
      ? 'the built-in defaults'
      : scope.adAccountId === null
        ? 'All platforms'
        : `All ${platformLabel(scope.platform)}`
  const overrides = countOverrides(form)
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }))
  const rowFor = (s: Scope) => rows.find((r) => r.platform === s.platform && r.ad_account_id === s.adAccountId)
  const defaultScopes = scopes.filter((s) => s.adAccountId === null)
  const accountScopes = scopes.filter((s) => s.adAccountId !== null)

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <ShieldCheck className="h-3.5 w-3.5" />
        Guardrails
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[min(720px,90vh)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[960px]">
          <DialogHeader className="shrink-0 border-b border-border-subtle px-6 py-5">
            <div className="flex items-center gap-3 pr-8">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                <ShieldCheck className="h-[18px] w-[18px]" />
              </span>
              <div className="min-w-0 space-y-1">
                <DialogTitle>Guardrails</DialogTitle>
                <DialogDescription className="text-[12.5px]">
                  Limits on what can change in your ad accounts and how much the AI may do on its own. Set org-wide defaults, then override them per platform or account.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {!canAdmin ? (
            <div className="m-6 rounded-lg border border-warning/25 bg-warning/10 px-4 py-3 text-[12.5px] text-warning">
              You need the <span className="font-medium">ads.admin</span> permission to view or change guardrails.
            </div>
          ) : loading ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" />
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
              {/* Scopes */}
              <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-border-subtle bg-bg-secondary/40 p-2 sm:w-[248px] sm:flex-col sm:overflow-y-auto sm:border-b-0 sm:border-r sm:p-3">
                <ScopeHeading>Defaults</ScopeHeading>
                {defaultScopes.map((s) => (
                  <ScopeButton key={s.key} scope={s} active={s.key === scopeKey} customized={countOverrides(rowToForm(rowFor(s))) > 0} onClick={() => setScopeKey(s.key)} />
                ))}
                {accountScopes.length > 0 && <ScopeHeading className="sm:mt-3">Accounts</ScopeHeading>}
                {accountScopes.map((s) => (
                  <ScopeButton key={s.key} scope={s} active={s.key === scopeKey} customized={countOverrides(rowToForm(rowFor(s))) > 0} onClick={() => setScopeKey(s.key)} />
                ))}
              </nav>

              {/* Form */}
              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle px-6 py-4">
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-semibold text-text-primary">{scopeName(scope)}</div>
                    <div className="text-[12px] text-text-tertiary">Anything left on Inherit follows {parentLabel}.</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-bg-tertiary px-2 py-0.5 text-[11px] text-text-secondary">
                      {overrides === 0 ? 'Inherits everything' : `${overrides} override${overrides === 1 ? '' : 's'}`}
                    </span>
                    {overrides > 0 && (
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px]" onClick={() => setForm({ ...BLANK_FORM })}>
                        <RotateCcw className="h-3 w-3" />
                        Reset
                      </Button>
                    )}
                  </div>
                </div>

                <div className="divide-y divide-border-subtle">
                  <FormSection icon={Wallet} title="Budget" description="Ceilings checked before any budget change is sent.">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <NumberField
                        id="max_daily_budget"
                        label="Max daily budget"
                        value={form.max_daily_budget}
                        onChange={(v) => set('max_daily_budget', v)}
                        min={0}
                        inherited={defaults ? defaults.maxDailyBudget.toLocaleString() : null}
                        suffix="/ day"
                      />
                      <NumberField
                        id="max_budget_increase_pct"
                        label="Max increase per change"
                        value={form.max_budget_increase_pct}
                        onChange={(v) => set('max_budget_increase_pct', v)}
                        min={0}
                        inherited={defaults ? `${defaults.maxBudgetIncreasePct}%` : null}
                        suffix="%"
                      />
                    </div>
                  </FormSection>

                  <FormSection icon={SlidersHorizontal} title="What can change" description="Kinds of change that are refused outright when blocked.">
                    <div className="divide-y divide-border-subtle rounded-lg border border-border-subtle">
                      <TriStateRow
                        label="Turn things on"
                        hint="Enable paused campaigns, ad groups, ads and keywords"
                        value={form.allow_enable}
                        inherited={defaults?.allowEnable}
                        onChange={(v) => set('allow_enable', v)}
                      />
                      <TriStateRow
                        label="Bidding changes"
                        hint="Bid strategies, targets and manual bids"
                        value={form.allow_bidding_changes}
                        inherited={defaults?.allowBiddingChanges}
                        onChange={(v) => set('allow_bidding_changes', v)}
                      />
                      <TriStateRow
                        label="Bulk changes"
                        hint="Several changes submitted together as one batch"
                        value={form.allow_bulk}
                        inherited={defaults?.allowBulk}
                        onChange={(v) => set('allow_bulk', v)}
                      />
                    </div>
                  </FormSection>

                  <FormSection icon={Bot} title="AI autonomy" description="How far an AI client (Copilot, or Codex over MCP) may go here.">
                    <div className="grid gap-2 sm:grid-cols-2">
                      {AI_MODES.map((m) => {
                        const selected = form.ai_mode === m.value
                        return (
                          <button
                            key={m.value}
                            type="button"
                            onClick={() => set('ai_mode', m.value)}
                            aria-pressed={selected}
                            className={cn(
                              'flex flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors',
                              selected
                                ? 'border-accent/60 bg-accent/[0.06] ring-1 ring-accent/30'
                                : 'border-border-subtle hover:border-border hover:bg-bg-secondary/60',
                            )}
                          >
                            <span className="flex items-center gap-2 text-[12.5px] font-medium text-text-primary">
                              <span className={cn('flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border', selected ? 'border-accent' : 'border-border')}>
                                {selected && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
                              </span>
                              {m.label}
                              {m.value === 'inherit' && defaults && (
                                <span className="font-normal text-text-tertiary">· {AI_MODE_NAME[defaults.aiMode as keyof typeof AI_MODE_NAME] ?? defaults.aiMode}</span>
                              )}
                            </span>
                            <span className="pl-[22px] text-[11.5px] leading-snug text-text-tertiary">{AI_MODE_HELP[m.value]}</span>
                          </button>
                        )
                      })}
                    </div>
                  </FormSection>

                  <FormSection icon={UserCheck} title="Approvals" description="When a change needs a second person with approval rights before it runs.">
                    <div className="space-y-4">
                      <div className="space-y-1.5">
                        <Label className="text-[12.5px]">Needs approval from risk level</Label>
                        <div>
                          <Segmented
                            value={form.require_approval_min_risk === '' ? 'inherit' : form.require_approval_min_risk}
                            onChange={(v) => set('require_approval_min_risk', v === 'inherit' ? '' : v)}
                            options={[
                              { value: 'inherit', label: 'Inherit', hint: defaults ? riskOptionLabel(defaults.requireApprovalMinRisk) : undefined },
                              ...[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: riskOptionLabel(n) })),
                            ]}
                          />
                        </div>
                        <p className="text-[11.5px] text-text-tertiary">
                          Levels go Reversible → Targeting → Strategy → Structural; the chosen one and everything above it wait for approval. Never lets every change run.
                        </p>
                      </div>
                      <div className="sm:max-w-[50%]">
                        <NumberField
                          id="approval_ttl_minutes"
                          label="Approval window"
                          value={form.approval_ttl_minutes}
                          onChange={(v) => set('approval_ttl_minutes', v)}
                          min={5}
                          max={10080}
                          inherited={defaults ? formatMinutes(defaults.approvalTtlMinutes) : null}
                          suffix="min"
                          hint={form.approval_ttl_minutes !== '' ? `Expires after ${formatMinutes(Number(form.approval_ttl_minutes))} without approval` : undefined}
                        />
                      </div>
                    </div>
                  </FormSection>

                  <FormSection
                    icon={Lock}
                    title="Protected campaigns"
                    description="Campaigns nothing may touch. Protection adds up across scopes: removing an ID here does not unprotect it where another scope lists it."
                  >
                    <ChipInput
                      value={form.protected_campaign_ids}
                      onChange={(v) => set('protected_campaign_ids', v)}
                      placeholder="Type a campaign ID and press Enter"
                    />
                  </FormSection>
                </div>
              </div>
            </div>
          )}

          {canAdmin && !loading && (
            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border-subtle bg-bg-secondary/40 px-6 py-3.5">
              <span className="hidden truncate text-[12px] text-text-tertiary sm:block">Saves the overrides for {scopeName(scope)}.</span>
              <div className="ml-auto flex items-center gap-2">
                <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
                  Close
                </Button>
                <Button variant="primary" onClick={save} loading={saving}>
                  Save guardrails
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

// ─── Pieces ────────────────────────────────────────────────────────────────────

const AI_MODES: { value: AiModeChoice; label: string }[] = [
  { value: 'inherit', label: 'Inherit' },
  { value: 'read_only', label: 'Read only' },
  { value: 'propose', label: 'Propose' },
  { value: 'execute_with_confirmation', label: 'Execute with confirmation' },
]

const AI_MODE_NAME: Record<Exclude<AiModeChoice, 'inherit'>, string> = {
  read_only: 'Read only',
  propose: 'Propose',
  execute_with_confirmation: 'Execute with confirmation',
}

function scopeName(scope: Scope): string {
  if (scope.platform === null) return 'All platforms'
  if (scope.adAccountId === null) return `All ${platformLabel(scope.platform)}`
  return scope.label.replace(/^[^·]+·\s*/, '')
}

function riskOptionLabel(n: number): string {
  return n >= 5 ? 'Never' : riskLabel(n)
}

function formatMinutes(min: number): string {
  if (!Number.isFinite(min) || min <= 0) return '—'
  if (min % 1440 === 0) return `${min / 1440} day${min === 1440 ? '' : 's'}`
  if (min % 60 === 0) return `${min / 60} h`
  return `${min} min`
}

function countOverrides(f: FormState): number {
  return (
    [f.max_daily_budget, f.max_budget_increase_pct, f.require_approval_min_risk, f.approval_ttl_minutes].filter((v) => v !== '').length +
    [f.allow_enable, f.allow_bidding_changes, f.allow_bulk, f.ai_mode].filter((v) => v !== 'inherit').length +
    (f.protected_campaign_ids.trim() ? 1 : 0)
  )
}

function ScopeHeading({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('hidden px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-text-tertiary sm:block', className)}>
      {children}
    </div>
  )
}

function ScopeButton({ scope, active, customized, onClick }: { scope: Scope; active: boolean; customized: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={scope.label}
      className={cn(
        'relative flex shrink-0 items-center gap-2.5 rounded-[7px] px-2.5 py-1.5 text-left text-[12.5px] transition-colors sm:w-full',
        active ? 'bg-accent/10 text-text-primary' : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary',
      )}
    >
      {active && <span className="absolute left-0 top-1/2 hidden h-[60%] w-[2.5px] -translate-y-1/2 rounded-r-full bg-accent sm:block" />}
      {scope.platform ? (
        <PlatformMark platform={scope.platform} className="h-6 w-6 rounded-md [&_img]:h-3.5 [&_img]:w-3.5 [&_svg]:h-3.5 [&_svg]:w-3.5" />
      ) : (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border-subtle bg-bg-tertiary">
          <Globe className="h-3.5 w-3.5 text-text-secondary" />
        </span>
      )}
      <span className="min-w-0 flex-1 truncate font-medium">{scopeName(scope)}</span>
      {customized && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" title="Has overrides" />}
    </button>
  )
}

function FormSection({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3 px-6 py-5">
      <div className="flex items-start gap-2.5">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-text-tertiary" />
        <div>
          <h3 className="text-[13px] font-semibold text-text-primary">{title}</h3>
          <p className="text-[12px] text-text-tertiary">{description}</p>
        </div>
      </div>
      <div className="sm:pl-[26px]">{children}</div>
    </section>
  )
}

function NumberField({
  id,
  label,
  value,
  onChange,
  inherited,
  suffix,
  min,
  max,
  hint,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  inherited: string | null
  suffix?: string
  min?: number
  max?: number
  hint?: string
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-[12.5px]">{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Inherit"
          className={cn('tabular-nums', suffix && 'pr-14')}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[12px] text-text-tertiary">{suffix}</span>
        )}
      </div>
      <p className="text-[11.5px] text-text-tertiary">
        {hint ?? (value === '' ? `Inherited${inherited ? `: ${inherited}` : ''}` : inherited ? `Default ${inherited}` : ' ')}
      </p>
    </div>
  )
}

function Segmented({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string; hint?: string }[]
}) {
  return (
    <div className="inline-flex max-w-full flex-wrap gap-1 rounded-lg bg-bg-tertiary p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cn(
            'flex h-7 items-center gap-1 rounded-[6px] px-2.5 text-[12px] font-medium transition-all',
            value === o.value ? 'bg-bg-primary text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary',
          )}
        >
          {o.label}
          {o.hint && <span className="font-normal text-text-tertiary">· {o.hint}</span>}
        </button>
      ))}
    </div>
  )
}

function TriStateRow({
  label,
  hint,
  value,
  inherited,
  onChange,
}: {
  label: string
  hint: string
  value: TriState
  inherited: boolean | undefined
  onChange: (v: TriState) => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-3">
      <div className="min-w-0">
        <div className="text-[12.5px] font-medium text-text-primary">{label}</div>
        <div className="text-[11.5px] text-text-tertiary">{hint}</div>
      </div>
      <Segmented
        value={value}
        onChange={(v) => onChange(v as TriState)}
        options={[
          { value: 'inherit', label: 'Inherit', hint: inherited === undefined ? undefined : inherited ? 'on' : 'off' },
          { value: 'true', label: 'Allow' },
          { value: 'false', label: 'Block' },
        ]}
      />
    </div>
  )
}

/** Campaign IDs as removable chips over the comma-separated form value. */
function ChipInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const [draft, setDraft] = useState('')
  const ids = value.split(',').map((s) => s.trim()).filter(Boolean)
  const commit = (raw: string) => {
    const add = raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)
    if (!add.length) return
    onChange([...new Set([...ids, ...add])].join(', '))
    setDraft('')
  }
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-border bg-bg-primary px-2 py-1.5 focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/20">
      {ids.map((id) => (
        <span key={id} className="inline-flex items-center gap-1 rounded-md bg-bg-tertiary py-0.5 pl-2 pr-1 font-mono text-[11.5px] text-text-primary">
          <Lock className="h-2.5 w-2.5 text-text-tertiary" />
          {id}
          <button
            type="button"
            onClick={() => onChange(ids.filter((x) => x !== id).join(', '))}
            className="rounded p-0.5 text-text-tertiary hover:bg-bg-secondary hover:text-text-primary"
            aria-label={`Unprotect ${id}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            commit(draft)
          } else if (e.key === 'Backspace' && draft === '' && ids.length) {
            onChange(ids.slice(0, -1).join(', '))
          }
        }}
        onBlur={() => commit(draft)}
        onPaste={(e) => {
          e.preventDefault()
          commit(e.clipboardData.getData('text'))
        }}
        placeholder={ids.length ? '' : placeholder}
        aria-label="Protected campaign IDs"
        className="min-w-[160px] flex-1 bg-transparent px-1 py-0.5 text-[12.5px] text-text-primary outline-none placeholder:text-text-tertiary"
      />
    </div>
  )
}
