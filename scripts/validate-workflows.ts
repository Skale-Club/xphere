#!/usr/bin/env node
// SEED-026 Phase A: CLI workflow validator.
//
// Usage:
//   npx tsx scripts/validate-workflows.ts path/to/file.yaml
//   npx tsx scripts/validate-workflows.ts                  # validates every .yaml in .planning/workflows/examples + supabase/seeds/workflows
//
// Validates against the STATIC portion of the spec (triggers + node catalog).
// Per-org availability cannot be checked locally — that gate runs at submit
// time via /api/workflows/validate.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { TRIGGERS, NODES, VARIABLE_NAMESPACES, SPEC_VERSION } from '../src/lib/workflows/spec'
import { validateWorkflow, type WorkflowDefinition } from '../src/lib/workflows/validate'
import type { WorkflowSpec } from '../src/lib/workflows/spec'

const REPO_ROOT = resolve(__dirname, '..')

// Build a "permissive" spec that exposes every integration referenced by
// node specs. Local validation cannot check per-org availability — that
// gate runs at submit time. This still catches typos in node kinds,
// trigger types, variable scopes, etc.
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
  }
}

function collectYamlFiles(): string[] {
  const dirs = [
    join(REPO_ROOT, '.planning', 'workflows', 'examples'),
    join(REPO_ROOT, '.planning', 'workflows', 'templates'),
    join(REPO_ROOT, 'supabase', 'seeds', 'workflows'),
  ]
  const out: string[] = []
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isFile() && (entry.endsWith('.yaml') || entry.endsWith('.yml'))) {
        out.push(full)
      }
    }
  }
  return out
}

function validateOne(path: string, spec: WorkflowSpec): boolean {
  const rel = relative(REPO_ROOT, path)
  let definition: WorkflowDefinition
  try {
    const raw = readFileSync(path, 'utf8')
    definition = parseYaml(raw) as WorkflowDefinition
  } catch (err) {
    console.error(`✗ ${rel} — YAML parse error: ${err instanceof Error ? err.message : err}`)
    return false
  }

  const result = validateWorkflow(definition, spec)
  if (result.ok) {
    console.log(`✓ ${rel}`)
    return true
  }

  console.error(`✗ ${rel} — ${result.errors.length} error${result.errors.length !== 1 ? 's' : ''}:`)
  for (const e of result.errors) {
    console.error(`    [${e.code}] ${e.path}: ${e.message}`)
    console.error(`      → ${e.suggestion}`)
  }
  return false
}

function main() {
  const spec = buildStaticSpec()
  const args = process.argv.slice(2)
  const targets = args.length > 0 ? args.map((a) => resolve(a)) : collectYamlFiles()

  if (targets.length === 0) {
    console.log('No workflow YAML files to validate.')
    process.exit(0)
  }

  let okCount = 0
  for (const t of targets) {
    if (validateOne(t, spec)) okCount++
  }

  const failed = targets.length - okCount
  console.log(`\n${okCount} passed, ${failed} failed (${targets.length} total)`)
  process.exit(failed === 0 ? 0 : 1)
}

main()
