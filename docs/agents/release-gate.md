# Release Gate (TEST-04)

Status: the gate is wired into CI as `.github/workflows/release-gate.yml` and
as the first job in `.github/workflows/build-deploy.yml`. Both run
`npm run test:battery`, which executes the original Phase 135 gate members,
additional critical platform contracts, the TEST-03 latency profile, and
workflow validation. Any failure blocks the pull request, commit, or deploy.

Read this document before changing `.github/workflows/release-gate.yml` or
`scripts/release-gate.ts` — most of what looks like a gap below is a
deliberate, documented exclusion, not an oversight.

## Why this exists

The original Phase 135 gate protected the omnichannel orchestration path with
a small deterministic subset. The repository-wide battery keeps that subset
intact and adds contracts for the Action Engine, Vapi HTTP behavior and
latency, workflow execution, auth and encryption, the public contact API, and
representative business rules. The goal is a broad gate that stays fast and
deterministic enough to run on every relevant change.

## What runs, and where

| Trigger | Condition |
|---|---|
| `pull_request` | every PR, unconditionally |
| `push` to `main` or `dev` | when the diff touches source, tests, test infrastructure, or workflow definitions |

Every run does, in order:

1. `npm ci`
2. `npm run test:battery` — this is `scripts/test-battery.ts`:
   - verifies that every declared member file exists
   - runs the explicit critical battery via Vitest
   - includes every `GATE_MEMBERS` test from `scripts/release-gate.ts`
   - includes the TEST-03 Vapi latency profile
   - runs `npm run workflows:validate`
   - exits non-zero if any check fails

Any non-zero exit in any step fails the job. Nothing in this workflow
"reports and continues."

## The original orchestration subset (`GATE_MEMBERS`)

Declared as data in `scripts/release-gate.ts`, not inferred by glob, and
imported into the broader manifest in `scripts/test-battery.ts`.
`tests/release-gate.test.ts` asserts the declaration is honest: every member
file exists on disk, every one of the seven TEST-02 areas maps to at least
one member, and the subset stays small (bounded at fewer than 20 files) so
nobody quietly replaces it with the full suite.

| File | TEST-02 area(s) proven |
|---|---|
| `tests/agent-partner-edge-authz.test.ts` | Tenant isolation; direct vs. delegated authorization; cross-agent calls |
| `tests/agent-schema-rls-smoke.test.ts` | Tenant isolation |
| `tests/agent-delegation.test.ts` | Direct vs. delegated authorization; cross-agent calls; cycle and depth limits; Xkedule idempotency |
| `tests/agent-handoff-contract.test.ts` | Handoff injection resistance |
| `tests/openrouter-provider-policy.test.ts` | OpenRouter-only generation |
| `tests/idempotency-ingress-key.test.ts` | Xkedule idempotency |
| `tests/vapi-tools-idempotency.test.ts` | Xkedule idempotency |
| `tests/coverage-pins.test.ts` | Cross-cutting — pins the full membership of every safety-critical set (`SIDE_EFFECTING_ACTIONS`, `COMMERCE_WRITE_ACTIONS`, partner-edge denial reasons, the channel enum) so a newly added Action Engine action type cannot silently bypass classification |

### `tests/agent-schema-rls-smoke.test.ts` soft-skips without a DB secret

This member needs a live Postgres connection (`SUPABASE_DB_URL` or
`DATABASE_URL`) to query `pg_class`/`pg_policy` directly — `supabase-js`
cannot reach `pg_catalog`. No such secret is configured for this workflow;
none is invented here per this phase's constraints. Without it, the test
file's own `beforeAll` prints a console warning and the suite runs under
`describe.skip` — it reports as passed-with-zero-assertions, not failed, and
does not block the gate.

The workflow step already forwards `secrets.SUPABASE_DB_URL` and
`secrets.DATABASE_URL` if either exists in this repository's secrets. If
someone adds one later, this member starts asserting the real RLS policy
contract with no workflow-file change required. Until then, "Tenant
isolation" is still proven by `agent-partner-edge-authz.test.ts`, which does
not need a live DB.

## What this gate deliberately does NOT run

### The environment-dependent full-suite baseline

`npm run test:battery:full` runs every automatic Vitest suite, but historical
files include live-database and environment assumptions unavailable in a
normal CI runner. The blocking gate therefore uses the explicit critical
manifest rather than hiding failures behind exclusions or accepting a
permanently red full-suite job. Use the full profile for audits and investigate
every failure.

### `tests/security-secdef-isolation.test.ts` — now a member (was excluded)

This suite was kept out of the gate while it failed `get_org_member_profiles
refuses to enumerate members of a foreign org` — a real cross-organization data
leak, not flakiness: the function is `SECURITY DEFINER`, joins `auth.users`, and
never checked whether the caller belonged to the organization it was asked about.

Migration `1295` closed it and is applied. The suite is green and is a declared
gate member again, which is the point: a defect that hid for four phases inside a
set of tests everyone treated as pre-existing noise should not be able to hide
there a second time.

The lesson generalises. A stable set of failing tests is not background noise, it
is a place defects live. Audit newcomers to that set rather than assuming.

### 24 write action types with no idempotency classification

Deriving the Action Engine's action types from source finds 48. Eleven are
classified side-effecting (idempotency-guarded), thirteen are deliberate
reads, and 24 writes — spanning email, WhatsApp, ManyChat, Telegram, Google
Contacts, tasks, notes, and the pipeline surface — sit in neither bucket.
Full list and rationale:
`.planning/workstreams/omnichannel-agent-orchestration/FINDINGS-OUTSIDE-SCOPE.md`
item 2.

This gate does **not** classify them — that is deliberately out of scope for
an autonomous run (it changes runtime behavior across eight integration
families) and belongs in a dedicated phase. What this gate **does** enforce:
`tests/coverage-pins.test.ts` derives the action list from
`execute-action.ts` and fails if any action type is in *no* bucket at all —
the 24 sit in an explicit, named `WRITES_PENDING_IDEMPOTENCY_REVIEW` bucket,
so a newly added action cannot slip in unclassified even though these 24
remain unresolved. The gate prevents the set from growing invisibly; it does
not shrink it.

### `npm run build`

Not a step in this workflow, on purpose:

- It needs `NODE_OPTIONS=--max-old-space-size=8192` — an 8 GB heap — and
  takes roughly 10-30 minutes on a loaded machine (measured range in this
  workstream, not a CI-runner benchmark).
- `.github/workflows/build-deploy.yml` already builds the production Docker
  image on every push to `main`. Running `next build` again here would
  duplicate that cost on every PR and push, making this gate slow enough
  that it stops being useful as fast feedback.
- Type errors that `npm run build` would catch are still caught by whatever
  editor/pre-commit type-checking is in use locally; this gate's job is
  behavioral regression and coverage, not a second full build.

If a future gate genuinely needs build-time verification, prefer
`tsc --noEmit` (fast, no bundling) over duplicating the full `next build`.

## Why the latency test is outside `GATE_MEMBERS`

`tests/vapi-latency-profile.test.ts` asserts a TEST-03 p95 target against a
documented, mocked-boundary profile (`docs/agents/latency-profile.md`), not
one of the seven TEST-02 areas. It therefore remains outside `GATE_MEMBERS`
but is a declared member of the broader battery. It runs in the same Vitest
invocation and blocks the workflow like every other battery member.

## How to add a suite to the battery

1. Write the test file under `tests/`.
2. Add it to the appropriate group in `BATTERY_GROUPS` in
   `scripts/test-battery.ts` when it protects a critical platform contract.
3. If it proves one of the original TEST-02 orchestration areas, also add a
   `GateMember` entry to `GATE_MEMBERS` in `scripts/release-gate.ts`.
4. Run `npx vitest run tests/test-battery.test.ts` to verify the manifest.
5. Run `npm run test:battery` to confirm the full critical battery.
6. Do not add live provider calls or destructive probes. Those belong under
   `tests/manual` with explicit prerequisites and side effects.

## Local verification

```bash
npm run test:battery                    # blocking critical battery + workflows
npm run test:battery:list               # inspect manifest membership
npm run test:battery:full               # repository-wide automatic audit
npm run test:battery:release            # critical battery + production build
npx vitest run tests/test-battery.test.ts # proves the manifest is honest
```
