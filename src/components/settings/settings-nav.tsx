'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Bell,
  CreditCard,
  KeyRound,
  Mail,
  Palette,
  Plug2,
  ShieldCheck,
  User,
  Users,
} from 'lucide-react'

import { cn } from '@/lib/utils'

interface NavItem {
  href: string
  label: string
  description?: string
  icon: React.ComponentType<{ className?: string }>
  /** When true, hide unless `isPlatformAdmin`. */
  adminOnly?: boolean
  /** When true, mark as disabled / "coming soon". */
  disabled?: boolean
}

const items: NavItem[] = [
  { href: '/settings/company-info', label: 'Company Info', description: 'Logo, accent, brand', icon: Palette },
  { href: '/settings/profile', label: 'Profile', description: 'Your account', icon: User },
  { href: '/integrations', label: 'Integrations', description: 'WhatsApp, Twilio, Vapi', icon: Plug2 },
  { href: '/members', label: 'Team', description: 'Members & invites', icon: Users },
  { href: '/settings/billing', label: 'Billing', description: 'Plans & usage', icon: CreditCard, disabled: true },
  { href: '/settings/notifications', label: 'Notifications', description: 'Email & in-app', icon: Bell, disabled: true },
  { href: '/settings/api-keys', label: 'API Keys', description: 'Developer access', icon: KeyRound },
  { href: '/settings/email', label: 'Email', description: 'Resend integration', icon: Mail },
  { href: '/admin/settings', label: 'Platform', description: 'AI, email, feature flags — super admin only', icon: ShieldCheck, adminOnly: true },
]

interface Props {
  isPlatformAdmin: boolean
}

export function SettingsNav({ isPlatformAdmin }: Props) {
  const pathname = usePathname()

  return (
    <nav className="space-y-1 sticky top-4">
      <div className="px-2 pb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
        Settings
      </div>
      {items
        .filter((i) => !i.adminOnly || isPlatformAdmin)
        .map((item) => {
          const Icon = item.icon
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
          if (item.disabled) {
            return (
              <div
                key={item.href}
                aria-disabled="true"
                className="flex items-center gap-2.5 rounded-[7px] px-2.5 py-1.5 text-[13px] text-text-tertiary/70 cursor-not-allowed"
              >
                <Icon className="h-4 w-4 shrink-0 opacity-60" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{item.label}</span>
                    <span className="text-[10px] font-medium uppercase tracking-wide px-1 py-0.5 rounded-[4px] bg-bg-tertiary text-text-tertiary">
                      Soon
                    </span>
                  </div>
                  {item.description && (
                    <div className="text-[11px] text-text-tertiary/70 truncate">{item.description}</div>
                  )}
                </div>
              </div>
            )
          }
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-2.5 rounded-[7px] px-2.5 py-1.5 text-[13px] motion-fast',
                isActive
                  ? 'bg-accent-muted text-text-primary'
                  : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary',
              )}
            >
              <Icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-accent' : 'text-text-tertiary')} />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{item.label}</div>
                {item.description && (
                  <div className={cn('text-[11px] truncate', isActive ? 'text-text-secondary' : 'text-text-tertiary')}>
                    {item.description}
                  </div>
                )}
              </div>
            </Link>
          )
        })}
    </nav>
  )
}
