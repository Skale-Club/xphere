import {
  Zap,
  Plug2,
  Phone,
  BookOpen,
  MessageSquare,
  Megaphone,
  Star,
  LayoutDashboard,
  Bot,
  TrendingUp,
  Contact,
  Building2,
  CalendarDays,
  CheckSquare,
  FolderKanban,
  BarChart3,
  Mail,
} from 'lucide-react'

export type NavItem = {
  icon: React.ComponentType<{ className?: string }>
  label: string
  href: string
  group: string
}

/** Single source of truth for top-level nav. Sidebar + breadcrumb both consume this. */
export const NAV_ITEMS: NavItem[] = [
  { icon: LayoutDashboard, label: 'Dashboard',    href: '/dashboard',    group: 'overview' },
  { icon: MessageSquare,   label: 'Chat',         href: '/chat',         group: 'engage' },
  { icon: Phone,           label: 'Calls',        href: '/calls',        group: 'engage' },
  { icon: Megaphone,       label: 'Campaigns',    href: '/campaigns',    group: 'engage' },
  { icon: Mail,            label: 'Email Templates', href: '/email-templates', group: 'engage' },
  { icon: BarChart3,       label: 'Traffic',      href: '/traffic',      group: 'manage' },
  { icon: Contact,         label: 'Contacts',     href: '/contacts',     group: 'sales' },
  { icon: Building2,       label: 'Companies',    href: '/companies',    group: 'sales' },
  { icon: TrendingUp,      label: 'Pipeline',     href: '/pipeline',     group: 'sales' },
  { icon: CheckSquare,     label: 'Tasks',        href: '/tasks',        group: 'sales' },
  { icon: Bot,             label: 'Agents',       href: '/agents',       group: 'build' },
  { icon: Zap,             label: 'Workflows',    href: '/workflows',    group: 'build' },
  { icon: FolderKanban,   label: 'Projects',     href: '/projects',     group: 'build' },
  { icon: CalendarDays,    label: 'Scheduling',   href: '/scheduling',   group: 'build' },
  { icon: BookOpen,        label: 'Knowledge',    href: '/knowledge',    group: 'build' },
  { icon: Plug2,           label: 'Integrations', href: '/integrations', group: 'manage' },
  { icon: Star,            label: 'Reviews',      href: '/reviews',      group: 'manage' },
]

export const NAV_GROUPS: { id: string; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'engage',   label: 'Engage' },
  { id: 'sales',    label: 'Sales' },
  { id: 'build',    label: 'Build' },
  { id: 'manage',   label: 'Manage' },
]

/** Match the leading path segment of `pathname` to a nav item. */
export function findNavItemForPath(pathname: string): NavItem | null {
  const first = '/' + pathname.split('/').filter(Boolean)[0]
  return NAV_ITEMS.find((n) => n.href === first) ?? null
}
