import { redirect } from 'next/navigation'
import { SlidersHorizontal } from 'lucide-react'
import Link from 'next/link'

import { createClient, getUser } from '@/lib/supabase/server'
import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CustomFieldsClient } from '@/components/settings/custom-fields/custom-fields-client'
import { getDefinitions } from './actions'
import type { CustomFieldEntity } from '@/types/database'

const ENTITIES: { value: CustomFieldEntity; label: string }[] = [
  { value: 'contact', label: 'Contacts' },
  { value: 'opportunity', label: 'Opportunities' },
  { value: 'account', label: 'Companies' },
]

interface CustomFieldsSettingsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function CustomFieldsSettingsPage({ searchParams }: CustomFieldsSettingsPageProps) {
  const user = await getUser()
  if (!user) redirect('/')

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) redirect('/organizations')

  const sp = await searchParams
  const rawEntity = typeof sp.entity === 'string' ? sp.entity : 'contact'
  const activeEntity: CustomFieldEntity = ENTITIES.some((e) => e.value === rawEntity)
    ? (rawEntity as CustomFieldEntity)
    : 'contact'

  const result = await getDefinitions({ entity: activeEntity })
  const definitions = result.ok ? result.data : []

  return (
    <PageContainer size="wide">
      <PageHeader
        eyebrow="Settings"
        eyebrowIcon={SlidersHorizontal}
        title="Custom Fields"
        description="Define structured metadata fields for Contacts, Opportunities, and Companies."
      />

      <Tabs value={activeEntity}>
        <TabsList>
          {ENTITIES.map((e) => (
            <TabsTrigger key={e.value} value={e.value} asChild>
              <Link href={`/settings/custom-fields?entity=${e.value}`}>{e.label}</Link>
            </TabsTrigger>
          ))}
        </TabsList>

        {ENTITIES.map((e) => (
          <TabsContent key={e.value} value={e.value} className="mt-6">
            {e.value === activeEntity && (
              <CustomFieldsClient definitions={definitions} entity={activeEntity} />
            )}
          </TabsContent>
        ))}
      </Tabs>
    </PageContainer>
  )
}
