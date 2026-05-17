'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Command } from 'cmdk'
import {
  LayoutDashboard,
  Phone,
  Bot,
  MessageSquare,
  Zap,
  BookOpen,
  Plug2,
  Users,
  Star,
  Settings,
  Building2,
  HelpCircle,
  Moon,
  Sun,
  Search,
} from 'lucide-react'
import { useTheme } from 'next-themes'

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

interface CommandPaletteContextValue {
  open: boolean
  setOpen: (v: boolean) => void
}

const CommandPaletteContext = React.createContext<CommandPaletteContextValue | null>(null)

export function useCommandPalette() {
  const ctx = React.useContext(CommandPaletteContext)
  if (!ctx) throw new Error('useCommandPalette must be used within CommandPaletteProvider')
  return ctx
}

type CmdItem = {
  id: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  href?: string
  action?: () => void
  kbd?: string
  group: 'Navigation' | 'Actions' | 'Settings' | 'Help'
  keywords?: string[]
}

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  const router = useRouter()
  const { theme, setTheme } = useTheme()

  // Cmd/Ctrl+K shortcut
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const navigate = React.useCallback(
    (href: string) => {
      setOpen(false)
      router.push(href)
    },
    [router]
  )

  const items: CmdItem[] = React.useMemo(
    () => [
      // Navigation
      { id: 'nav-dashboard',    label: 'Dashboard',    icon: LayoutDashboard, href: '/',             group: 'Navigation', kbd: 'G D' },
      { id: 'nav-chat',         label: 'Chat',         icon: MessageSquare,   href: '/chat',         group: 'Navigation', kbd: 'G C' },
      { id: 'nav-phone',        label: 'Phone',        icon: Phone,           href: '/phone',        group: 'Navigation', kbd: 'G P' },
      { id: 'nav-agents',       label: 'Agents',       icon: Bot,             href: '/agents',       group: 'Navigation', kbd: 'G A', keywords: ['ai', 'assistant'] },
      { id: 'nav-tools',        label: 'Tools',        icon: Zap,             href: '/tools',        group: 'Navigation', keywords: ['actions'] },
      { id: 'nav-knowledge',    label: 'Knowledge',    icon: BookOpen,        href: '/knowledge',    group: 'Navigation', keywords: ['rag', 'documents'] },
      { id: 'nav-integrations', label: 'Integrations', icon: Plug2,           href: '/integrations', group: 'Navigation' },
      { id: 'nav-members',      label: 'Members',      icon: Users,           href: '/members',      group: 'Navigation', keywords: ['team'] },
      { id: 'nav-reviews',      label: 'Reviews',      icon: Star,            href: '/reviews',      group: 'Navigation' },

      // Actions
      { id: 'act-new-org',  label: 'New Organization', icon: Building2, href: '/organizations',     group: 'Actions' },

      // Settings
      { id: 'set-settings', label: 'Settings',         icon: Settings, href: '/settings',           group: 'Settings' },
      { id: 'set-orgs',     label: 'Manage Organizations', icon: Building2, href: '/organizations', group: 'Settings' },
      {
        id: 'set-theme-dark',
        label: 'Switch to Dark theme',
        icon: Moon,
        action: () => setTheme('dark'),
        group: 'Settings',
        keywords: ['mode'],
      },
      {
        id: 'set-theme-light',
        label: 'Switch to Light theme',
        icon: Sun,
        action: () => setTheme('light'),
        group: 'Settings',
        keywords: ['mode'],
      },

      // Help
      { id: 'help-docs', label: 'Documentation', icon: HelpCircle, action: () => window.open('https://operator.skale.club', '_blank'), group: 'Help' },
    ],
    [setTheme]
  )

  const grouped = React.useMemo(() => {
    const out: Record<string, CmdItem[]> = {}
    for (const i of items) {
      out[i.group] ||= []
      out[i.group].push(i)
    }
    return out
  }, [items])

  return (
    <CommandPaletteContext.Provider value={{ open, setOpen }}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="overflow-hidden p-0 sm:max-w-[560px] gap-0"
          aria-describedby={undefined}
        >
          <DialogTitle className="sr-only">Command palette</DialogTitle>
          <Command
            label="Command palette"
            // Force narrow filter behaviour with keywords matching
            filter={(value, search, keywords) => {
              const haystack = (value + ' ' + (keywords ?? []).join(' ')).toLowerCase()
              const needle = search.toLowerCase().trim()
              if (!needle) return 1
              // Simple fuzzy — every char of needle must appear in order
              let i = 0
              for (const c of haystack) {
                if (c === needle[i]) i++
                if (i >= needle.length) return 1
              }
              return haystack.includes(needle) ? 0.5 : 0
            }}
          >
            <div className="flex items-center gap-3 border-b border-border-subtle px-4 py-3.5">
              <Search className="h-4 w-4 shrink-0 text-text-tertiary" />
              <Command.Input
                autoFocus
                placeholder="Type a command or search…"
                className="flex-1 bg-transparent text-[14px] text-text-primary placeholder:text-text-tertiary outline-none"
              />
              <kbd className="font-mono text-[10.5px] tracking-wider text-text-tertiary border border-border-subtle rounded-[4px] px-1.5 py-0.5 bg-bg-tertiary">
                ESC
              </kbd>
            </div>
            <Command.List className="py-2">
              <Command.Empty>No results found.</Command.Empty>
              {Object.entries(grouped).map(([group, gItems]) => (
                <Command.Group key={group} heading={group}>
                  {gItems.map((item) => {
                    const Icon = item.icon
                    return (
                      <Command.Item
                        key={item.id}
                        value={item.label}
                        keywords={item.keywords}
                        onSelect={() => {
                          if (item.href) navigate(item.href)
                          else if (item.action) {
                            item.action()
                            setOpen(false)
                          }
                        }}
                      >
                        <Icon className="h-[15px] w-[15px] shrink-0 text-text-tertiary" />
                        <span className="flex-1">{item.label}</span>
                        {item.kbd && <kbd>{item.kbd}</kbd>}
                      </Command.Item>
                    )
                  })}
                </Command.Group>
              ))}
            </Command.List>
            <div className="flex items-center justify-between border-t border-border-subtle px-4 py-2 text-[11px] text-text-tertiary">
              <span className="font-mono tracking-wide">
                {theme === 'dark' ? 'DARK' : 'LIGHT'} · Operator v2.1
              </span>
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <kbd className="font-mono text-[10px] border border-border-subtle rounded-[4px] px-1 py-0.5 bg-bg-tertiary">↵</kbd>
                  open
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="font-mono text-[10px] border border-border-subtle rounded-[4px] px-1 py-0.5 bg-bg-tertiary">↑↓</kbd>
                  navigate
                </span>
              </div>
            </div>
          </Command>
        </DialogContent>
      </Dialog>
    </CommandPaletteContext.Provider>
  )
}
