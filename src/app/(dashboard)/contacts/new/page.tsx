import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { NewContactPageForm } from '@/components/contacts/new-contact-page-form'

export const dynamic = 'force-dynamic'

interface NewContactPageProps {
  searchParams: Promise<{
    name?: string
    phone?: string
    email?: string
    company?: string
    from?: string // optional return URL after creation
    account_id?: string // pre-link contact to a company (D-07)
  }>
}

export default async function NewContactPage({ searchParams }: NewContactPageProps) {
  const params = await searchParams
  const returnTo = params.from && params.from.startsWith('/') ? params.from : null
  const accountId =
    params.account_id && params.account_id.length > 0 ? params.account_id : undefined

  return (
    <PageContainer size="narrow">
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2 text-text-tertiary">
        <Link href={returnTo ?? '/contacts'}>
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
      </Button>

      <PageHeader
        eyebrow="Contacts"
        title="New contact"
        description="Add a person to Xphere. You can edit them anytime."
      />

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Contact details</CardTitle>
          <CardDescription>
            We&apos;ll automatically link this contact to any existing conversation that matches the phone or email.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NewContactPageForm
            defaultValues={{
              name: params.name ?? '',
              phone: params.phone ?? '',
              email: params.email ?? '',
              company: params.company ?? '',
              account_id: accountId ?? null,
            }}
            returnTo={returnTo}
          />
        </CardContent>
      </Card>
    </PageContainer>
  )
}
