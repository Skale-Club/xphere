import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { parse as parseYaml } from 'yaml'
import type { Database } from '@/types/database'
import { yamlToFlow } from '@/lib/workflows/yaml-to-flow'
import type { WorkflowDefinition } from '@/lib/workflows/validate'

const SEEDS_DIR = resolve(process.cwd(), 'supabase', 'seeds', 'workflows')

function listSeedFiles(): string[] {
  if (!existsSync(SEEDS_DIR)) return []
  return readdirSync(SEEDS_DIR)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map((f) => join(SEEDS_DIR, f))
    .filter((p) => statSync(p).isFile())
}

export async function seedOrgWorkflows(orgId: string): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    console.warn('[seed-org] Supabase env not set, skipping seed for org', orgId)
    return
  }

  const supabase = createClient<Database>(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  })

  const files = listSeedFiles()
  for (const path of files) {
    const filename = basename(path)
    const slug = filename.replace(/\.ya?ml$/i, '')
    const definition = parseYaml(readFileSync(path, 'utf8')) as WorkflowDefinition

    const triggerType =
      definition.trigger?.type === 'event' && definition.trigger?.event
        ? 'event'
        : definition.trigger?.type ?? 'manual'
    const kind: 'tool' | 'flow' = triggerType === 'tool_call' ? 'tool' : 'flow'

    const flowDefinition = yamlToFlow(definition, { slug })

    const description =
      definition.description ??
      `Platform-default workflow shipped via supabase/seeds/workflows/${filename}`

    // Skip if a user-forked workflow already exists with this slug.
    const { data: existing } = await supabase
      .from('workflows')
      .select('id, description')
      .eq('org_id', orgId)
      .eq('slug', slug)
      .maybeSingle()

    if (existing) {
      if (!existing.description?.includes('Platform-default')) continue
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
          notes: `Seed for new org ${new Date().toISOString()}`,
        })
        .select('id')
        .single()

      if (newVer) {
        await supabase
          .from('workflows')
          .update({ current_version_id: newVer.id, description })
          .eq('id', existing.id)
      }
      continue
    }

    // Insert new workflow + version.
    const { data: workflow, error: wErr } = await supabase
      .from('workflows')
      .insert({
        org_id: orgId,
        name: definition.name ?? slug,
        slug,
        description,
        is_active: true,
        kind,
        trigger_type: triggerType as 'tool_call' | 'event' | 'schedule' | 'manual' | 'webhook_url',
        trigger_config: (definition.trigger?.config ?? {}) as Record<string, unknown>,
      })
      .select('id')
      .single()

    if (wErr || !workflow) continue

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
  }
}
