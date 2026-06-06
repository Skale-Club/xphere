import {
  Zap,
  Phone,
  MessageSquare,
  Megaphone,
  Star,
  LayoutDashboard,
  Bot,
  TrendingUp,
  Contact,
  UserPlus,
  Building2,
  CalendarDays,
  CheckSquare,
  FolderKanban,
  BarChart3,
  MonitorPlay,
} from 'lucide-react'

export type NavItem = {
  icon: React.ComponentType<{ className?: string }>
  label: string
  href: string
  group: string
  /** When true, only shown to PLATFORM_ADMIN users. */
  adminOnly?: boolean
  /** When true, only shown to org owners/admins or platform admins. */
  orgAdminOnly?: boolean
  /**
   * RBAC permission key gating this item. When set, the item is hidden unless
   * the user holds the key (or is unrestricted — Owner / platform / unconfigured
   * org). Omit for always-visible utility surfaces.
   */
  permission?: string
}

/**
 * Single source of truth for top-level nav. Sidebar + breadcrumb both consume this.
 *
 * Knowledge, Email Templates and Integrations intentionally live in /settings
 * (tenant configuration), not in the daily-use sidebar — they're set-up
 * surfaces, not workflows operators reach for every day.
 */
export const NAV_ITEMS: NavItem[] = [
  { icon: LayoutDashboard, label: 'Dashboard',    href: '/dashboard',    group: 'overview', permission: 'dashboard.view' },
  { icon: MessageSquare,   label: 'Inbox',        href: '/inbox',        group: 'engage',   permission: 'chat.view' },
  { icon: Phone,           label: 'Calls',        href: '/calls',        group: 'engage',   permission: 'calls.view' },
  { icon: Megaphone,       label: 'Campaigns',    href: '/campaigns',    group: 'engage',   permission: 'campaigns.view' },
  { icon: BarChart3,       label: 'Traffic',      href: '/traffic',      group: 'manage',   permission: 'traffic.view' },
  { icon: MonitorPlay,    label: 'Ads',          href: '/ads',          group: 'manage', adminOnly: true, permission: 'ads.view' },
  { icon: Contact,         label: 'Contacts',     href: '/contacts',     group: 'sales',    permission: 'contacts.view' },
  { icon: Building2,       label: 'Companies',    href: '/companies',    group: 'sales',    permission: 'companies.view' },
  { icon: UserPlus,        label: 'Prospects',    href: '/prospects',    group: 'sales',    orgAdminOnly: true },
  { icon: TrendingUp,      label: 'Pipeline',     href: '/pipeline',     group: 'sales',    permission: 'pipeline.view' },
  { icon: CheckSquare,     label: 'Tasks',        href: '/tasks',        group: 'sales',    permission: 'tasks.view' },
  { icon: Bot,             label: 'Agents',       href: '/agents',       group: 'build',    permission: 'agents.view' },
  { icon: Zap,             label: 'Workflows',    href: '/workflows',    group: 'build',    permission: 'workflows.view' },
  { icon: FolderKanban,    label: 'Projects',     href: '/projects',     group: 'build',    permission: 'projects.view' },
  { icon: CalendarDays,    label: 'Scheduling',   href: '/scheduling',   group: 'build',    permission: 'scheduling.view' },
  { icon: Star,            label: 'Reviews',      href: '/reviews',      group: 'manage',   permission: 'reviews.view' },
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

/**
 * Guaranteed-valid landing route for a path's section. Used when an org switch
 * (or a stale/deleted resource) invalidates a deep org-scoped URL: nav hrefs and
 * `/dashboard` always have a page, so the destination never 404s and can't loop.
 * e.g. `/workflows/flows/{id}` → `/workflows`; non-nav routes → `/dashboard`.
 */
export function sectionRootForPath(pathname: string): string {
  return findNavItemForPath(pathname)?.href ?? '/dashboard'
}
