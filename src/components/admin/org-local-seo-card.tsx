'use client'

// Platform-admin choice of whose DataForSEO account this org's Local SEO scans
// run on: the platform's (default, counts plan points) or the org's own
// (Integrations → DataForSEO, billed by DataForSEO, no plan points).
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { setOrgRankCredentials, type OrgLocalSeoSettings } from '@/app/(admin)/admin/_actions/local-seo-actions'

export function OrgLocalSeoCard({ orgId, settings }: { orgId: string; settings: OrgLocalSeoSettings }) {
  const [source, setSource] = useState(settings.rankCredentials)
  const [isPending, startTransition] = useTransition()
  const ownBlocked = source === 'own' && !settings.ownAccountConnected

  function apply() {
    startTransition(async () => {
      const res = await setOrgRankCredentials(orgId, source)
      if (res.ok) toast.success('Local SEO account updated')
      else toast.error(res.error)
    })
  }

  return (
    <Card>
      <CardHeader className="pb-3 pt-4 px-4">
        <p className="text-sm font-semibold text-text-primary">Local SEO</p>
      </CardHeader>
      <Separator className="bg-border-subtle" />
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-text-tertiary">Own DataForSEO</span>
          <Badge variant="outline" className="text-xs">
            {settings.ownAccountConnected ? 'Connected' : 'Not connected'}
          </Badge>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="rank-credentials" className="text-xs font-medium text-text-secondary">
            Rank scans run on
          </label>
          <div className="flex gap-2">
            <select
              id="rank-credentials"
              value={source}
              onChange={(e) => setSource(e.target.value === 'own' ? 'own' : 'platform')}
              disabled={isPending}
              className="flex-1 h-9 rounded-md border border-border bg-bg-secondary px-2 text-sm text-text-primary"
            >
              <option value="platform">Platform account (uses plan points)</option>
              <option value="own">Organization&apos;s own DataForSEO</option>
            </select>
            <Button
              size="sm"
              variant="outline"
              disabled={isPending || source === settings.rankCredentials || ownBlocked}
              onClick={apply}
            >
              Apply
            </Button>
          </div>
          <p className="text-xs text-text-tertiary">
            {ownBlocked
              ? 'The organization must add and activate DataForSEO in Integrations first.'
              : 'Own account: scans bill the organization’s DataForSEO directly and do not use plan points.'}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
