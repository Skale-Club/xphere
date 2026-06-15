import { notFound } from 'next/navigation'
import { ChevronLeft, Phone } from 'lucide-react'
import Link from 'next/link'

import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { createClient, getUser } from '@/lib/supabase/server'
import { listOrgMembersForSelect } from '@/app/(dashboard)/integrations/twilio/numbers-actions'
import { PhoneNumberEditor } from '@/components/phone-numbers/phone-number-editor'
import type { Database } from '@/types/database'

type Row = Database['public']['Tables']['twilio_phone_numbers']['Row']

interface Props {
  params: Promise<{ id: string }>
}

export default async function CallsPhoneNumberDetailPage({ params }: Props) {
  const { id } = await params
  const user = await getUser()
  if (!user) notFound()
  const supabase = await createClient()

  const { data: number } = await supabase
    .from('twilio_phone_numbers')
    .select('*')
    .eq('id', id)
    .maybeSingle<Row>()

  if (!number) notFound()

  const members = await listOrgMembersForSelect()

  return (
    <div className="pt-2 pb-8">
      <div className="mb-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/calls/phone-numbers">
            <ChevronLeft className="mr-1 h-4 w-4" />
            All phone numbers
          </Link>
        </Button>
      </div>
      <PageHeader
        eyebrow="Phone Number"
        eyebrowIcon={Phone}
        title={number.inbox_label?.trim() || number.friendly_name || number.e164}
        description={`${number.e164}${number.business_purpose ? ` · ${number.business_purpose}` : ''}`}
      />
      <PhoneNumberEditor number={number} members={members} />
    </div>
  )
}
