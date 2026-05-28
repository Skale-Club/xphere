import { Tag } from 'lucide-react'

import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { TagsManager } from '@/components/tags/tags-manager'
import { ConversationLabelsSettings } from './conversation-labels-settings'
import { listTags } from './actions'

export default async function TagsSettingsPage() {
  const tags = await listTags()

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Settings"
        eyebrowIcon={Tag}
        title="Tags & labels"
        description="Tags categorize contacts and deals; conversation labels categorize inbox threads. Both support custom colors."
      />
      <TagsManager initialTags={tags} />
      <div className="mt-8">
        <ConversationLabelsSettings />
      </div>
    </PageContainer>
  )
}
