import { MessageSquare } from 'lucide-react'
import { EmptyState } from './empty-state'

export function EmptyConversations() {
  return (
    <EmptyState
      icon={MessageSquare}
      title="No conversations yet"
      description="When customers message you across WhatsApp, Instagram, or your web widget, conversations will appear here."
      action={{ label: 'Connect a channel', href: '/integrations' }}
      secondary={{ label: 'Learn more', href: '/integrations' }}
    />
  )
}
