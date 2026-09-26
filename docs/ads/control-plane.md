# Ads Control Plane

Every write to Google Ads or Meta Ads goes through one engine
(`src/lib/ads/commands/engine.ts`). Dashboard routes, the MCP server (Codex,
Claude, any agent), the in-app Copilot and the cron worker all resolve an
**actor**, then call the engine. Nothing else may call a provider adapter's
`execute()`.

```
Dashboard / MCP / Copilot / cron
            │  actor (user | ai | workflow | system) + typed command
            ▼
   ┌──────────────── Ads Command Engine ────────────────┐
   │ parse → snapshot → plan (diff) → policy → validate │  preview
   │ approve (who may?) → policy re-check → queued      │  approval
   │ claim → re-snapshot + hash check → write           │  execution
   │ read-back → succeeded | drifted → journey + cache  │  verification
   └──────────────┬───────────────────────┬─────────────┘
                  ▼                       ▼
         google-adapter.ts          meta-adapter.ts
       (GAQL + :mutate,           (Graph object read +
        validateOnly)              POST, validate_only)
```

## Ledger (migration `1305_ads_command_engine.sql`)

| Table | Purpose |
|---|---|
| `ads_change_requests` | One row per intended change: command payload, `before_state` + `before_hash`, `intended_state`, `diff`, `warnings`, policy verdict, risk, status, actor, approval, attempts, provider result, verification, `rollback_of`, `batch_id`. Unique `(org_id, idempotency_key)`. |
| `ads_change_events` | Append-only transition log. A trigger rejects UPDATE/DELETE (cascade from a deleted request/org still works). |
| `ads_account_policies` | Guardrails per org (`ad_account_id` NULL), per platform, or per account. |
| `ads_executions.change_request_id` | The journey timeline row links back to the ledger. |

Authenticated clients can only `SELECT` these tables. The server writes them
with the service-role client **after** it has authenticated the actor and
checked permissions, so a browser holding a user JWT cannot forge an approval
or a policy.

### Status machine

```
awaiting_approval ──approve──► queued ──claim──► executing ──► verifying ──► succeeded
        │                        ▲                   │                    └─► drifted
        ├─cancel─► cancelled     └──retry (transient,│
        └─deadline─► expired        max 5 attempts)  └─► failed
```

`draft` and `validating` exist in the schema for asynchronous validation of
large batches; today preview is synchronous and rows start at
`awaiting_approval`.

- **Optimistic concurrency.** `before_hash` is a SHA-256 of exactly the fields
  the command reads or writes. At execution the engine re-reads the resource;
  a different hash fails the change with `state_conflict` ("preview again").
- **Retries.** Transient errors (Google 429/5xx/RESOURCE_EXHAUSTED, Meta codes
  1/2/4/17/32/341/613/800xx, network) re-queue with 1, 2, 4, 8 min back-off,
  then fail as `retries_exhausted`. A retry that finds its own earlier write
  already applied (re-plan says `no_op` / `already_exists`) is marked
  `succeeded`, not `state_conflict`.
- **Auth errors** mark the connection unhealthy (Reconnect banner) and fail
  immediately — never retried.
- **Stuck rows** (`executing`/`verifying` for 15+ min) are reported by the
  worker, never auto-retried: whether the provider write landed is unknown.
- **Rollback** builds the inverse command from `before_state` and previews it
  as a *new* change with `rollback_of` — history is never rewritten. Adding a
  keyword rolls back to *pausing* it (removal is irreversible in Google Ads).

## Commands (`src/lib/ads/commands/catalog.ts`)

Money is always in **major units of the account currency** (50 = R$50). Risk:
1 reversible · 2 targeting · 3 strategy · 4 structural.

| Google Ads | Risk | Meta Ads | Risk |
|---|---|---|---|
| `google.campaign.set_status` | 1 | `meta.campaign.set_status` | 1 |
| `google.campaign.set_daily_budget` (warns on shared budgets) | 1 | `meta.campaign.set_daily_budget` (CBO only) | 1 |
| `google.campaign.rename` | 1 | `meta.campaign.rename` | 1 |
| `google.ad_group.set_status` | 1 | `meta.campaign.set_spend_cap` | 2 |
| `google.ad_group.rename` | 1 | `meta.adset.set_status` | 1 |
| `google.ad_group.set_cpc_bid` | 3 | `meta.adset.set_daily_budget` (ABO only) | 1 |
| `google.ad.set_status` | 1 | `meta.adset.rename` | 1 |
| `google.keyword.add` | 2 | `meta.adset.set_bid_amount` | 3 |
| `google.keyword.set_status` | 2 | `meta.adset.set_end_time` | 1 |
| `google.keyword.set_cpc_bid` | 3 | `meta.adset.update_targeting` (age, genders, countries, platforms) | 2 |
| `google.negative_keyword.add` (campaign / ad group) | 2 | `meta.ad.set_status` | 1 |
| `google.negative_keyword.remove` | 2 | `meta.ad.rename` | 1 |

Adding a capability = a schema + catalog entry here and the snapshot / plan /
operation / verify / rollback branches in the platform adapter. The adapter
tests in `tests/ads-*-adapter.test.ts` are the contract.

Meta snapshots verify the object's `account_id` equals the command's ad
account: one Meta token usually reaches several accounts, and without the
check a command scoped to account A could edit account B.

## Policies

Effective policy = defaults ← org row ← platform row ← account row (field by
field; `protected_campaign_ids` accumulate). `ADS_MAX_DAILY_BUDGET` (default
10 000) caps every policy.

| Field | Default | Effect |
|---|---|---|
| `max_daily_budget` | env ceiling | Above it → **blocked** for everyone |
| `max_budget_increase_pct` | 100 | Above it → approval |
| `allow_enable` / `allow_bidding_changes` / `allow_bulk` | true | false → blocked for AI, approval for humans |
| `protected_campaign_ids` | — | AI blocked, humans need approval |
| `ai_mode` | `propose` | `read_only` (AI can't propose) · `propose` (human approves in Ads → Changes) · `execute_with_confirmation` (AI confirms by echoing the preview's one-time token) |
| `require_approval_min_risk` | 3 | Human changes at/above → approval by an `ads.approve` holder |
| `approval_ttl_minutes` | 1440 | Pending changes expire |

A human holding `ads.approve` self-approves on submit (their click on the diff
*is* the approval). AI and workflow actors always need a confirmation — there
is no autonomous mode. Policies are re-checked at approval time.

Permissions: `ads.view`, `ads.manage` (request changes), `ads.approve`
(approve high-risk / AI changes), `ads.admin` (edit policies).

## Entry points

- **Dashboard API** — `POST /api/ads/changes {command, mode: preview|submit}`
  (or `{commands:[…]}` for a batch), `GET /api/ads/changes`,
  `GET|POST /api/ads/changes/:id {action: approve|cancel|rollback|retry}`,
  `GET|PUT /api/ads/policies`. The legacy
  `/api/ads/{google,meta}/campaigns` routes are thin wrappers that submit a
  command.
- **MCP** (`src/lib/mcp/tools/ads-control.ts`) — `ads_get_capabilities`,
  reads (`ads_google_search_terms`, `ads_google_list_keywords`,
  `ads_google_list_negative_keywords`, `ads_google_list_ad_groups`,
  `ads_google_list_ads`, `ads_meta_list_adsets`, `ads_meta_list_ads`), and the
  lifecycle (`ads_preview_change`, `ads_preview_changes`, `ads_approve_change`,
  `ads_get_change_status`, `ads_list_changes`, `ads_cancel_change`,
  `ads_rollback_change`). Every tool accepts `org_id`, so one MCP connection
  serves every client org the token's user belongs to.
- **Copilot** — `propose_ads_change` (preview only; the operator approves in
  Ads → Changes) and `list_ads_changes`.
- **Workflows** — no ads action exists yet. When one is added it must submit
  commands with a `workflow` actor, which the policy treats like the AI
  (always needs confirmation).

## Operations

- Worker: `GET /api/cron/ads-changes-tick` (Bearer `CRON_SECRET`) — executes
  due retries, expires stale approvals, reports stuck rows. Schedule it every
  1–2 minutes in skale-cron:
  `tick.sh XPHERE ads-changes-tick https://xphere.app/api/cron/ads-changes-tick 120 60`
- Apply the migration with `npx supabase db push` (never the MCP / SQL editor).

## Not yet built (next phases)

- Google: geo/language/ad-schedule targeting, Target CPA/ROAS, conversion
  goals, campaign dates, ad URL/tracking edits.
- Meta: custom/lookalike audiences, detailed placements, creative
  replacement, duplication (risk 4).
- Drift reconciliation from Google `change_event` / Meta activity log;
  per-account circuit breaker; batch approval in one click.
