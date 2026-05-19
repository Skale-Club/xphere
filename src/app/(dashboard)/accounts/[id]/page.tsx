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
    <div className="mx-auto w-full max-w-none px-4 sm:px-6 lg:px-8 py-8 space-y-6">
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
      </Tabs>
    </div>
  )
}
