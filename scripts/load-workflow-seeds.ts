#!/usr/bin/env node
// SEED-026 Phase D: ingests supabase/seeds/workflows/*.yaml into the
// workflows + workflow_versions tables for every org that does not already
// have a forked version.
//
// Strategy:
//   - Each seed YAML has a stable slug. We insert workflows with kind
//     derived from trigger type (tool_call → 'tool', else 'flow') and
//     slug = filename minus extension.
//   - For each org: if no workflow with this slug exists (or exists but
//     is marked seed-managed), insert/upsert. Hand-edited workflows are
//     forked by the user — we detect that via `is_seed_managed` and skip.
//   - Validator runs first; any failure aborts the whole load.
//
// Usage:
//   tsx scripts/load-workflow-seeds.ts                 # all orgs
//   tsx scripts/load-workflow-seeds.ts --org=<uuid>    # single org
//   tsx scripts/load-workflow-seeds.ts --dry-run       # validate only

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, basename, relative } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { parse as parseYaml } from 'yaml'
import type { Database } from '../src/types/database'
import { TRIGGERS, NODES, VARIABLE_NAMESPACES, SPEC_VERSION, type WorkflowSpec } from '../src/lib/workflows/spec'
import { validateWorkflow, type WorkflowDefinition } from '../src/lib/workflows/validate'
import { yamlToFlow } from '../src/lib/workflows/yaml-to-flow'

const REPO_ROOT = resolve(__dirname, '..')
const SEEDS_DIR = join(REPO_ROOT, 'supabase', 'seeds', 'workflows')

function buildStaticSpec(): WorkflowSpec {
  const allProviders = new Set<string>()
  for (const n of NODES) {
    for (const p of n.integration_required ?? []) allProviders.add(p)
  }
  return {
    version: SPEC_VERSION,
    org_id: '__static__',
    available_integrations: Array.from(allProviders).sort(),
    triggers: TRIGGERS,
    nodes: NODES,
    variable_namespaces: VARIABLE_NAMESPACES,
    // SEED-033: static seed loader has no org context — no callable workflows
    // to enumerate. The runtime spec endpoint populates this per org.
    workflows: [],
  }
}

interface ParsedSeed {
  slug: string
  filename: string
  definition: WorkflowDefinition
  kind: 'tool' | 'flow'
  triggerType: string
  toolName: string | null
}

function listSeedFiles(): string[] {
  if (!existsSync(SEEDS_DIR)) return []
  return readdirSync(SEEDS_DIR)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map((f) => join(SEEDS_DIR, f))
    .filter((p) => statSync(p).isFile())
}

function parseSeed(path: string): ParsedSeed {
  const filename = basename(path)
  const slug = filename.replace(/\.ya?ml$/i, '')
  const definition = parseYaml(readFileSync(path, 'utf8')) as WorkflowDefinition
  const triggerType =
    definition.trigger?.type === 'event' && definition.trigger?.event
      ? 'event'
      : definition.trigger?.type ?? 'manual'
  const kind: 'tool' | 'flow' = triggerType === 'tool_call' ? 'tool' : 'flow'
  const toolName =
    kind === 'tool'
      ? ((definition.trigger?.config?.tool_name as string | undefined) ?? slug)
      : null
  return { slug, filename, definition, kind, triggerType, toolName }
}

async function loadForOrg(
  supabase: ReturnType<typeof createClient<Database>>,
  orgId: string,
  seed: ParsedSeed,
): Promise<{ inserted: boolean; updated: boolean; skipped: boolean; reason?: string }> {
  // Convert YAML seed format → FlowDefinition with auto-layout positions
  // so seeded workflows are immediately editable in the canvas.
  const flowDefinition = yamlToFlow(seed.definition, { slug: seed.slug })

  // Look for an existing workflow with this slug for this org.
  const { data: existing } = await supabase
    .from('workflows')
    .select('id, description, is_active, current_version_id')
    .eq('org_id', orgId)
    .eq('slug', seed.slug)
    .maybeSingle()

  const description =
    seed.definition.description ??
    `Platform-default workflow shipped via supabase/seeds/workflows/${seed.filename}`

  if (existing) {
    // Skip if user-edited (no seed marker in description). Simple heuristic
    // until we add an explicit is_seed_managed column.
    if (!existing.description?.includes('Platform-default')) {
      return { inserted: false, updated: false, skipped: true, reason: 'user-forked' }
    }
    // Update existing seed-managed workflow with new definition version.
    const { data: latestVersion } = await supabase
      .from('workflow_versions')
      .select('version_number')
      .eq('workflow_id', existing.id)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle()

    const nextVersion = (latestVersion?.version_number ?? 0) + 1
    const { data: newVer } = await supabase
      .from('workflow_versions')
      .insert({
        workflow_id: existing.id,
        version_number: nextVersion,
        definition: flowDefinition as unknown as Database['public']['Tables']['workflow_versions']['Insert']['definition'],
        notes: `Seed load ${new Date().toISOString()}`,
      })
      .select('id')
      .single()

    if (newVer) {
      await supabase
        .from('workflows')
        .update({
          current_version_id: newVer.id,
          description,
        })
        .eq('id', existing.id)
    }
    return { inserted: false, updated: true, skipped: false }
  }

  // Insert new workflow + initial version.
  const { data: workflow, error: wErr } = await supabase
    .from('workflows')
    .insert({
      org_id: orgId,
      name: seed.definition.name ?? seed.slug,
      slug: seed.slug,
      description,
      is_active: true,
      kind: seed.kind,
      tool_name: seed.toolName,
      trigger_type: seed.triggerType as 'tool_call' | 'event' | 'schedule' | 'manual' | 'webhook_url',
      trigger_config: {
        ...(seed.definition.trigger?.type === 'event' && seed.definition.trigger?.event
          ? { event: seed.definition.trigger.event }
          : {}),
        ...(seed.definition.trigger?.config ?? {}),
      } as Record<string, unknown>,
    })
    .select('id')
    .single()

  if (wErr || !workflow) {
    return { inserted: false, updated: false, skipped: true, reason: wErr?.message }
  }

  const { data: version } = await supabase
    .from('workflow_versions')
    .insert({
      workflow_id: workflow.id,
      version_number: 1,
      definition: flowDefinition as unknown as Database['public']['Tables']['workflow_versions']['Insert']['definition'],
      notes: 'Initial platform-default seed load',
    })
    .select('id')
    .single()

  if (version) {
    await supabase
      .from('workflows')
      .update({ current_version_id: version.id })
      .eq('id', workflow.id)
  }

  return { inserted: true, updated: false, skipped: false }
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const orgFilter = args.find((a) => a.startsWith('--org='))?.split('=')[1]

  // ─── Step 1: parse + validate every seed ─────────────────────────────────
  const files = listSeedFiles()
  if (files.length === 0) {
    console.log('No workflow seeds to load.')
    process.exit(0)
  }

  const spec = buildStaticSpec()
  const parsed: ParsedSeed[] = []
  let validationFailed = false

  for (const path of files) {
    const rel = relative(REPO_ROOT, path)
    try {
      const seed = parseSeed(path)
      const result = validateWorkflow(seed.definition, spec)
      if (!result.ok) {
        console.error(`✗ ${rel} — ${result.errors.length} validation error(s):`)
        for (const e of result.errors) {
          console.error(`    [${e.code}] ${e.path}: ${e.message}`)
          console.error(`      → ${e.suggestion}`)
        }
        validationFailed = true
        continue
      }
      parsed.push(seed)
      console.log(`✓ ${rel}`)
    } catch (err) {
      console.error(`✗ ${rel} — parse error: ${err instanceof Error ? err.message : err}`)
      validationFailed = true
    }
  }

  if (validationFailed) {
    console.error('\nAborting load — validation errors above.')
    process.exit(1)
  }

  if (dryRun) {
    console.log(`\n--dry-run: ${parsed.length} seed(s) would be loaded.`)
    process.exit(0)
  }

  // ─── Step 2: load into target orgs ──────────────────────────────────────
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for non-dry-run loads.')
    process.exit(2)
  }

  const supabase = createClient<Database>(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  })

  const { data: orgs, error: orgErr } = orgFilter
    ? await supabase.from('organizations').select('id').eq('id', orgFilter)
    : await supabase.from('organizations').select('id')

  if (orgErr || !orgs) {
    console.error('Failed to list organizations:', orgErr?.message)
    process.exit(3)
  }

  let totalInserted = 0
  let totalUpdated = 0
  let totalSkipped = 0

  for (const org of orgs as { id: string }[]) {
    for (const seed of parsed) {
      const r = await loadForOrg(supabase, org.id, seed)
      if (r.inserted) totalInserted++
      if (r.updated) totalUpdated++
      if (r.skipped) totalSkipped++
    }
  }

  console.log(
    `\n${orgs.length} org(s) × ${parsed.length} seed(s): ` +
      `${totalInserted} inserted, ${totalUpdated} updated, ${totalSkipped} skipped`,
  )
}

main().catch((err) => {
  console.error('Unhandled error:', err)
  process.exit(99)
})
