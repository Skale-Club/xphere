#!/usr/bin/env node
// Imports ONE workflow YAML into ONE organization.
//
//   npx tsx --env-file=.env.local scripts/import-org-workflow.ts <org-id> <file.yaml>
//   npx tsx --env-file=.env.local scripts/import-org-workflow.ts <org-id> <file.yaml> --apply
//
// seedOrgWorkflows() only ever reads supabase/seeds/workflows/, which is the
// PLATFORM's own defaults — a client's playbook must not live there (CLAUDE.md).
// This is the same conversion and the same insert, pointed at a single file so
// a flow written for one tenant can be installed without becoming everyone's
// default.
//
// Idempotent: re-running appends a new workflow_version and repoints
// current_version_id, so the flow's history is preserved and a rollback is a
// matter of pointing back at an older row.

import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { parse as parseYaml } from 'yaml'
import type { Database } from '../src/types/database'
import { yamlToFlow } from '../src/lib/workflows/yaml-to-flow'
import { validateWorkflow, type WorkflowDefinition } from '../src/lib/workflows/validate'
import { TRIGGERS, NODES, VARIABLE_NAMESPACES, SPEC_VERSION } from '../src/lib/workflows/spec'

async function main() {
  const [orgId, file] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const apply = process.argv.includes('--apply')
  if (!orgId || !file) {
    throw new Error('usage: import-org-workflow.ts <org-id> <file.yaml> [--apply]')
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')

  const path = resolve(process.cwd(), file)
  const slug = basename(path).replace(/\.ya?ml$/i, '')
  const definition = parseYaml(readFileSync(path, 'utf8')) as WorkflowDefinition

  const supabase = createClient<Database>(url, key, { auth: { persistSession: false } })

  // Validate against THIS org's spec, not a permissive static one: a node that
  // needs an integration the tenant has not connected must fail here rather
  // than at 3am when the flow fires and the action has nothing to talk to.
  const { data: integrations } = await supabase
    .from('integrations')
    .select('provider')
    .eq('organization_id', orgId)
    .eq('is_active', true)
  const available = Array.from(new Set((integrations ?? []).map((i) => i.provider)))

  const spec = {
    version: SPEC_VERSION,
    org_id: orgId,
    available_integrations: available,
    triggers: TRIGGERS,
    nodes: NODES,
    variable_namespaces: VARIABLE_NAMESPACES,
    workflows: [],
  }
  const result = validateWorkflow(definition, spec as never)
  if (!result.ok) {
    for (const issue of result.errors) console.error('  -', JSON.stringify(issue))
    throw new Error(`${slug} does not validate for this org`)
  }
  console.log(`${slug}: valid for this org (${definition.nodes?.length ?? 0} nodes, ${available.length} integrations connected)`)

  const isEvent = definition.trigger?.type === 'event' && Boolean(definition.trigger?.event)
  const triggerType = isEvent ? 'event' : definition.trigger?.type ?? 'manual'
  const kind: 'tool' | 'flow' = triggerType === 'tool_call' ? 'tool' : 'flow'
  // The dispatcher matches on trigger_config @> { event }; the event name lives
  // at trigger.event in the YAML, so fold it in.
  const triggerConfig: Record<string, unknown> = {
    ...(definition.trigger?.config ?? {}),
    ...(isEvent ? { event: definition.trigger!.event } : {}),
  }
  const flowDefinition = yamlToFlow(definition, { slug })

  const { data: existing } = await supabase
    .from('workflows')
    .select('id, name, current_version_id')
    .eq('org_id', orgId)
    .eq('slug', slug)
    .maybeSingle()

  if (!apply) {
    console.log(existing ? `would add a new version to workflow ${existing.id}` : 'would create the workflow')
    console.log(`  name=${definition.name} kind=${kind} trigger=${triggerType} ${JSON.stringify(triggerConfig)}`)
    console.log('dry run only — re-run with --apply.')
    return
  }

  let workflowId = existing?.id ?? null
  if (!workflowId) {
    const { data, error } = await supabase
      .from('workflows')
      .insert({
        org_id: orgId,
        name: definition.name ?? slug,
        slug,
        description: definition.description ?? null,
        is_active: true,
        kind,
        trigger_type: triggerType as 'tool_call' | 'event' | 'schedule' | 'manual' | 'webhook_url',
        trigger_config: triggerConfig,
      })
      .select('id')
      .single()
    if (error) throw error
    workflowId = data.id
    console.log(`created workflow ${workflowId}`)
  }

  const { data: latest } = await supabase
    .from('workflow_versions')
    .select('version_number')
    .eq('workflow_id', workflowId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextVersion = (latest?.version_number ?? 0) + 1
  const { data: version, error: vErr } = await supabase
    .from('workflow_versions')
    .insert({
      workflow_id: workflowId,
      version_number: nextVersion,
      definition: flowDefinition as never,
      notes: `Imported from ${file} ${new Date().toISOString()}`,
    })
    .select('id')
    .single()
  if (vErr) throw vErr

  const { error: upErr } = await supabase
    .from('workflows')
    .update({
      current_version_id: version.id,
      name: definition.name ?? slug,
      description: definition.description ?? null,
      is_active: true,
      trigger_type: triggerType as 'tool_call' | 'event' | 'schedule' | 'manual' | 'webhook_url',
      trigger_config: triggerConfig,
    })
    .eq('id', workflowId)
  if (upErr) throw upErr

  console.log(`published version ${nextVersion} of workflow ${workflowId}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
