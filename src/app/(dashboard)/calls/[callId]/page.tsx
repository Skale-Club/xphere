import { notFound } from 'next/navigation'
import { Phone } from 'lucide-react'

import { createClient } from '@/lib/supabase/server'
import { buildTimeline } from '@/lib/calls/timeline'
import { CallDetailHeader } from '@/components/calls/call-detail-header'
import { CallTranscript } from '@/components/calls/call-transcript'
import { PageContainer, PageHeader } from '@/components/layout/page-header'
import type { ArtifactMessage } from '@/types/vapi'

export default async function CallDetailPage({
  params,
}: {
  params: Promise<{ callId: string }>
}) {
  const { callId } = await params
  const supabase = await createClient()

  const { data: call, error } = await supabase
    .from('calls')
    .select('*')
    .eq('id', callId)
    .single()

  if (error || !call) notFound()

  const { data: actionLogs } = await supabase
    .from('action_logs')
    .select('*')
    .eq('vapi_call_id', call.vapi_call_id)
    .order('created_at', { ascending: true })

  const turns = call.started_at
    ? buildTimeline(
        (call.transcript_turns as ArtifactMessage[]) ?? [],
        actionLogs ?? [],
        call.started_at
      )
    : []

  return (
    <PageContainer size="narrow">
      <PageHeader
        eyebrow="Call detail"
        eyebrowIcon={Phone}
        title="Call detail"
        description="Transcript, action logs, and metadata for this call."
        back={{ href: '/phone?tab=calls', label: 'Back to calls' }}
      />
      <CallDetailHeader call={call} />
      <CallTranscript timeline={turns} />
    </PageContainer>
  )
}
