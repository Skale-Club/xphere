// Settings hub | landing page at /settings. Replaces the old redirect to
// /settings/workspace with a categorized index so users can discover what's
// under each sub-route without poking around the URL bar.

import Link from 'next/link'
import {
  BookOpen,
  Boxes,
  Download,
  Mail,
  MapPin,
  MessageSquare,
  Palette,
  Phone,
  PhoneCall,
  Plug,
  Plug2,
  Settings2,
  Tag,
  UserCog,
  type LucideIcon,
} from 'lucide-react'

import { ModalShell } from '@/components/layout/modal-shell'

interface SettingsCardConfig {
  href: string
  icon: LucideIcon
  title: string
  description: string
}

const SECTIONS: Array<{ heading: string; cards: SettingsCardConfig[] }> = [
  {
    heading: 'Account',
    cards: [
      {
        href: '/settings/profile',
        icon: UserCog,
        title: 'Profile',
        description: 'Your personal info, password and avatar.',
      },
    ],
  },
  {
    heading: 'Workspace',
    cards: [
      {
        href: '/settings/workspace',
        icon: Palette,
        title: 'Workspace',
        description:
          'Company identity, tax ID, address, timezone, currency, branding and AI cost cap.',
      },
      {
        href: '/settings/tags',
        icon: Tag,
        title: 'Tags & labels',
        description: 'Tags for contacts and deals, plus conversation labels for the inbox.',
      },
      {
        href: '/settings/custom-fields',
        icon: Settings2,
        title: 'Custom fields',
        description: 'Custom metadata for contacts, companies and opportunities.',
      },
      {
        href: '/settings/locations',
        icon: MapPin,
        title: 'Locations',
        description: 'Physical addresses for bookings.',
      },
      {
        href: '/settings/organization-templates',
        icon: Boxes,
        title: 'Organization templates',
        description:
          'Capture this organization’s structure as a reusable industry template, then create new organizations from it.',
      },
    ],
  },
  {
    heading: 'Communications',
    cards: [
      {
        href: '/settings/phone-numbers',
        icon: Phone,
        title: 'Phone numbers',
        description: 'Configure Twilio numbers, ownership and routing.',
      },
      {
        href: '/settings/calls',
        icon: PhoneCall,
        title: 'Calls',
        description: 'Call routing and behavior.',
      },
      {
        href: '/email-templates',
        icon: Mail,
        title: 'Email templates',
        description: 'Reusable templates for one-off emails and campaigns.',
      },
      {
        href: '/settings/mcp',
        icon: Plug,
        title: 'MCP server',
        description: 'Token and endpoint URL for external AI agents.',
      },
      {
        href: '/widget',
        icon: MessageSquare,
        title: 'Chat widget',
        description: 'Embeddable website chat — branding, welcome message and embed token.',
      },
    ],
  },
  {
    heading: 'Build',
    cards: [
      {
        href: '/integrations',
        icon: Plug2,
        title: 'Integrations',
        description:
          'Connect WhatsApp, Twilio, OpenRouter and other external services.',
      },
      {
        href: '/knowledge',
        icon: BookOpen,
        title: 'Knowledge',
        description:
          'Upload documents and URLs your AI agents can search and quote from.',
      },
    ],
  },
  {
    heading: 'App',
    cards: [
      {
        href: '/settings/install',
        icon: Download,
        title: 'Install app',
        description: 'Add xphere to your home screen or desktop. Required for push notifications on iOS.',
      },
    ],
  },
]

export default function SettingsHubPage() {
  return (
    <ModalShell
      title="Settings"
      description="Workspace, communications and personal preferences."
    >
      <div className="space-y-8">
        {SECTIONS.map((section) => (
          <section key={section.heading} className="space-y-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
              {section.heading}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {section.cards.map((card) => (
                <SettingsCard key={card.href} {...card} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </ModalShell>
  )
}

function SettingsCard({ href, icon: Icon, title, description }: SettingsCardConfig) {
  return (
    <Link
      href={href}
      className="
        group flex items-center gap-3 rounded-lg border border-border-subtle bg-bg-secondary
        px-4 py-3.5 transition-colors
        hover:border-border hover:bg-bg-tertiary/60
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary
      "
    >
      <span className="
        flex h-8 w-8 shrink-0 items-center justify-center rounded-md
        bg-bg-tertiary/70 text-text-secondary
        transition-colors group-hover:bg-accent-muted group-hover:text-accent
      ">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-[13.5px] font-medium text-text-primary">{title}</h3>
        <p className="mt-0.5 text-[12px] leading-snug text-text-tertiary">
          {description}
        </p>
      </div>
    </Link>
  )
}
