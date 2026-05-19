'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { ArrowLeft, Users, Phone, MessageSquare, Contact2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Separator } from '@/components/ui/separator'
import { updateOrgSettings } from '@/app/(admin)/admin/_actions/get-org-detail'
import type { OrgDetail } from '@/app/(admin)/admin/_actions/get-org-detail'

const FEATURE_FLAGS = [
  {
    key: 'ai_calling_enabled',
    label: 'AI Calling',
    description: 'Enables outbound AI voice campaigns for this org',
  },
  {
    key: 'bulk_import_enabled',
    label: 'Bulk Import',
    description: 'Allows CSV bulk import of contacts',
  },
  {
    key: 'advanced_pipeline_enabled',
    label: 'Advanced Pipeline',
    description: 'Unlocks pipeline automation and multi-stage rules',
  },
] as const

function MetricCard({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number }) {
  return (
    <Card className="bg-[#111113] border-[#2A2A2F]">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <Icon className="h-4 w-4 text-[#71717A]" />
          <span className="text-[0.8125rem] text-[#A1A1AA]">{label}</span>
        </div>
        <p className="text-[1.75rem] font-semibold text-[#FAFAFA] tabular-nums leading-none">{value.toLocaleString()}</p>
      </CardContent>
    </Card>
  )
}

export function OrgDetailView({ org }: { org: OrgDetail }) {
  const [flags, setFlags] = useState<Record<string, boolean>>(() => {
    const s = org.settings
    return {
      ai_calling_enabled: Boolean(s.ai_calling_enabled),
      bulk_import_enabled: Boolean(s.bulk_import_enabled),
      advanced_pipeline_enabled: Boolean(s.advanced_pipeline_enabled),
    }
  })
  const [isPending, startTransition] = useTransition()

  function handleSave() {
    startTransition(async () => {
      try {
        await updateOrgSettings(org.id, { ...org.settings, ...flags })
        toast.success('Preferences saved')
      } catch {
        toast.error('Failed to save preferences. Try again.')
      }
    })
  }

  return (
    <div className="p-6 max-w-7xl">
      {/* Back */}
      <Link href="/admin/orgs" className="inline-flex items-center gap-1.5 text-[#A1A1AA] hover:text-[#FAFAFA] text-sm mb-6 transition-colors duration-100">
        <ArrowLeft className="h-4 w-4" />
        Back to Organizations
      </Link>

      {/* Heading */}
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-[1.25rem] font-semibold text-[#FAFAFA] tracking-[-0.015em]">{org.name}</h1>
        <Badge
          className={org.is_active
            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
            : 'bg-[#2A2A2F] text-[#71717A] border-[#2A2A2F]'
          }
          variant="outline"
        >
          {org.is_active ? 'Active' : 'Inactive'}
        </Badge>
        <span className="text-[#71717A] text-sm font-mono">{org.slug}</span>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Main column */}
        <div className="col-span-2 space-y-6">
          {/* Metric cards */}
          <div className="grid grid-cols-2 gap-4">
            <MetricCard icon={Contact2} label="Contacts" value={org.contacts_count} />
            <MetricCard icon={Phone} label="Calls" value={org.calls_count} />
            <MetricCard icon={MessageSquare} label="Conversations" value={org.conversations_count} />
            <MetricCard icon={Users} label="Members" value={org.members.length} />
          </div>

          {/* Members */}
          <Card className="bg-[#111113] border-[#2A2A2F]">
            <CardHeader className="pb-3 pt-4 px-4">
              <p className="text-sm font-semibold text-[#FAFAFA]">Members</p>
            </CardHeader>
            <Separator className="bg-[#2A2A2F]" />
            <CardContent className="p-0">
              {org.members.length === 0 ? (
                <p className="text-[#A1A1AA] text-sm p-4">No members in this organization.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-[#2A2A2F] hover:bg-transparent">
                      <TableHead className="text-[#71717A] font-medium text-xs pl-4">Email</TableHead>
                      <TableHead className="text-[#71717A] font-medium text-xs">Role</TableHead>
                      <TableHead className="text-[#71717A] font-medium text-xs">Joined</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {org.members.map(member => (
                      <TableRow key={member.id} className="border-[#2A2A2F] hover:bg-[#1A1A1D] transition-colors duration-100">
                        <TableCell className="text-[#FAFAFA] text-sm pl-4">{member.email}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className="text-[0.8125rem] bg-transparent border-[#2A2A2F] text-[#A1A1AA] capitalize"
                          >
                            {member.role}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-[#A1A1AA] text-sm">
                          {new Date(member.joined_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Feature flags sidebar */}
        <div className="col-span-1">
          <Card className="bg-[#111113] border-[#2A2A2F]">
            <CardHeader className="pb-3 pt-4 px-4">
              <p className="text-sm font-semibold text-[#FAFAFA]">Feature Flags</p>
            </CardHeader>
            <Separator className="bg-[#2A2A2F]" />
            <CardContent className="p-4 space-y-1">
              {FEATURE_FLAGS.map(({ key, label, description }) => (
                <div
                  key={key}
                  className="flex items-center justify-between gap-3 min-h-[48px] py-2"
                >
                  <div className="flex-1 min-w-0">
                    <label
                      htmlFor={`flag-${key}`}
                      className="text-sm text-[#FAFAFA] cursor-pointer block"
                    >
                      {label}
                    </label>
                    <p id={`flag-${key}-desc`} className="text-[0.75rem] text-[#71717A] mt-0.5">{description}</p>
                  </div>
                  <Switch
                    id={`flag-${key}`}
                    aria-describedby={`flag-${key}-desc`}
                    checked={flags[key]}
                    onCheckedChange={checked => setFlags(prev => ({ ...prev, [key]: checked }))}
                    className="data-[state=checked]:bg-red-600 shrink-0"
                  />
                </div>
              ))}

              <div className="pt-4">
                <Button
                  onClick={handleSave}
                  disabled={isPending}
                  className="w-full bg-red-600 hover:bg-red-700 text-white"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {isPending ? 'Saving…' : 'Save Feature Flags'}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Org metadata */}
          <Card className="bg-[#111113] border-[#2A2A2F] mt-4">
            <CardContent className="p-4 space-y-2">
              <div>
                <p className="text-[0.75rem] text-[#71717A]">Organization ID</p>
                <p className="text-[0.8125rem] text-[#A1A1AA] font-mono break-all">{org.id}</p>
              </div>
              <div>
                <p className="text-[0.75rem] text-[#71717A]">Created</p>
                <p className="text-[0.8125rem] text-[#A1A1AA]">
                  {new Date(org.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
