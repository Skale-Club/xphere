import { redirect } from 'next/navigation'

import { PageContainer } from '@/components/layout/page-header'
import { ReviewLinkTool } from '@/components/reviews/review-link-tool'
import { sharedInput } from '@/lib/reviews/review-link'
import { getUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// Also the PWA's Web Share Target (see src/app/manifest.ts): sharing a business
// from the Google Maps app to "Xphere" lands here with ?title=&text=&url=.
export default async function ReviewLinkPage({
  searchParams,
}: {
  searchParams: Promise<{ title?: string | string[]; text?: string | string[]; url?: string | string[] }>
}) {
  const user = await getUser()
  if (!user) redirect('/')

  const { title, text, url } = await searchParams
  const initialText = sharedInput([title, text, url])

  return (
    <PageContainer>
      <ReviewLinkTool initialText={initialText} />
    </PageContainer>
  )
}
