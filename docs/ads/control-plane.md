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
- **Circuit breaker.** When an ad account has 5+ transient failures in 10
  minutes, further executions for that account re-queue for 10 minutes
  (`circuit_open`) without spending an attempt or calling the platform.
- **External drift.** The worker re-reads changes applied in the last 7 days
  (each at most every 6 h) and, when the platform no longer matches what Xphere
  set and no later Xphere change touched the same resource, records
  `external_drift` + an `external_change_detected` event (migration 1306). The
  change stays `succeeded` — it did apply; the drift is a separate fact, shown
  in Ads → Changes and in the MCP change views. A failed read is never treated
  as drift.
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
| `google.campaign.set_dates` (`yyyy-MM-dd HH:mm:ss`, account TZ) | 1 | `meta.adset.update_targeting` also: `facebook_positions`, `instagram_positions`, `custom_audience_ids`, `excluded_custom_audience_ids` | 2 |
| `google.campaign.set_tracking` (template / final URL suffix) | 1 | `meta.campaign.set_bid_strategy` (CBO only) | 3 |
| `google.campaign.add_location` / `remove_location` (incl. exclusions) | 2 | `meta.adset.set_bid_strategy` (+ bid_amount / roas_floor) | 3 |
| `google.campaign.add_language` / `remove_language` | 2 | `meta.ad.set_creative` (existing creative, same account) | 4 |
| `google.campaign.add_ad_schedule` / `remove_ad_schedule` (overlap-checked) | 2 | `meta.campaign.duplicate` / `meta.adset.duplicate` / `meta.ad.duplicate` (copies always PAUSED) | 4 |
| `google.ad.set_final_url` | 2 | | |
| `google.campaign.set_target_cpa` / `set_target_roas` (TARGET_* or MAXIMIZE_* strategies; portfolio → error) | 3 | | |
| `google.conversion_action.set_primary` | 3 | | |
| `google.campaign.set_conversion_goal_biddable` | 3 | | |

Each adapter lists the commands it implements (`capabilities()` from an
explicit `IMPLEMENTED` set); a catalog entry without an implementation is
refused at preview as `unsupported_command`. Duplicates have no automatic
rollback (the copy is created paused — pause/archive it if unwanted).

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
  `POST /api/ads/changes/batches/:batchId {action: approve|cancel}`,
  `GET|PUT /api/ads/policies`. The legacy
  `/api/ads/{google,meta}/campaigns` routes are thin wrappers that submit a
  command.
- **MCP** (`src/lib/mcp/tools/ads-control.ts`) — `ads_get_capabilities`,
  reads (`ads_google_search_terms`, `ads_google_list_keywords`,
  `ads_google_list_negative_keywords`, `ads_google_list_ad_groups`,
  `ads_google_list_ads`, `ads_meta_list_adsets`, `ads_meta_list_ads`), and the
  Google targeting/conversion reads (`ads_google_suggest_locations`,
  `ads_google_list_campaign_targeting`, `ads_google_list_conversion_actions`,
  `ads_google_list_conversion_goals`), Meta asset reads
  (`ads_meta_list_custom_audiences`, `ads_meta_list_creatives`), and the
  lifecycle (`ads_preview_change`, `ads_preview_changes`, `ads_approve_change`,
  `ads_approve_changes`,
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
  due retries, expires stale approvals, reconciles recently applied changes,
  reports stuck rows. It stops starting new work after ~60 s (Cloudflare cuts
  proxied requests at 100 s); schedule it every 1–2 minutes in skale-cron
  against the origin host:
  `tick.sh XPHERE ads-changes-tick https://origin.xphere.app/api/cron/ads-changes-tick 120 90`
- Apply the migration with `npx supabase db push` (never the MCP / SQL editor).

## Not yet built (next phases)

- Google: creating campaigns / ad groups / responsive search ads, shared
  negative lists, audience segments, device bid modifiers.
- Meta: creating creatives from assets, lookalike creation, Advantage+
  shopping specifics, dynamic creative.
- Workflows: an allowlisted "submit ads command" action (runs as a `workflow`
  actor, always needs confirmation).
