import Link from 'next/link'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { initialsOf, relativeTime } from '@/lib/pipeline/format'
import { displayContactName } from '@/lib/contacts/names'
import { formatPhoneDisplay } from '@/lib/phone-numbers/format'
import { formatEmailDisplay } from '@/lib/email-addresses/format'

interface ContactItem {
  id: string
  first_name?: string | null
  last_name?: string | null
  name: string | null
  phone: string | null
  email: string | null
  company: string | null
  created_at: string
}

interface Props {
  contacts: ContactItem[]
  accountId: string
}

export function AccountContactsTab({ contacts, accountId }: Props) {
  return (
    <div>
      {/* Tab header with Add contact action */}
      <div className="flex items-center justify-between pb-4">
        <p className="text-[13px] text-text-secondary">
          {contacts.length === 0
            ? 'No contacts linked yet'
            : `${contacts.length} contact${contacts.length === 1 ? '' : 's'}`}
        </p>
        <Button asChild variant="secondary" size="sm">
          <Link href={`/contacts/new?account_id=${accountId}&from=/accounts/${accountId}`}>
            Add contact
          </Link>
        </Button>
      </div>

      {contacts.length === 0 ? (
        /* Empty state */
        <div className="rounded-[10px] border border-border-subtle bg-bg-primary py-12 text-center">
          <p className="text-[14px] font-medium text-text-secondary">
            No contacts linked to this company yet.
          </p>
          <p className="mt-1 text-[13px] text-text-tertiary">
            Link an existing contact or add a new one above.
          </p>
        </div>
      ) : (
        /* Contacts list */
        <div className="divide-y divide-border-subtle rounded-[10px] border border-border-subtle bg-bg-primary overflow-hidden">
          {contacts.map((contact) => (
            <Link
              key={contact.id}
              href={`/contacts?id=${contact.id}`}
              className="flex items-center gap-3 px-4 py-3 hover:bg-bg-secondary transition-colors"
            >
              <Avatar className="h-8 w-8 shrink-0">
                <AvatarFallback className="text-[11px] font-semibold bg-accent-muted text-accent">
                  {initialsOf(displayContactName(contact, ''))}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-text-primary truncate">
                  {displayContactName(contact, 'Unnamed')}
                </p>
                <p className="text-[12px] text-text-tertiary truncate">
                  {[contact.phone ? formatPhoneDisplay(contact.phone) : null, formatEmailDisplay(contact.email) || null]
                    .filter(Boolean)
                    .join(' · ') || 'No contact info'}
                </p>
              </div>
              <span className="shrink-0 text-[11px] text-text-tertiary">
                {relativeTime(contact.created_at)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
