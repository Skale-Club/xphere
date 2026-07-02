# Phase 121: Sending Integration - Context

**Gathered:** 2026-07-02
**Status:** Ready for planning
**Mode:** code-only (any migration/seed written as a FILE, not applied). Verify: `npm run build` exit 0, `npm run workflows:validate` passes for the new tool, + a unit test for the merge-tag renderer. Actually sending an email is post-deploy runtime verify.

<domain>
## Phase Boundary
Make builder email templates SENDABLE: (1) a merge-tag renderer that fills `{{contact.first_name}}`-style variables at send time; (2) a `send_email_template` workflow **tool** (kind='tool') registered in the capability spec/validator so workflows/AI can invoke it by name; (3) let an email **campaign** select a builder template. This closes the loop from "template built" → "template sent".
</domain>

<decisions>
## Implementation Decisions

### Merge-tag renderer (pure, testable) — the one prescriptive piece
- Add `renderWithVariables(input: string, vars: Record<string, unknown>): string` (in `src/lib/email/` — e.g. `merge-tags.ts`) that replaces `{{ path.to.value }}` tokens (trimmed, dot-path into `vars`) with the resolved value, leaving unknown tokens either blank or intact per the platform's existing convention (INVESTIGATE: check if a variable-substitution helper already exists for workflows — reuse it if so; do NOT duplicate).
- Applied to the template `html_snapshot` (and plain text) at send time, with `vars` built from the recipient contact + workflow/campaign context.
- Unit test: tokens resolved from a contact-like object; missing tokens handled; no injection of raw `{{}}` into output when resolved.

### `send_email_template` — INVESTIGATE the tool system, then implement
The planner MUST read and follow the platform's real mechanism (do not invent one):
- `WORKFLOWS.md` (repo root) — the authoring contract for tools (kind='tool').
- `.planning/agents/workflow-authoring.md` + `.planning/workflows/examples/` — canonical tool patterns.
- `supabase/seeds/workflows/` — platform-default workflows; how a tool is declared (YAML) + validated in CI (`npm run workflows:validate <file>`).
- `src/lib/action-engine/` — the executor side. Find the existing `send_email` executor (`executeSendEmail`, to/subject/body) and `sendPlatformEmail` / `src/lib/email/resend.ts`.
- `GET /api/workflows/spec` route — how tools surface in the org-filtered spec (gated on the integration being connected — i.e. email/Resend configured).

Implement `send_email_template` as: input `{ template_id, to (or contact resolution), variables? }` → load the template (`html_snapshot` + subject) for the org → `renderWithVariables` → send via the SAME path `send_email` uses (`sendPlatformEmail`/Resend). Register it so it appears in the spec + passes `npm run workflows:validate`. Mirror the existing `send_email` tool's declaration + executor wiring exactly.

### Campaign template selection — INVESTIGATE `src/lib/campaigns/`
- Determine how an email campaign currently holds its content/body. Add the ability to reference a builder `email_templates` row (likely an `email_template_id` column on the campaign table + resolving its rendered html at send). If a schema change is needed, write it as migration `1230_*` (FILE only, ledgered). Keep it minimal; if campaign email content is already flexible enough, wire selection without a migration.

### Verification (code-only)
- `npm run build` exit 0.
- `npm run workflows:validate` passes for the new `send_email_template` tool seed.
- Merge-tag unit test passes.
- Runtime (a workflow run actually sends a personalized email; campaign uses a template) is post-deploy human-verify — record as deferred, not a gap.
</decisions>

<code_context>
## Existing Code Insights
- `WORKFLOWS.md`, `.planning/agents/workflow-authoring.md`, `.planning/workflows/examples/`, `supabase/seeds/workflows/` — the tool contract + examples (READ before authoring the tool).
- `src/lib/action-engine/*` — existing `send_email` executor; the dispatch/registration pattern to mirror.
- `src/lib/email/resend.ts` + `sendPlatformEmail` — the send path.
- `src/lib/email/render-template.ts` — `renderTemplate`; template `html_snapshot`/subject live on `email_templates`.
- `src/app/(dashboard)/email-templates/actions.ts` — `getTemplate` (load by id).
- `src/lib/campaigns/*` — the campaign engine (email content path).
- `src/app/api/workflows/spec/route.ts` (or similar) — the capability spec endpoint.
</code_context>

<specifics>
## Specific Ideas
- Reuse the existing send path + any existing variable-substitution helper — do NOT build a parallel email-sending or templating stack.
- The tool must be org-gated in the spec exactly like `send_email` (only appears when email is configured).
- Everything is code/seed FILES only — no `db push`, no applying seeds to prod.
</specifics>

<deferred>
## Deferred Ideas
- A/B testing / scheduling of sends — out of scope (REQUIREMENTS.md).
- Runtime send verification + campaign end-to-end — post-deploy, after migrations applied.
</deferred>
