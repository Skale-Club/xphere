/**
 * RBAC permission catalog — the single source of truth for permission keys and
 * groups. Grounded in Xphere's real feature surfaces (see
 * `src/components/layout/nav-items.ts` and `src/components/settings/settings-nav.tsx`).
 *
 * The database stores only *grants* (which role has which key, per org, in
 * `role_permissions`). This file defines the universe of keys + group structure
 * the Settings → Roles & Permissions panel renders.
 *
 * Project: Roles, Permissions & Access Control (Xphere / Active Projects).
 */

/** In-org roles. `member` is the GoHighLevel "User". `owner` tops the org. */
export type OrgRole = 'owner' | 'admin' | 'member'

/** Platform (Skale Club / super admin) roles — sit above every org. */
export type PlatformRole = 'platform_admin' | 'platform_member'

/** Roles whose permission sets are configurable in the panel. */
export type ConfigurableRole = Extract<OrgRole, 'admin' | 'member'>
export const CONFIGURABLE_ROLES: ConfigurableRole[] = ['admin', 'member']

export interface Permission {
  /** Stable key persisted in `role_permissions.permission_key`. `<group>.<action>`. */
  key: string
  label: string
}

export interface PermissionGroup {
  key: string
  label: string
  /** lucide-react icon name, for the panel UI. */
  icon: string
  /** Only configurable by / visible to platform (super admin) staff. */
  platformOnly?: boolean
  permissions: Permission[]
}

/**
 * The catalog. Order is the panel render order. Groups map 1:1 to Xphere nav /
 * settings surfaces; GHL-only modules (Gokollab, WordPress, Memberships, etc.)
 * are intentionally excluded.
 */
export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    icon: 'LayoutDashboard',
    permissions: [{ key: 'dashboard.view', label: 'View dashboard' }],
  },
  {
    key: 'chat',
    label: 'Conversations',
    icon: 'MessageSquare',
    permissions: [
      { key: 'chat.view', label: 'View conversations' },
      { key: 'chat.manage', label: 'View & manage conversations' },
    ],
  },
  {
    key: 'calls',
    label: 'Calls',
    icon: 'Phone',
    permissions: [
      { key: 'calls.view', label: 'View calls' },
      { key: 'calls.manage', label: 'View & manage calls' },
    ],
  },
  {
    key: 'agents',
    label: 'AI Agents',
    icon: 'Bot',
    permissions: [
      { key: 'agents.view', label: 'View AI agents' },
      { key: 'agents.manage', label: 'View & manage AI agents' },
      { key: 'agents.manage_training', label: 'View & manage agent training & goals' },
    ],
  },
  {
    key: 'campaigns',
    label: 'Campaigns',
    icon: 'Megaphone',
    permissions: [
      { key: 'campaigns.view', label: 'View campaigns' },
      { key: 'campaigns.manage', label: 'View & manage campaigns' },
    ],
  },
  {
    key: 'contacts',
    label: 'Contacts',
    icon: 'Contact',
    permissions: [
      { key: 'contacts.view', label: 'View contacts' },
      { key: 'contacts.manage', label: 'View & manage contacts' },
      { key: 'contacts.bulk', label: 'View & manage bulk actions' },
      { key: 'contacts.export', label: 'Export contacts' },
    ],
  },
  {
    key: 'prospects',
    label: 'Prospects',
    icon: 'UserPlus',
    permissions: [
      { key: 'prospects.view', label: 'View prospects' },
      { key: 'prospects.manage', label: 'View & manage prospects' },
      { key: 'prospects.import', label: 'Import prospects' },
    ],
  },
  {
    key: 'companies',
    label: 'Companies',
    icon: 'Building2',
    permissions: [
      { key: 'companies.view', label: 'View companies' },
      { key: 'companies.manage', label: 'View & manage companies' },
    ],
  },
  {
    key: 'pipeline',
    label: 'Pipeline',
    icon: 'TrendingUp',
    permissions: [
      { key: 'pipeline.view', label: 'View pipeline & opportunities' },
      { key: 'pipeline.manage', label: 'View & manage opportunities' },
      { key: 'pipeline.view_lead_value', label: 'View opportunity lead value' },
      { key: 'pipeline.bulk', label: 'View & manage bulk actions' },
    ],
  },
  {
    key: 'tasks',
    label: 'Tasks',
    icon: 'CheckSquare',
    permissions: [
      { key: 'tasks.view', label: 'View tasks' },
      { key: 'tasks.manage', label: 'View & manage tasks' },
    ],
  },
  {
    key: 'calendar',
    label: 'Calendar',
    icon: 'CalendarDays',
    permissions: [
      { key: 'calendar.view', label: 'View appointments & calendars' },
      { key: 'calendar.manage_appointments', label: 'Manage appointments' },
      { key: 'calendar.manage_calendars', label: 'Manage calendars' },
    ],
  },
  {
    key: 'workflows',
    label: 'Workflows',
    icon: 'Zap',
    permissions: [
      { key: 'workflows.view', label: 'View workflows' },
      { key: 'workflows.manage', label: 'View & manage workflows' },
    ],
  },
  {
    key: 'projects',
    label: 'Projects',
    icon: 'FolderKanban',
    permissions: [
      { key: 'projects.view', label: 'View projects' },
      { key: 'projects.manage', label: 'View & manage projects' },
    ],
  },
  {
    key: 'reviews',
    label: 'Reviews',
    icon: 'Star',
    permissions: [
      { key: 'reviews.view', label: 'View reviews' },
      { key: 'reviews.manage', label: 'View & manage reviews' },
    ],
  },
  {
    key: 'traffic',
    label: 'Traffic',
    icon: 'BarChart3',
    permissions: [{ key: 'traffic.view', label: 'View traffic & analytics' }],
  },
  {
    key: 'knowledge',
    label: 'Knowledge',
    icon: 'BookOpen',
    permissions: [
      { key: 'knowledge.view', label: 'View knowledge base' },
      { key: 'knowledge.manage', label: 'View & manage knowledge base' },
    ],
  },
  {
    key: 'integrations',
    label: 'Integrations',
    icon: 'Plug2',
    permissions: [
      { key: 'integrations.view', label: 'View integrations' },
      { key: 'integrations.manage', label: 'View & manage integrations' },
    ],
  },
  {
    key: 'email_templates',
    label: 'Email',
    icon: 'Mail',
    permissions: [
      { key: 'email_templates.view', label: 'View email templates' },
      { key: 'email_templates.manage', label: 'View & manage email templates' },
    ],
  },
  {
    key: 'account_settings',
    label: 'Account Settings',
    icon: 'Settings',
    permissions: [
      { key: 'account_settings.manage_tags', label: 'View & manage tags' },
      { key: 'account_settings.manage_workspace', label: 'View & manage workspace settings' },
    ],
  },
  {
    key: 'user_management',
    label: 'User Management',
    icon: 'Users',
    permissions: [
      { key: 'user_management.view', label: 'View users' },
      { key: 'user_management.manage', label: 'View & manage users (members & invites)' },
    ],
  },
  {
    key: 'billing',
    label: 'Billing',
    icon: 'CreditCard',
    permissions: [
      { key: 'billing.view', label: 'View billing' },
      { key: 'billing.manage', label: 'View & manage billing' },
    ],
  },
  // --- Platform (Super Admin / Skale Club) only ---
  {
    key: 'ads',
    label: 'Ads',
    icon: 'MonitorPlay',
    platformOnly: true,
    permissions: [
      { key: 'ads.view', label: 'View ads' },
      { key: 'ads.manage', label: 'View & manage ads' },
    ],
  },
  {
    key: 'org_management',
    label: 'Organizations',
    icon: 'Building2',
    platformOnly: true,
    permissions: [
      { key: 'org_management.manage_owners', label: 'Add & manage owner organizations' },
      { key: 'org_management.manage_templates', label: 'Manage organization templates' },
      { key: 'org_management.view_event_logs', label: 'View platform event logs' },
    ],
  },
]

/** Every permission key in the catalog. */
export const ALL_PERMISSION_KEYS: string[] = PERMISSION_GROUPS.flatMap((g) =>
  g.permissions.map((p) => p.key),
)

/** Keys configurable by an Owner (non-platform). */
export const ORG_PERMISSION_KEYS: string[] = PERMISSION_GROUPS.filter(
  (g) => !g.platformOnly,
).flatMap((g) => g.permissions.map((p) => p.key))

/**
 * Surfaces whose records carry an assignee and are therefore subject to the
 * "Restrict data visibility to only assigned data" seal.
 */
export const SEALED_GROUPS = ['contacts', 'chat', 'pipeline', 'tasks', 'calendar'] as const

/**
 * Per the GHL note, the assigned-only seal does NOT apply to these groups for
 * Admins — Admins always keep full visibility into them. The seal still fully
 * applies to Users (members).
 */
export const ADMIN_SEAL_EXEMPT_GROUPS = ['contacts', 'pipeline', 'tasks'] as const

/**
 * Default grants applied when an org has no saved configuration yet. The Owner
 * can override any of these in the panel.
 * - admin: broad — every non-platform permission.
 * - member: a basic day-to-day operator set.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<ConfigurableRole, string[]> = {
  admin: ORG_PERMISSION_KEYS,
  member: [
    'dashboard.view',
    'chat.view',
    'chat.manage',
    'calls.view',
    'contacts.view',
    'pipeline.view',
    'tasks.view',
    'tasks.manage',
    'calendar.view',
    'campaigns.view',
  ],
}

/** True if `key` is a real permission in the catalog. */
export function isValidPermissionKey(key: string): boolean {
  return ALL_PERMISSION_KEYS.includes(key)
}

// --- Shared config shapes used by the panel + server actions ---------------

/** One configurable role's resolved state. */
export type RoleConfig = {
  /** permission_key -> enabled, covering every ORG_PERMISSION_KEYS entry. */
  permissions: Record<string, boolean>
  restrictToAssigned: boolean
}

/** Both configurable roles' state for an org. */
export type OrgRolesConfig = Record<ConfigurableRole, RoleConfig>

/** An org option for the super-admin owner selector. */
export type RoleOrgOption = { id: string; name: string; slug: string }

/**
 * Resolve a role's full permission map from stored rows. When the role has no
 * stored rows yet (uninitialized org), fall back to DEFAULT_ROLE_PERMISSIONS.
 */
export function resolveRoleConfig(
  role: ConfigurableRole,
  rows: { permission_key: string; enabled: boolean }[],
  restrictToAssigned: boolean,
): RoleConfig {
  const permissions: Record<string, boolean> = {}
  if (rows.length === 0) {
    for (const key of ORG_PERMISSION_KEYS) {
      permissions[key] = DEFAULT_ROLE_PERMISSIONS[role].includes(key)
    }
  } else {
    for (const key of ORG_PERMISSION_KEYS) permissions[key] = false
    for (const r of rows) {
      if (isValidPermissionKey(r.permission_key)) permissions[r.permission_key] = r.enabled
    }
  }
  return { permissions, restrictToAssigned }
}

/** Build the full explicit grant rows (every catalog key, true/false) to upsert. */
export function buildPermissionRows(
  role: ConfigurableRole,
  permissions: Record<string, boolean>,
): { role: ConfigurableRole; permission_key: string; enabled: boolean }[] {
  return ORG_PERMISSION_KEYS.map((key) => ({
    role,
    permission_key: key,
    enabled: permissions[key] === true,
  }))
}
