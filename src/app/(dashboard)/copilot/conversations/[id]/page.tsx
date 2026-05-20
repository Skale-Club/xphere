import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { getConversation } from '../../_actions/conversations'
import { ReplayedMessages } from './replayed-messages'

export const dynamic = 'force-dynamic'

export default async function ConversationDetailPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const res = await getConversation(id)
  if (!res.ok) {
    if (res.error === 'not_found') notFound()
    return (
      <div className="p-6">
        <p className="text-sm text-red-500">Error: {res.error}</p>
      </div>
    )
  }
  const c = res.data

  return (
    <div className="mx-auto max-w-none px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-4">
        <Link
          href="/copilot/conversations"
          className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary"
        >
          <ChevronLeft className="h-3 w-3" /> Conversations
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{c.title}</h1>
        <p className="mt-0.5 text-xs text-text-tertiary">
          {c.messages.length} message{c.messages.length === 1 ? '' : 's'}
          {' · started '}
          {new Date(c.started_at).toLocaleString()}
        </p>
      </div>

      <ReplayedMessages
        conversationId={c.id}
        messages={c.messages}
      />
    </div>
  )
}
