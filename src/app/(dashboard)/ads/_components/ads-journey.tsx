'use client'

import React, { useState } from 'react'
import { cn } from '@/lib/utils'
import {
  Lightbulb,
  Target,
  Zap,
  BarChart2,
  CheckCircle2,
  Clock,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  BookOpen,
  Crosshair,
  FlaskConical,
  Layers,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

// ─── Types ────────────────────────────────────────────────────────────────────

type Memory = {
  id: string
  type: string
  status: string
  source: string
  platform: string | null
  title: string
  content: string
  campaign_name: string | null
  confidence: number
  proposed: boolean
  created_at: string
}

type Execution = {
  id: string
  type: string
  platform: string | null
  title: string
  description: string | null
  campaign_name: string | null
  before_value: string | null
  after_value: string | null
  executed_by_ai: boolean
  executed_at: string
}

type Plan = {
  id: string
  type: string
  title: string
  description: string | null
  platform: string | null
  metric: string | null
  target_value: number | null
  deadline: string | null
  status: string
  created_at: string
}

type Audit = {
  id: string
  period_type: string
  period_from: string
  period_to: string
  title: string
  spend_total: number
  leads_total: number
  opportunities_total: number
  revenue_total: number
  summary: string | null
  status: string
  created_at: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'story', label: 'Story', icon: BookOpen },
  { id: 'planning', label: 'Planning', icon: Target },
  { id: 'execution', label: 'Execution', icon: Zap },
  { id: 'audit', label: 'Audit', icon: BarChart2 },
]

const MEMORY_TYPE_ICONS: Record<string, React.ElementType> = {
  insight: Lightbulb,
  decision: CheckCircle2,
  plan: Target,
  risk: AlertTriangle,
  observation: BookOpen,
  result: BarChart2,
  goal: Crosshair,
}

const MEMORY_TYPE_COLORS: Record<string, string> = {
  insight: 'text-amber-400 bg-amber-400/10',
  decision: 'text-green-400 bg-green-400/10',
  plan: 'text-blue-400 bg-blue-400/10',
  risk: 'text-red-400 bg-red-400/10',
  observation: 'text-text-secondary bg-bg-tertiary',
  result: 'text-purple-400 bg-purple-400/10',
  goal: 'text-accent bg-accent/10',
}

const EXEC_TYPE_ICONS: Record<string, React.ElementType> = {
  campaign_pause: Clock,
  campaign_enable: CheckCircle2,
  budget_increase: TrendingUp,
  budget_decrease: TrendingDown,
  campaign_launch: Zap,
  manual: Layers,
}

const PLAN_TYPE_ICONS: Record<string, React.ElementType> = {
  strategy: Layers,
  hypothesis: FlaskConical,
  target: Crosshair,
  experiment: FlaskConical,
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
}

function PlatformBadge({ platform }: { platform: string | null }) {
  if (!platform) return null
  return (
    <span className={cn(
      'rounded-full px-2 py-0.5 text-[10px] font-medium',
      platform === 'meta' ? 'bg-blue-500/10 text-blue-400' : 'bg-[#4285F4]/10 text-[#4285F4]',
    )}>
      {platform === 'meta' ? 'Meta' : 'Google'}
    </span>
  )
}

function ConfidenceDots({ value }: { value: number }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={cn('h-1.5 w-1.5 rounded-full', i <= value ? 'bg-accent' : 'bg-bg-tertiary')} />
      ))}
    </span>
  )
}

// ─── História tab ─────────────────────────────────────────────────────────────

function StoryTab({ memories, onApprove, onDismiss }: {
  memories: Memory[]
  onApprove: (id: string) => void
  onDismiss: (id: string) => void
}) {
  const pending = memories.filter((m) => m.status === 'needs_review')
  const active = memories.filter((m) => m.status === 'active')

  return (
    <div className="space-y-6">
      {pending.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-400">
              Pending review ({pending.length})
            </span>
          </div>
          <div className="space-y-2">
            {pending.map((m) => {
              const Icon = MEMORY_TYPE_ICONS[m.type] ?? Lightbulb
              const colorClass = MEMORY_TYPE_COLORS[m.type] ?? MEMORY_TYPE_COLORS.observation
              return (
                <div key={m.id} className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
                  <div className="flex items-start gap-3">
                    <div className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full mt-0.5', colorClass)}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[12.5px] font-medium text-text-primary">{m.title}</span>
                        <PlatformBadge platform={m.platform} />
                        {m.campaign_name && (
                          <span className="text-[10.5px] text-text-tertiary">· {m.campaign_name}</span>
                        )}
                      </div>
                      <p className="mt-0.5 text-[12px] text-text-secondary leading-relaxed">{m.content}</p>
                      <div className="mt-2 flex items-center gap-3">
                        <ConfidenceDots value={m.confidence} />
                        <span className="text-[10.5px] text-text-tertiary">{formatDate(m.created_at)}</span>
                        <span className="text-[10.5px] text-text-tertiary capitalize">{m.source}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button size="sm" className="h-6 px-2 text-[11px]" onClick={() => onApprove(m.id)}>
                        Approve
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => onDismiss(m.id)}>
                        Dismiss
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {active.length > 0 ? (
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary mb-3 block">
            Active memories ({active.length})
          </span>
          <div className="space-y-2">
            {active.map((m) => {
              const Icon = MEMORY_TYPE_ICONS[m.type] ?? Lightbulb
              const colorClass = MEMORY_TYPE_COLORS[m.type] ?? MEMORY_TYPE_COLORS.observation
              return (
                <div key={m.id} className="rounded-xl border border-border-subtle bg-bg-secondary px-4 py-3">
                  <div className="flex items-start gap-3">
                    <div className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full mt-0.5', colorClass)}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[12.5px] font-medium text-text-primary">{m.title}</span>
                        <PlatformBadge platform={m.platform} />
                        {m.campaign_name && (
                          <span className="text-[10.5px] text-text-tertiary">· {m.campaign_name}</span>
                        )}
                      </div>
                      <p className="mt-0.5 text-[12px] text-text-secondary leading-relaxed">{m.content}</p>
                      <div className="mt-1.5 flex items-center gap-3">
                        <ConfidenceDots value={m.confidence} />
                        <span className="text-[10.5px] text-text-tertiary">{formatDate(m.created_at)}</span>
                        <span className="text-[10.5px] text-text-tertiary capitalize">{m.source}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : pending.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <BookOpen className="h-8 w-8 text-text-tertiary mb-3" />
          <p className="text-[13px] text-text-secondary">No memories yet</p>
          <p className="text-[12px] text-text-tertiary mt-1">Chat with the Ads AI to start building the story</p>
        </div>
      )}
    </div>
  )
}

// ─── Planejamento tab ─────────────────────────────────────────────────────────

function PlanningTab({ plans }: { plans: Plan[] }) {
  if (!plans.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Target className="h-8 w-8 text-text-tertiary mb-3" />
        <p className="text-[13px] text-text-secondary">No plans yet</p>
        <p className="text-[12px] text-text-tertiary mt-1">Use the MCP <code className="text-[11px]">ads_create_plan</code> to record strategies</p>
      </div>
    )
  }

  const STATUS_COLORS: Record<string, string> = {
    draft: 'text-text-tertiary bg-bg-tertiary',
    active: 'text-green-400 bg-green-400/10',
    validated: 'text-blue-400 bg-blue-400/10',
    invalidated: 'text-red-400 bg-red-400/10',
    paused: 'text-amber-400 bg-amber-400/10',
  }

  return (
    <div className="space-y-2">
      {plans.map((p) => {
        const Icon = PLAN_TYPE_ICONS[p.type] ?? Target
        return (
          <div key={p.id} className="rounded-xl border border-border-subtle bg-bg-secondary px-4 py-3">
            <div className="flex items-start gap-3">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 mt-0.5">
                <Icon className="h-3.5 w-3.5 text-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[12.5px] font-medium text-text-primary">{p.title}</span>
                  <PlatformBadge platform={p.platform} />
                  <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium capitalize', STATUS_COLORS[p.status] ?? STATUS_COLORS.draft)}>
                    {p.status}
                  </span>
                </div>
                {p.description && (
                  <p className="mt-0.5 text-[12px] text-text-secondary leading-relaxed">{p.description}</p>
                )}
                <div className="mt-1.5 flex items-center gap-3 text-[10.5px] text-text-tertiary">
                  <span className="capitalize">{p.type}</span>
                  {p.metric && p.target_value != null && (
                    <span>{p.metric}: {p.target_value}</span>
                  )}
                  {p.deadline && <span>Prazo: {p.deadline}</span>}
                  <span>{formatDate(p.created_at)}</span>
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Execução tab ─────────────────────────────────────────────────────────────

function ExecutionTab({ executions }: { executions: Execution[] }) {
  if (!executions.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Zap className="h-8 w-8 text-text-tertiary mb-3" />
        <p className="text-[13px] text-text-secondary">No executions yet</p>
        <p className="text-[12px] text-text-tertiary mt-1">Actions executed by AI or manually will appear here</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {executions.map((e) => {
        const Icon = EXEC_TYPE_ICONS[e.type] ?? Zap
        return (
          <div key={e.id} className="rounded-xl border border-border-subtle bg-bg-secondary px-4 py-3">
            <div className="flex items-start gap-3">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-bg-tertiary mt-0.5">
                <Icon className="h-3.5 w-3.5 text-text-secondary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[12.5px] font-medium text-text-primary">{e.title}</span>
                  <PlatformBadge platform={e.platform} />
                  {e.executed_by_ai && (
                    <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">IA</span>
                  )}
                </div>
                {e.description && (
                  <p className="mt-0.5 text-[12px] text-text-secondary">{e.description}</p>
                )}
                <div className="mt-1.5 flex items-center gap-3 text-[10.5px] text-text-tertiary">
                  {e.campaign_name && <span>{e.campaign_name}</span>}
                  {e.before_value && e.after_value && (
                    <span>{e.before_value} → {e.after_value}</span>
                  )}
                  {e.after_value && !e.before_value && <span>→ {e.after_value}</span>}
                  <span>{formatDate(e.executed_at)}</span>
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Auditoria tab ────────────────────────────────────────────────────────────

function AuditTab({ audits }: { audits: Audit[] }) {
  if (!audits.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <BarChart2 className="h-8 w-8 text-text-tertiary mb-3" />
        <p className="text-[13px] text-text-secondary">No audits yet</p>
        <p className="text-[12px] text-text-tertiary mt-1">Use MCP to generate periodic performance audits</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {audits.map((a) => (
        <div key={a.id} className="rounded-xl border border-border-subtle bg-bg-secondary px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-text-primary">{a.title}</span>
                <span className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] font-medium',
                  a.status === 'published' ? 'bg-green-400/10 text-green-400' : 'bg-bg-tertiary text-text-tertiary',
                )}>
                  {a.status}
                </span>
              </div>
              <p className="text-[11.5px] text-text-tertiary mt-0.5 capitalize">
                {a.period_from} → {a.period_to} · {a.period_type}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-[13px] font-semibold text-text-primary">
                ${a.revenue_total.toLocaleString()}
              </p>
              <p className="text-[11px] text-text-tertiary">revenue</p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3">
            {[
              { label: 'Spend', value: `$${a.spend_total.toLocaleString()}` },
              { label: 'Leads', value: a.leads_total.toString() },
              { label: 'Opportunities', value: a.opportunities_total.toString() },
            ].map((stat) => (
              <div key={stat.label} className="rounded-lg bg-bg-tertiary px-3 py-2 text-center">
                <p className="text-[11px] text-text-tertiary">{stat.label}</p>
                <p className="text-[13px] font-medium text-text-primary">{stat.value}</p>
              </div>
            ))}
          </div>
          {a.summary && (
            <p className="mt-3 text-[12px] text-text-secondary leading-relaxed border-t border-border-subtle pt-3">
              {a.summary}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AdsJourneyView({
  memories,
  executions,
  plans,
  audits,
}: {
  memories: Memory[]
  executions: Execution[]
  plans: Plan[]
  audits: Audit[]
}) {
  const [activeTab, setActiveTab] = useState('story')
  const [localMemories, setLocalMemories] = useState(memories)

  async function handleApprove(id: string) {
    setLocalMemories((prev) => prev.map((m) => m.id === id ? { ...m, status: 'active' } : m))
    await fetch('/api/ads/memories', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [id], status: 'active' }),
    }).catch(() => {})
  }

  async function handleDismiss(id: string) {
    setLocalMemories((prev) => prev.filter((m) => m.id !== id))
    await fetch('/api/ads/memories', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [id], status: 'archived' }),
    }).catch(() => {})
  }

  const pendingCount = localMemories.filter((m) => m.status === 'needs_review').length

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-4 border-b border-border-subtle px-6 py-3 shrink-0">
        <span className="text-[14px] font-semibold text-text-primary">Ads Journey</span>
        <div className="flex items-center gap-1 rounded-lg bg-bg-tertiary p-1">
          {TABS.map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
                const hasBadge = tab.id === 'story' && pendingCount > 0
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex h-7 items-center gap-1.5 rounded-[6px] px-3 text-[12.5px] font-medium transition-all relative',
                  isActive
                    ? 'bg-bg-primary text-text-primary shadow-sm'
                    : 'text-text-secondary hover:text-text-primary',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
                {hasBadge && (
                  <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-400 text-[9px] font-bold text-white">
                    {pendingCount}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {activeTab === 'story' && (
          <StoryTab
            memories={localMemories}
            onApprove={handleApprove}
            onDismiss={handleDismiss}
          />
        )}
        {activeTab === 'planning' && <PlanningTab plans={plans} />}
        {activeTab === 'execution' && <ExecutionTab executions={executions} />}
        {activeTab === 'audit' && <AuditTab audits={audits} />}
      </div>
    </div>
  )
}
