'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ShieldCheck, Building2, Settings, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { href: '/admin/orgs', label: 'Organizations', icon: Building2 },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
  { href: '/admin/seo', label: 'SEO', icon: Search },
]

export function AdminSidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-60 shrink-0 bg-[#111113] border-r border-[#2A2A2F] flex flex-col min-h-screen">
      <div className="h-14 flex items-center gap-2 px-4 border-b border-[#2A2A2F]" style={{ background: 'rgba(239, 68, 68, 0.08)' }}>
        <ShieldCheck className="h-5 w-5 text-red-500 shrink-0" />
        <span className="font-semibold text-sm text-[#FAFAFA] tracking-tight">Xphere Admin</span>
      </div>

      <nav className="flex-1 p-3 flex flex-col gap-1">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors duration-100',
                isActive
                  ? 'bg-red-500/10 text-red-400 border-l-2 border-red-500 pl-[10px]'
                  : 'text-[#A1A1AA] hover:bg-[#1A1A1D] hover:text-[#FAFAFA]'
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
