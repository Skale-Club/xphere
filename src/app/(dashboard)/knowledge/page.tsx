import { redirect } from 'next/navigation'
import { BookOpen } from 'lucide-react'

import { getUser } from '@/lib/supabase/server'
import { getKnowledgeSources, hasOpenAiIntegration } from '@/actions/knowledge'
import { DocumentList } from '@/components/knowledge/document-list'
import { UploadForm } from '@/components/knowledge/upload-form'
import { OpenAiBanner } from '@/components/knowledge/openai-banner'
import { PageContainer, PageHeader } from '@/components/layout/page-header'

export default async function KnowledgePage() {
  const user = await getUser()
  if (!user) redirect('/login')

  const [sources, hasOpenAi] = await Promise.all([
    getKnowledgeSources(),
    hasOpenAiIntegration(),
  ])

  const fileCount = sources.filter((s) => s.source_type !== 'url').length
  const urlCount = sources.filter((s) => s.source_type === 'url').length

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Retrieval"
        eyebrowIcon={BookOpen}
        title="Knowledge"
        description="Upload documents and add URLs to answer knowledge queries during live calls and chats."
      />
      {!hasOpenAi && <OpenAiBanner />}
      <div className="space-y-6">
        <UploadForm
          disabled={!hasOpenAi}
          fileCount={fileCount}
          urlCount={urlCount}
        />
        <DocumentList sources={sources} />
      </div>
    </PageContainer>
  )
}
