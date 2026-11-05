// Recovery reconciliation for tenant-owned Meta Custom Audiences.
// Moved here from scripts/meta-audience-sync.ts so the in-app cron route
// (/api/cron/meta-audience-sync) and the dev script share one implementation.
// All membership selection, hashing, diffing, locking, and ledger commits live
// in audience-reconcile; this module only validates runtime configuration,
// constrains the config query, and reports safe aggregate outcomes.

import { OrgOAuthProvider } from '@/lib/meta/audience-provider'
import {
  reconcileMetaAudience,
  SupabaseAudienceReconcileStore,
} from '@/lib/meta/audience-reconcile'
import { createServiceRoleClient } from '@/lib/supabase/admin'

export interface AudienceJobOptions {
  orgId: string | null
  audienceId: string | null
  dryRun: boolean
}

export interface AudienceJobReport {
  due: number
  succeeded: number
  failed: number
  skipped: number
}

export function parseOptions(argv: string[]): AudienceJobOptions {
  const valueAfter = (flag: string): string | null => {
    const index = argv.indexOf(flag)
    if (index === -1) return null
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`)
    return value
  }
  return {
    orgId: valueAfter('--org'),
    audienceId: valueAfter('--audience'),
    dryRun: argv.includes('--dry-run'),
  }
}

/**
 * Database access comes from createServiceRoleClient() (internal PostgREST +
 * self-signed token), so only the tenant-token decryption key is checked here.
 */
export function requireRuntime(env: NodeJS.ProcessEnv): void {
  if (!env.ENCRYPTION_SECRET?.trim()) {
    throw new Error('Missing required configuration: ENCRYPTION_SECRET')
  }
  if (!/^[0-9a-fA-F]{64}$/.test(env.ENCRYPTION_SECRET)) {
    throw new Error('Missing required configuration: ENCRYPTION_SECRET must be 64 hex characters')
  }
}

export interface AudienceJobDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase?: any
  reconcile?: typeof reconcileMetaAudience
  now?: () => number
  log?: (line: string) => void
  /** Skip the ENCRYPTION_SECRET check (tests with a fake provider). */
  skipRuntimeCheck?: boolean
}

/**
 * Reconciles every enabled, due audience. Returns counts; does NOT throw when
 * some audiences fail (the caller decides: the script exits non-zero, the cron
 * route logs and reports to Sentry).
 */
export async function runAudienceJob(
  options: AudienceJobOptions,
  deps: AudienceJobDeps = {},
): Promise<AudienceJobReport> {
  if (!deps.skipRuntimeCheck) requireRuntime(process.env)
  const log = deps.log ?? ((line: string) => console.log(line))
  const reconcile = deps.reconcile ?? reconcileMetaAudience
  const supabase = deps.supabase ?? createServiceRoleClient()

  let query = supabase
    .from('meta_audience_config')
    .select('id, org_id, dirty_at, next_sync_at, last_synced_at')
    .eq('sync_enabled', true)
  if (options.orgId) query = query.eq('org_id', options.orgId)
  if (options.audienceId) query = query.eq('id', options.audienceId)

  const { data, error } = await query
  if (error) throw new Error('Could not load due Meta audience configurations')

  const now = (deps.now ?? Date.now)()
  type ConfigRow = {
    id: string
    org_id: string
    dirty_at: string | null
    next_sync_at: string | null
    last_synced_at: string | null
  }
  const configs = ((data ?? []) as ConfigRow[]).filter((config) => {
    if (options.orgId || options.audienceId || options.dryRun) return true
    if (config.dirty_at || !config.last_synced_at || !config.next_sync_at) return true
    const next = Date.parse(config.next_sync_at)
    return !Number.isFinite(next) || next <= now
  })

  if (configs.length === 0) {
    log('[meta-audience-sync] 0 audiences due')
    return { due: 0, succeeded: 0, failed: 0, skipped: 0 }
  }

  const store = new SupabaseAudienceReconcileStore(supabase)
  const provider = new OrgOAuthProvider(supabase)
  let succeeded = 0
  let failed = 0
  let skipped = 0

  log(`[meta-audience-sync] ${configs.length} audiences due${options.dryRun ? ' (dry-run)' : ''}`)
  for (const config of configs) {
    const result = await reconcile({
      store,
      provider,
      orgId: config.org_id,
      audienceConfigId: config.id,
      trigger: options.dryRun ? 'manual' : 'scheduled',
      dryRun: options.dryRun,
    })
    if (result.status === 'succeeded') {
      succeeded++
      log(
        `[meta-audience-sync] org=${config.org_id} audience=${config.id} ` +
        `status=succeeded add=${result.addCount} remove=${result.removeCount} unchanged=${result.unchangedCount}`,
      )
    } else if (result.status === 'skipped') {
      skipped++
      log(`[meta-audience-sync] org=${config.org_id} audience=${config.id} status=already_claimed`)
    } else {
      failed++
      console.error(
        `[meta-audience-sync] org=${config.org_id} audience=${config.id} ` +
        `status=failed code=${result.errorCode}`,
      )
    }
  }

  log(
    `[meta-audience-sync] finished due=${configs.length} succeeded=${succeeded} failed=${failed} skipped=${skipped}`,
  )
  return { due: configs.length, succeeded, failed, skipped }
}
