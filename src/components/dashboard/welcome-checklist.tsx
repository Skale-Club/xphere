import Link from 'next/link'
import { ArrowRight, Bot, Check, MessageSquare, PhoneCall, Star, Users } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface WelcomeChecklistItem {
  id: string
  title: string
  description: string
  href: string
  cta: string
  icon: React.ComponentType<{ className?: string }>
  done: boolean
}

interface Props {
  items: WelcomeChecklistItem[]
}

/**
 * First-run dashboard for empty workspaces. Shown when an org has no
 * agents, contacts, or active integrations. Each item is a card with
 * a CTA to the relevant area. Once everything is checked the parent
 * page renders the regular dashboard instead.
 */
export function WelcomeChecklist({ items }: Props) {
  const completed = items.filter((i) => i.done).length

  return (
    <div className="space-y-6">
      <div className="rounded-[12px] border border-border bg-gradient-to-br from-accent-muted to-transparent p-6">
        <div className="flex items-start gap-4">
          <div className="hidden sm:flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] bg-accent text-white shadow-glow">
            <Bot className="h-6 w-6" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[20px] font-semibold tracking-tight text-text-primary">
              Let&apos;s get your workspace running
            </h2>
            <p className="mt-1 text-[13px] text-text-secondary">
              A few quick steps to set up your channels, agents, and contacts. You can come back to this checklist anytime.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <div className="h-1.5 w-48 rounded-full bg-bg-tertiary overflow-hidden">
                <div
                  className="h-full bg-accent transition-all duration-500 ease-out"
                  style={{ width: `${Math.round((completed / items.length) * 100)}%` }}
                />
              </div>
              <span className="text-[11.5px] font-medium text-text-secondary">
                {completed} / {items.length}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {items.map((item) => {
          const Icon = item.icon
          return (
            <Card
              key={item.id}
              className={cn(
                'group relative transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-elevation-md',
                item.done && 'opacity-70',
              )}
            >
              <CardContent className="p-4 flex items-start gap-3">
                <div
                  className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] ring-1',
                    item.done
                      ? 'bg-success-muted text-success ring-success/20'
                      : 'bg-bg-tertiary text-text-secondary ring-border-subtle',
                  )}
                >
                  {item.done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn('text-[13.5px] font-medium', item.done ? 'text-text-secondary line-through' : 'text-text-primary')}>
                      {item.title}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[12.5px] text-text-tertiary leading-relaxed">{item.description}</p>
                  {!item.done && (
                    <Button asChild size="sm" variant="ghost" className="mt-2 -ml-2 h-7 text-[12px]">
                      <Link href={item.href}>
                        {item.cta} <ArrowRight className="h-3 w-3" />
                      </Link>
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

export const checklistIcons = { MessageSquare, PhoneCall, Bot, Users, Star }
