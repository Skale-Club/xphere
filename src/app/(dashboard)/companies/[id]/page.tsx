import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import {
  getAccountDetail,
  getAccountOpportunities,
  getAccountActivities,
} from './actions'
import { AccountDetailHeader } from '@/components/accounts/account-detail-header'
import { AccountContactsTab } from '@/components/accounts/account-contacts-tab'
import { AccountOpportunitiesTab } from '@/components/accounts/account-opportunities-tab'
import { AccountActivitiesTab } from '@/components/accounts/account-activities-tab'
import { CustomFieldsDisplay } from '@/components/custom-fields/custom-fields-display'
import { TasksPanel } from '@/components/tasks/tasks-panel'
import { NotesPanel } from '@/components/notes/notes-panel'
import { PageContainer } from '@/components/layout/page-header'
import { EntityDetailTemplate } from '@/components/crm/entity-template'

interface Props {
  params: Promise<{ id: string }>
}

export default async function AccountDetailPage({ params }: Props) {
  const { id } = await params

  const [detailResult, oppsResult, activitiesResult] = await Promise.all([
    getAccountDetail(id),
    getAccountOpportunities(id),
    getAccountActivities(id),
  ])

  if (!detailResult.ok) notFound()
  const { account, contacts } = detailResult.data
  const opportunities = oppsResult.ok ? oppsResult.data : []
  const activities = activitiesResult.ok ? activitiesResult.data : []

  return (
    // EntityDetailTemplate marks this as a shared CRM detail surface so Prospects
    // can build a /prospects/[id] detail using the same primitive.
    <EntityDetailTemplate>
    <PageContainer className="space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href="/accounts">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Companies
        </Link>
      </Button>

      <AccountDetailHeader account={account} />

      <CustomFieldsDisplay
        entity="account"
        customFields={account.custom_fields as Record<string, unknown>}
      />

      <Tabs defaultValue="contacts" className="space-y-4">
        <TabsList>
          <TabsTrigger value="contacts">Contacts ({contacts.length})</TabsTrigger>
          <TabsTrigger value="opportunities">Opportunities ({opportunities.length})</TabsTrigger>
          <TabsTrigger value="activities">Activities ({activities.length})</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>
        <TabsContent value="contacts">
          <AccountContactsTab contacts={contacts} accountId={id} />
        </TabsContent>
        <TabsContent value="opportunities">
          <AccountOpportunitiesTab opportunities={opportunities} accountId={id} contacts={contacts} />
        </TabsContent>
        <TabsContent value="activities">
          <AccountActivitiesTab activities={activities} />
        </TabsContent>
        <TabsContent value="tasks">
          <TasksPanel entityType="account" entityId={id} />
        </TabsContent>
        <TabsContent value="notes">
          <NotesPanel entityType="account" entityId={id} />
        </TabsContent>
      </Tabs>
    </PageContainer>
    </EntityDetailTemplate>
  )
}
