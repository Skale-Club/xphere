'use client'

import Link from 'next/link'
import type React from 'react'
import { Building2, CircleDollarSign, Users, UserRound } from 'lucide-react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/pipeline/format'
import { displayContactName } from '@/lib/contacts/names'
import { formatEmailDisplay } from '@/lib/email-addresses/format'
import type { ProjectCrmContext } from '@/app/(dashboard)/projects/actions'

interface Props {
  context: ProjectCrmContext
}

export function ProjectCrmContextPanel({ context }: Props) {
  const hasContext =
    Boolean(context.account) ||
    Boolean(context.opportunity) ||
    Boolean(context.primaryContact) ||
    context.contacts.length > 0 ||
    context.members.length > 0

  if (!hasContext) return null

  const primaryName = context.primaryContact
    ? displayContactName(context.primaryContact)
    : null

  return (
    <section className="mx-4 mt-4 rounded-[8px] border border-border/50 bg-bg-secondary/70 px-4 py-3 sm:mx-6 lg:mx-8">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <ContextItem icon={Building2} label="Company">
          {context.account ? (
            <Link href={`/companies/${context.account.id}`} className="group flex min-w-0 items-center gap-2">
              <Avatar className="h-6 w-6 rounded-[6px]">
                <AvatarImage src={context.account.avatar_url ?? undefined} alt="" />
                <AvatarFallback className="rounded-[6px] text-[10px]">
                  {context.account.name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="truncate text-[13px] font-medium text-text-primary group-hover:text-accent">
                {context.account.name}
              </span>
            </Link>
          ) : (
            <EmptyValue />
          )}
        </ContextItem>

        <ContextItem icon={CircleDollarSign} label="Source deal">
          {context.opportunity ? (
            <Link href={`/pipeline/${context.opportunity.id}`} className="min-w-0 text-[13px] font-medium text-text-primary hover:text-accent">
              <span className="block truncate">{context.opportunity.title}</span>
              <span className="block truncate text-[11px] font-normal text-text-tertiary">
                {formatCurrency(context.opportunity.value, context.opportunity.currency)}
              </span>
            </Link>
          ) : (
            <EmptyValue />
          )}
        </ContextItem>

        <ContextItem icon={UserRound} label="Primary contact">
          {context.primaryContact ? (
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium text-text-primary">{primaryName}</div>
              <div className="truncate text-[11px] text-text-tertiary">
                {formatEmailDisplay(context.primaryContact.email) || context.primaryContact.phone || '-'}
              </div>
            </div>
          ) : (
            <EmptyValue />
          )}
        </ContextItem>
      </div>

      {(context.contacts.length > 0 || context.members.length > 0) && (
        <div className="mt-3 grid gap-3 border-t border-border/40 pt-3 lg:grid-cols-2">
          <PeopleStrip
            icon={Users}
            label="Stakeholders"
            people={context.contacts.map((item) => ({
              id: item.contact_id,
              name: item.contact ? displayContactName(item.contact) : 'Contact',
              detail: item.role,
              primary: item.is_primary,
            }))}
          />
          <PeopleStrip
            icon={Users}
            label="Project team"
            people={context.members.map((item) => ({
              id: item.user_id,
              name: item.profile?.full_name ?? item.profile?.email ?? 'Member',
              detail: item.role,
              primary: item.is_owner,
            }))}
          />
        </div>
      )}
    </section>
  )
}

function ContextItem({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-text-tertiary" />
      <div className="min-w-0">
        <div className="text-[10.5px] font-semibold uppercase tracking-wide text-text-tertiary">{label}</div>
        {children}
      </div>
    </div>
  )
}

function PeopleStrip({
  icon: Icon,
  label,
  people,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  people: Array<{ id: string; name: string; detail: string | null; primary: boolean }>
}) {
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-text-tertiary">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      {people.length === 0 ? (
        <EmptyValue />
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {people.slice(0, 6).map((person) => (
            <span
              key={person.id}
              className={cn(
                'inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-1 text-[11px]',
                person.primary
                  ? 'border-accent/40 bg-accent/10 text-text-primary'
                  : 'border-border/50 bg-bg-tertiary/40 text-text-secondary',
              )}
            >
              <span className="truncate">{person.name}</span>
              {person.detail && <span className="text-text-tertiary">· {person.detail}</span>}
            </span>
          ))}
          {people.length > 6 && (
            <span className="rounded-full border border-border/50 px-2 py-1 text-[11px] text-text-tertiary">
              +{people.length - 6}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function EmptyValue() {
  return <span className="text-[13px] text-text-tertiary">Not linked</span>
}
