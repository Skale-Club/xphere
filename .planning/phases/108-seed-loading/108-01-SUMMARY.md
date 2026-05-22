# Phase 108: Seed Loading — Summary

**Status:** Complete ✅

## What Changed

### New file: `src/lib/workflows/yaml-to-flow.ts`
- Converts YAML seed format → `FlowDefinition` format with auto-generated layout positions
- Trigger node placed at top center (300, 50); subsequent nodes laid out vertically with 120px spacing
- Uses BFS from trigger node to determine depth of each node
- Converts YAML `kind` → FlowDefinition `action_type` for action nodes
- Converts YAML `{from, to}` edges → FlowDefinition `{source, target}` edges
- Tags metadata with `["platform-default"]` for seed tracking
- Handles `wait`, `condition`, and action node types

### New file: `src/lib/workflows/seed-org.ts`
- Seeds a single org with all platform-default workflows from `supabase/seeds/workflows/*.yaml`
- Uses YAML→FlowDefinition conversion with auto-layout
- Idempotent: skips user-forked workflows (no "Platform-default" in description)
- Gracefully handles missing env vars or seed directory (no-op)
- Used by org creation hook

### Modified: `scripts/load-workflow-seeds.ts`
- Added `yamlToFlow` import
- `loadForOrg()` now converts YAML → FlowDefinition before storing in `workflow_versions.definition`
- Seeds are now stored in canvas-compatible format with auto-layout positions

### Modified: `src/app/(dashboard)/organizations/actions.ts`
- Added `seedOrgWorkflows` import
- After successful org creation, fire-and-forgets `seedOrgWorkflows(org.id)` to seed platform-default workflows

### Modified: `package.json`
- Added `"seed": "tsx scripts/load-workflow-seeds.ts"` script

## Requirements Fulfilled
- **SEED-01**: `npm run seed` reads all YAML files and loads them ✅
- **SEED-02**: Auto-generated layout positions for canvas editing ✅
- **SEED-03**: Idempotent upsert per org (slug + Platform-default check) ✅
- **SEED-04**: New orgs auto-receive seeds via org creation hook ✅
- **SEED-05**: `npm run seed` wired as npm script; seeds runnable as post-deploy step ✅

## Verification
- `npm run build` → TypeScript compiles successfully ✅
- `npx vitest run` → 82 files pass, 38 pre-existing failures, no regressions ✅
