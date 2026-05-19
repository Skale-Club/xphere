'use client'

import { useState, useTransition } from 'react'
import { Building2, Users, Phone, MessageSquare, Contact2, Globe } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { bulkApplyFeatureFlag } from '@/app/(admin)/admin/_actions/get-platform-stats'
import type { PlatformStats } from '@/app/(admin)/admin/_actions/get-platform-stats'

const FEATURE_FLAGS = [
  { key: 'ai_calling_enabled', label: 'AI Calling', description: 'Outbound AI voice campaigns' },
  { key: 'bulk_import_enabled', label: 'Bulk Import', description: 'CSV bulk contact import' },
  { key: 'advanced_pipeline_enabled', label: 'Advanced Pipeline', description: 'Pipeline automation and multi-stage rules' },
] as const

function StatCard({ icon: Icon, label, value, sub }: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number
  sub?: string
}) {
  return (
    <Card className="bg-[#111113] border-[#2A2A2F]">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <Icon className="h-4 w-4 text-[#71717A]" />
          <span className="text-[0.8125rem] text-[#A1A1AA]">{label}</span>
        </div>
        <p className="text-[1.75rem] font-semibold text-[#FAFAFA] tabular-nums leading-none">{value.toLocaleString()}</p>
        {sub && <p className="text-[0.75rem] text-[#71717A] mt-1">{sub}</p>}
      </CardContent>
    </Card>
  )
}

export function PlatformSettingsView({ stats }: { stats: PlatformStats }) {
  const [isPending, startTransition] = useTransition()
  const [applying, setApplying] = useState<string | null>(null)

  function handleBulkApply(flagKey: string, enabled: boolean) {
    setApplying(flagKey)
    startTransition(async () => {
      try {
        const { updated } = await bulkApplyFeatureFlag(flagKey, enabled)
        toast.success(`Applied to ${updated} organization${updated !== 1 ? 's' : ''}`)
      } catch {
        toast.error('Failed to apply. Try again.')
      } finally {
        setApplying(null)
      }
    })
  }

  return (
    <div className="p-6 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-[1.25rem] font-semibold text-[#FAFAFA] tracking-[-0.015em]">Platform Settings</h1>
        <p className="text-[0.8125rem] text-[#A1A1AA] mt-1">Global platform statistics and bulk feature flag controls</p>
      </div>

      {/* Platform stats */}
      <section className="mb-8">
        <p className="text-sm font-semibold text-[#FAFAFA] mb-3">Platform Overview</p>
        <div className="grid grid-cols-3 gap-4">
          <StatCard
            icon={Building2}
            label="Organizations"
            value={stats.total_orgs}
            sub={`${stats.active_orgs} active`}
          />
          <StatCard icon={Users} label="Members" value={stats.total_members} />
          <StatCard icon={Contact2} label="Contacts" value={stats.total_contacts} />
          <StatCard icon={Phone} label="Calls" value={stats.total_calls} />
          <StatCard icon={MessageSquare} label="Conversations" value={stats.total_conversations} />
          <StatCard icon={Globe} label="Active orgs" value={stats.active_orgs} sub={`${stats.total_orgs > 0 ? Math.round((stats.active_orgs / stats.total_orgs) * 100) : 0}% of total`} />
        </div>
      </section>

      <Separator className="bg-[#2A2A2F] mb-8" />

      {/* Bulk feature flags */}
      <section>
        <p className="text-sm font-semibold text-[#FAFAFA] mb-1">Bulk Feature Flag Controls</p>
        <p className="text-[0.8125rem] text-[#A1A1AA] mb-4">Apply a feature flag to all organizations at once. Individual org flags can be overridden on the org detail page.</p>

        <Card className="bg-[#111113] border-[#2A2A2F]">
          <CardHeader className="pb-3 pt-4 px-4">
            <p className="text-sm font-medium text-[#FAFAFA]">Bulk Apply</p>
          </CardHeader>
          <Separator className="bg-[#2A2A2F]" />
          <CardContent className="p-4 space-y-3">
            {FEATURE_FLAGS.map(({ key, label, description }) => (
              <div key={key} className="flex items-center justify-between gap-4 min-h-[48px] py-1">
                <div>
                  <p className="text-sm text-[#FAFAFA]">{label}</p>
                  <p className="text-[0.75rem] text-[#71717A]">{description}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isPending && applying === key}
                    onClick={() => handleBulkApply(key, false)}
                    className="h-8 text-xs border-[#2A2A2F] bg-transparent text-[#A1A1AA] hover:bg-[#1A1A1D] hover:text-[#FAFAFA]"
                  >
                    Disable all
                  </Button>
                  <Button
                    size="sm"
                    disabled={isPending && applying === key}
                    onClick={() => handleBulkApply(key, true)}
                    className="h-8 text-xs bg-red-600 hover:bg-red-700 text-white"
                  >
                    Enable all
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
