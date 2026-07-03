'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  BookOpen,
  Bot,
  CreditCard,
  Download,
  KeyRound,
  Mail,
  MapPin,
  MessageCircle,
  MessageSquare,
  MessagesSquare,
  Plug,
  Plug2,
  Settings2,
  Tag,
  UserCog,
  UsersRound,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSubSidebar } from '@/components/layout/sub-sidebar'

interface NavItem {
  href: string
  label: string
  icon: LucideIcon
}

interface NavSection {
  heading: string
  items: NavItem[]
}

const SECTIONS: NavSection[] = [
  {
    heading: 'Account',
    items: [{ href: '/settings/profile', label: 'Profile', icon: UserCog }],
  },
  {
    heading: 'Workspace',
    items: [
      { href: '/settings/company-info', label: 'Company Info', icon: Settings2 },
      { href: '/settings/tags', label: 'Tags & Labels', icon: Tag },
      { href: '/settings/custom-fields', label: 'Custom Fields', icon: Settings2 },
      { href: '/settings/locations', label: 'Locations', icon: MapPin },
      { href: '/settings/members', label: 'Members', icon: UsersRound },
      { href: '/settings/copilot', label: 'Copilot', icon: Bot },
    ],
  },
  {
    heading: 'Templates',
    items: [
      { href: '/settings/email-templates', label: 'Email', icon: Mail },
      { href: '/settings/message-templates', label: 'Messages', icon: MessagesSquare },
      { href: '/settings/whatsapp-templates', label: 'WhatsApp', icon: MessageCircle },
    ],
  },
  {
    heading: 'Build',
    items: [
      { href: '/settings/knowledge', label: 'Knowledge', icon: BookOpen },
      { href: '/settings/widget', label: 'Chat Widget', icon: MessageSquare },
    ],
  },
  {
    heading: 'App',
    items: [{ href: '/settings/install', label: 'Install App', icon: Download }],
  },
  {
    heading: 'Developer',
    items: [
      { href: '/settings/integrations', label: 'Integrations', icon: Plug2 },
      { href: '/settings/mcp', label: 'MCP Server', icon: Plug },
      { href: '/settings/api-keys', label: 'API Keys', icon: KeyRound },
    ],
  },
  {
    heading: 'Billing',
    items: [{ href: '/settings/billing', label: 'Billing', icon: CreditCard }],
  },
]

export function SettingsSubNav() {
  const pathname = usePathname()
  const { onNavigate } = useSubSidebar()

  return (
    <nav className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 py-3">
      {SECTIONS.map((section) => (
        <div key={section.heading}>
          <div className="mb-1 px-2 text-[10.5px] font-semibold uppercase tracking-wider text-text-tertiary">
            {section.heading}
          </div>
          <div className="flex flex-col gap-px">
            {section.items.map((item) => {
              const Icon = item.icon
              const isActive =
                pathname === item.href || pathname.startsWith(item.href + '/')
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  className={cn(
                    'group relative flex items-center gap-2.5 rounded-[7px] px-2.5 py-1.5 text-[12.5px] transition-colors',
                    isActive
                      ? 'bg-accent/10 text-text-primary'
                      : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary',
                  )}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 h-[60%] w-[2.5px] rounded-r-full bg-accent" />
                  )}
                  <Icon
                    className={cn(
                      'h-3.5 w-3.5 shrink-0',
                      isActive ? 'text-accent' : 'text-text-tertiary',
                    )}
                  />
                  <span className="truncate font-medium">{item.label}</span>
                </Link>
              )
            })}
          </div>
        </div>
      ))}
    </nav>
  )
}
