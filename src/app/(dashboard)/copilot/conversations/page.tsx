import Link from 'next/link'
import { MessageSquare } from 'lucide-react'
import { listConversations } from '../_actions/conversations'
import { DeleteConversationButton } from './delete-button'

export const dynamic = 'force-dynamic'

export default async function ConversationsPage() {
  const res = await listConversations()
  if (!res.ok) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-500">Error: {res.error}</p>
      </div>
    )
  }
  const conversations = res.data

  return (
    <div className="mx-auto max-w-none px-4 sm:px-6 lg:px-8 py-8">
      {conversations.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-text-secondary">
          <MessageSquare className="mx-auto mb-2 h-8 w-8 text-text-tertiary" />
          No conversations yet. Open the Copilot (⌘I) and ask anything.
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-bg-secondary">
          {conversations.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-4 py-3">
              <Link
                href={`/copilot/conversations/${c.id}`}
                className="flex-1 min-w-0"
              >
                <div className="truncate text-sm font-medium">{c.title}</div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-text-tertiary">
                  <span>{c.message_count} message{c.message_count === 1 ? '' : 's'}</span>
                  <span>·</span>
                  <span>{new Date(c.updated_at).toLocaleString()}</span>
                </div>
              </Link>
              <DeleteConversationButton id={c.id} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
