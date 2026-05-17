import { Users } from 'lucide-react'
import { EmptyState } from './empty-state'

export function EmptyContacts() {
  return (
    <EmptyState
      icon={Users}
      title="No contacts yet"
      description="Contacts are people who message you or you import from a CRM. They'll show up here automatically as conversations begin."
      action={{ label: 'Import contacts', href: '/contacts/import' }}
      secondary={{ label: 'Connect a channel', href: '/integrations' }}
    />
  )
}
