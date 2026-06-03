import { redirect } from 'next/navigation'
import { Boxes } from 'lucide-react'

import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { OrganizationTemplatesManager } from '@/components/org-templates/organization-templates-manager'
import { getRbacContext } from '@/lib/rbac/server'
import { listOrgTemplates, listOrgTemplateInstalls } from './actions'

export default async function OrganizationTemplatesPage() {
  const { isPlatformAdmin } = await getRbacContext()
  if (!isPlatformAdmin) redirect('/settings')

  const [templates, installs] = await Promise.all([
    listOrgTemplates(),
    listOrgTemplateInstalls(),
  ])

  return (
    <PageContainer>
      <PageHeader back={{ href: '/settings', label: 'Settings' }} />
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Boxes className="h-5 w-5 text-text-secondary" />
          <h1 className="text-lg font-semibold text-text-primary">Organization templates</h1>
        </div>
        <p className="max-w-2xl text-[13px] leading-relaxed text-text-tertiary">
          Capture this organization&apos;s structure as a reusable industry template, then create
          new organizations from it. Templates copy <strong>structure only</strong> — pipelines,
          custom fields, tags, message templates, and workflow definitions. They never copy
          contacts, conversations, logs, credentials, phone numbers, or connected accounts.
          Imported workflows always arrive as inactive drafts for review.
        </p>
      </div>
      <OrganizationTemplatesManager initialTemplates={templates} initialInstalls={installs} />
    </PageContainer>
  )
}
