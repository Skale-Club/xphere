'use client'

import { useState, useTransition, useMemo } from 'react'
import Link from 'next/link'
import { ArrowLeft, Users, Phone, MessageSquare, Contact2 } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Separator } from '@/components/ui/separator'
import { AdminSaveBar } from '@/components/admin/admin-save-bar'
import { updateOrgSettings } from '@/app/(admin)/admin/_actions/get-org-detail'
import { formatEmailDisplay } from '@/lib/email-addresses/format'
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
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <Icon className="h-4 w-4 text-text-tertiary" />
          <span className="text-sm text-text-secondary">{label}</span>
        </div>
        <p className="text-[1.75rem] font-semibold text-text-primary tabular-nums leading-none">{value.toLocaleString()}</p>
      </CardContent>
    </Card>
  )
}

const initFlags = (s: Record<string, unknown>) => ({
  ai_calling_enabled: Boolean(s.ai_calling_enabled),
  bulk_import_enabled: Boolean(s.bulk_import_enabled),
  advanced_pipeline_enabled: Boolean(s.advanced_pipeline_enabled),
})

export function OrgDetailView({ org }: { org: OrgDetail }) {
  const [savedFlags, setSavedFlags] = useState(() => initFlags(org.settings))
  const [flags, setFlags] = useState(() => initFlags(org.settings))
  const [isPending, startTransition] = useTransition()

  const isDirty = useMemo(
    () => JSON.stringify(flags) !== JSON.stringify(savedFlags),
    [flags, savedFlags],
  )

  function handleSave() {
    startTransition(async () => {
      try {
        await updateOrgSettings(org.id, { ...org.settings, ...flags })
        setSavedFlags({ ...flags })
        toast.success('Preferences saved')
      } catch {
        toast.error('Failed to save preferences. Try again.')
      }
    })
  }

  return (
    <div className="p-4 sm:p-6">
      <Link href="/admin/orgs" className="inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary text-sm mb-6 transition-colors duration-100">
        <ArrowLeft className="h-4 w-4" />
        Back to Organizations
      </Link>

      <div className="flex flex-wrap items-center gap-2 mb-6">
        <h1 className="text-xl font-semibold text-text-primary">{org.name}</h1>
        <Badge
          className={org.is_active
            ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
            : 'bg-bg-tertiary text-text-tertiary border-border'
          }
          variant="outline"
        >
          {org.is_active ? 'Active' : 'Inactive'}
        </Badge>
        <span className="text-text-tertiary text-sm font-mono truncate">{org.slug}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <MetricCard icon={Contact2} label="Contacts" value={org.contacts_count} />
            <MetricCard icon={Phone} label="Calls" value={org.calls_count} />
            <MetricCard icon={MessageSquare} label="Conversations" value={org.conversations_count} />
            <MetricCard icon={Users} label="Members" value={org.members.length} />
          </div>

          <Card>
            <CardHeader className="pb-3 pt-4 px-4">
              <p className="text-sm font-semibold text-text-primary">Members</p>
            </CardHeader>
            <Separator className="bg-border-subtle" />
            <CardContent className="p-0 overflow-x-auto">
              {org.members.length === 0 ? (
                <p className="text-text-secondary text-sm p-4">No members in this organization.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-border-subtle hover:bg-transparent">
                      <TableHead className="text-text-tertiary font-medium text-xs pl-4">Email</TableHead>
                      <TableHead className="text-text-tertiary font-medium text-xs">Role</TableHead>
                      <TableHead className="text-text-tertiary font-medium text-xs">Joined</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {org.members.map(member => (
                      <TableRow key={member.id} className="border-border-subtle hover:bg-bg-tertiary transition-colors duration-100">
                        <TableCell className="text-text-primary text-sm pl-4">{formatEmailDisplay(member.email)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs capitalize">
                            {member.role}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-text-secondary text-sm">
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

        <div className="lg:col-span-1 space-y-4">
          <Card>
            <CardHeader className="pb-3 pt-4 px-4">
              <p className="text-sm font-semibold text-text-primary">Feature Flags</p>
            </CardHeader>
            <Separator className="bg-border-subtle" />
            <CardContent className="p-4 space-y-1">
              {FEATURE_FLAGS.map(({ key, label, description }) => (
                <div key={key} className="flex items-center justify-between gap-3 min-h-[48px] py-2">
                  <div className="flex-1 min-w-0">
                    <label htmlFor={`flag-${key}`} className="text-sm text-text-primary cursor-pointer block">
                      {label}
                    </label>
                    <p id={`flag-${key}-desc`} className="text-xs text-text-tertiary mt-0.5">{description}</p>
                  </div>
                  <Switch
                    id={`flag-${key}`}
                    aria-describedby={`flag-${key}-desc`}
                    checked={flags[key]}
                    onCheckedChange={checked => setFlags(prev => ({ ...prev, [key]: checked }))}
                    className="data-[state=checked]:bg-primary shrink-0"
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 space-y-2">
              <div>
                <p className="text-xs text-text-tertiary">Organization ID</p>
                <p className="text-sm text-text-secondary font-mono break-all">{org.id}</p>
              </div>
              <div>
                <p className="text-xs text-text-tertiary">Created</p>
                <p className="text-sm text-text-secondary">
                  {new Date(org.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <AdminSaveBar isDirty={isDirty} isPending={isPending} onSave={handleSave} label="Save feature flags" />
    </div>
  )
}
