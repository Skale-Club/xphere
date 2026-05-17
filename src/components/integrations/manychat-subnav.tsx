import Link from 'next/link'
import { cn } from '@/lib/utils'

type Tab = 'settings' | 'rules' | 'events'

const TABS: { id: Tab; label: string; href: string }[] = [
  { id: 'settings', label: 'Settings', href: '/integrations/manychat' },
  { id: 'rules',    label: 'Rules',    href: '/integrations/manychat/rules' },
  { id: 'events',   label: 'Events',   href: '/integrations/manychat/events' },
]

export function ManychatSubnav({ active }: { active: Tab }) {
  return (
    <nav className="-mb-px flex gap-1 overflow-x-auto border-b border-border">
      {TABS.map((tab) => {
        const isActive = tab.id === active
        return (
          <Link
            key={tab.id}
            href={tab.href}
            className={cn(
              'relative inline-flex items-center px-3 py-2 text-[13px] font-medium transition-colors',
              isActive
                ? 'text-text-primary'
                : 'text-text-tertiary hover:text-text-secondary',
            )}
          >
            {tab.label}
            {isActive && (
              <span
                aria-hidden
                className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent"
              />
            )}
          </Link>
        )
      })}
    </nav>
  )
}
