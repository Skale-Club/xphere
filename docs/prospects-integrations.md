# Prospects — integration & operator guide

The Prospects module is a prospecting CRM inside Xphere built on a **unified
lifecycle model**: a prospect is a `contacts` or `accounts` row with
`lifecycle_stage = 'prospect'`, not a separate table. Xphere is the **hub** —
external products push records and events *into* Xphere, and Xphere calls *out*
to trigger actions. Nothing auto-promotes a prospect; conversion is always
deliberate.

```
 Xcraper ──push leads──▶ ┌─────────────────────────┐ ──outreach──▶ Xmail
                         │  Xphere  (Prospects hub) │ ◀──events────
 (scraped businesses)    │  /api/v1/prospects       │ ──visits────▶ Xpot
                         │  /api/integrations/*     │ ◀──outcomes──
                         └─────────────────────────┘
                                AI qualification (internal)
```

## Data model (migration 1158)

- `contacts` / `accounts` gain `lifecycle_stage`, `engagement_status`,
  `intent_level`, `qualification_status`, `score`, `recommended_channel`,
  `last_contacted_at`, `last_replied_at`, `last_visit_at`, plus `source_*`.
- `prospect_lists` + `prospect_list_members` — named lists (Lists module).
- `prospect_sources` — import/scrape runs (Sources module).
- `prospect_audiences` — saved segments (Audiences module).
- `prospect_conversions` — conversion history (Conversions module).
- `prospect_engagement_events` — the timeline fed by every integration.
- `contacts` / `accounts` also gain `email_status`, `email_verified_at`,
  `email_verification_provider`, `email_risk` (migration 1264) — email
  verification lives ON the prospect, not per-campaign, so it's checked once
  and every channel benefits. See "Email verification" below.

## Email verification (`src/lib/email-verification/`)

Verification status is the prospect's source of truth: `email_status` /
`email_verified_at` / `email_verification_provider` / `email_risk` live on the
`contacts`/`accounts` row itself (companies still keep the raw address in
`custom_fields.email` — only the verification *status* got real columns).

**Provider chain** (`providers.ts`): MillionVerifier (primary) → NeverBounce
(fallback). Each call normalizes onto `EmailStatus = ok | catch_all | unknown
| disposable | invalid | bounced`, or degrades to a typed failure
(`no_credits | unauthorized | unreachable | rate_limited`) — **never throws**.
`verifyEmail()` (`verify.ts`) tries MillionVerifier, falls through to
NeverBounce on any provider failure, and if both are unavailable returns
`{ blocked: true, reason: 'no_verification_credits' }` rather than guessing a
status. Env: `MILLIONVERIFIER_API_KEY`, `NEVERBOUNCE_API_KEY`, optional
`EMAIL_VERIFICATION_LOW_CREDIT_THRESHOLD` (default 500).

**Cache-first** (mandatory — this costs real money per call):
`verifyProspectEmail(orgId, kind, id, email, { force })` returns the row's
existing `email_status` untouched if it was verified within the last 90 days
and isn't `unknown`, without calling any provider. Otherwise it verifies and
persists all four columns. `verifyProspectsBatch()` runs this over many
prospects with a small (~5) concurrency cap and returns an aggregate count by
status plus a `blocked` count.

**Risk / sendability policy** (`risk-policy.ts`, re-exported from
`verify.ts` — change it in exactly one place):
`riskForStatus`: ok→low, catch_all/unknown→medium, disposable/invalid/bounced→high.
`isSendable`: ok/catch_all/unknown→true (catch_all and unknown are
deliberately sendable), disposable/invalid/bounced→false.

**Wired into outreach**: `prospects_enroll_in_campaign` verifies every
candidate before enrollment and filters out non-sendable ones; its
dry-run preview reports `{ verified_ok, catch_all, unknown, blocked_invalid,
blocked_no_credits }`. A confirmed call only stages leads in a `draft` or
`paused` Xmail campaign; it refuses active campaigns and never activates or
sends. If verification is blocked for lack of credits the response sets
`verification_unavailable: true` and nothing is enrolled.

**Consent gate**: before verification or import, the MCP outreach path honors
contact-level `dnd_enabled`/`dnd_channels` and the organization-scoped
`email_unsubscribes` table. Bulk preview reports `blocked_from_email`.
Suppression lookup fails closed, so an unavailable consent check cannot turn
into enrollment.

**`email_verification_status`** (MCP tool) returns
`getVerificationCreditStatus()` (per-provider configured/credits/ok, plus
`anyAvailable`/`lowCredit`) and a breakdown of the org's prospects by
`email_status`. Poll this on a schedule to alert on low credits.

**Automated verification trigger** (`/api/cron/prospect-verify-tick`, added
2026-09-30): `prospects_verify` (the MCP tool above) only runs when Hermes is
dispatched with MCP access — and Hermes has had none since 2026-08-30, so the
daily Xmail → Xcraper prospecting engine kept creating prospects with an
email that nothing ever verified (measured: 121 of 219 emailed prospects,
never checked). This cron closes that gap by reusing the exact same engine
(`verifyProspectsBatch`) and the exact same Xmail notification call
(`xmailNotifyVerificationComplete`) `prospects_verify` uses — it does not
reimplement verification, only the discovery/grouping around it.

- **Off by default.** No-ops (no query, no provider call) unless
  `PROSPECTING_AUTO_VERIFY=1` is set.
- **Daily spend cap**: `PROSPECTING_AUTO_VERIFY_MAX_PER_DAY` (default 100 —
  see the route file's header for the measured volume/cost this is sized
  against). Counted against ALL of today's `email_verified_at` stamps, not
  just this cron's own — see the route for why that is the more conservative
  reading of a shared-balance spend cap, given there is no per-caller
  attribution column and none is being added for this.
- **No credits**: stops before spending anything and reports
  `stopped_reason: 'no_credits'` loudly (error log + captured exception) —
  same "never guess a status" posture as `verifyEmail()` above. Also stops
  mid-tick if a batch comes back partially blocked.
- Discovers never-verified prospects (`email_status IS NULL`) across every
  org that have a linked `prospect_sources.external_run_id` (same
  `prospect_source_id` indirection `prospects_verify` and
  `src/lib/xmail/source-runs.ts` use), groups them by that run, and calls the
  shared verify+notify path once per run — so Xmail's Journey sees exactly
  the notifications a manual `prospects_verify` call would have produced.
  Prospects with no linked run are skipped and counted, never guessed at.

**Bounce feedback loop**: `/api/integrations/xmail/events` already logs
`bounced` events to the timeline; it now also stamps the prospect's
`email_status='bounced'`, `email_risk='high'`, `email_verified_at=now()`,
`email_verification_provider='bounce'` — a real bounce permanently marks the
address non-sendable across every channel and campaign, not just Xmail.

**Platform addresses** (`src/lib/prospects/platform-emails.ts`, 2026-10-07): an
email whose domain (or subdomain) belongs to a booking marketplace (booksy.com,
vagaro.com, ...) is that platform's support inbox, never the business's own
(measured: `help.us@booksy.com` on 38 accounts; 12 of 40 had already burned
credits and read `ok`). `verifyProspectEmail()` decides it by rule before any
provider call — `email_status='invalid'`, `email_verification_provider='platform_rule'`,
`email_risk='high'`, `email_verified_at` untouched (it is the cron's spend-cap
ledger) — and the batch aggregate counts it as `platform_email`, not `invalid`.
`prospects_import_to_xmail` holds it back first (`held_back.platform_email`,
`retained_for_review` reason `platform_email`) whatever its `email_status`;
`prospects_enroll_in_campaign` never enrols it; `prospects_list` flags it.
The domain list must stay in sync with Xmail's `src/server/lib/platform-emails.ts`
and Xcraper's `backend/src/services/emailPlaceholders.ts`.
`scripts/backfill-platform-emails.ts` (dry run by default, `--apply` to write)
applies the rule to existing rows and keeps the previous status in
`custom_fields.previous_email_status`.

## Inbound — how external systems reach Xphere

All inbound endpoints authenticate with an **Xphere API key** (`xph_…`, created
in **Settings → API Keys**) sent as `Authorization: Bearer …`. The key's org is
the target workspace.

| Endpoint | Scope | Purpose |
|----------|-------|---------|
| `POST /api/v1/prospects` | `prospects:write` | Ingest prospects (single or batch). Dedup by `source_id` → email/phone (person) / domain/name (company). |
| `POST /api/integrations/xmail/events` | any valid key | Xmail engagement events → timeline + `engagement_status`. |
| `POST /api/integrations/xpot/visits` | any valid key | Xpot visit outcomes → timeline + `last_visit_at`. |

## Outbound — how Xphere reaches the services (env-gated)

A bulk action only appears when its service is configured.

| Service | Env (on Xphere) | What Xphere calls |
|---------|-----------------|-------------------|
| Xmail | `XMAIL_API_URL`, `XMAIL_USER_ID`, `XMAIL_ORG_ID`, `XMAIL_SERVICE_KEY` | Lead import/enrollment plus `POST {XMAIL_API_URL}/api/outreach/prospecting/external-runs` for Journey registration (`x-user-id`, `x-service-key`) |
| Xpot | `XPOT_API_URL`, `XPOT_API_KEY` | `POST {XPOT_API_URL}/api/xpot/inbound/prospects` (Bearer) |

## The four integrations

### Xcraper (lead import) — repo `xcraper`
Scraped businesses → company prospects. On the search-results view, **Push to
Xphere** calls `pushRunToXphere`, which posts the run's contacts to
`/api/v1/prospects` (`source.type=xcraper`, `external_run_id`). Dedup key is the
Google Place ID. The Xcraper metadata includes query, location, result count,
and measured `cost_usd`. Xphere automatically registers that external run in
Xmail's Journey ledger, then propagates its id as `source_run_id` when the
prospect later becomes an Xmail lead. Env: `XPHERE_API_URL`, `XPHERE_API_KEY`.

### Xmail (email outreach) — repo `skaleclub-mail` (config only)
The **Start outreach** bulk action resolves each prospect's email and bulk-imports
them as Xmail leads. Xmail runs the sending and POSTs engagement events back to
`/api/integrations/xmail/events`, which maps `sent/opened/clicked/replied/
bounced/unsubscribed` onto the timeline and `engagement_status`. **Replies update
engagement only — never lifecycle.** Xmail needs no code changes: point an Xmail
webhook at the Xphere endpoint (with the workspace API key) and set `x-user-id`.

The Hermes-facing Xphere MCP exposes no direct 1:1 email or SMS send tool.
Direct prospect replies remain human-controlled. Campaign enrollment accepts
only inactive campaigns; first activation is requested and executed through
Xmail's durable interactive approval flow.

### Meta/Facebook Custom Audiences

Xphere can reconcile either every scraped prospect (`xcraper_master`) or an
explicit saved prospect segment into a tenant-owned Meta Custom Audience. The
projection normalizes identifiers locally and sends SHA-256 hashes only. It
excludes deleted/duplicate records, contact DND, `engagement_status` opt-outs,
and organization-scoped `email_unsubscribes` before any Graph API mutation.

Hermes uses `meta_audiences_status` to inspect configuration and
`meta_audience_sync` without confirmation for a count-only preview. A real
ADD/REMOVE reconciliation requires `confirmed:true`, an active tenant Meta
connection, accepted Customer List terms, and `sync_enabled=true`. The MCP
response never includes raw identifiers, hashes, or access tokens.

### Xpot (field visits) — repo `xpot`
The **Send to Xpot** bulk action posts prospects to `/api/xpot/inbound/prospects`,
which creates prospect-stage `sales_leads` carrying `xphere_ref`
("contact:uuid" / "account:uuid", migration 0005). On visit check-out,
`syncVisitToXphere` posts the outcome back to `/api/integrations/xpot/visits`,
stamping `last_visit_at` and the timeline. Env on Xpot: `XPHERE_INBOUND_API_KEY`
(= Xphere's `XPOT_API_KEY`), `XPHERE_API_URL`, `XPHERE_API_KEY`.

### AI qualification (internal)
In the prospect detail sheet, **Suggest** proposes `intent_level`,
`qualification_status`, and `recommended_channel` from engagement signals with an
explainable rationale (deterministic today; an LLM scorer can slot into
`suggestQualification`). **Apply** writes it and logs a `status_changed` event. AI
never converts.

## Operator wiring checklist

1. **Xphere → Settings → API Keys**: create a key with the `prospects:write` scope.
   Copy the `xph_…` token.
2. **Xcraper** env: `XPHERE_API_KEY=<token>` (+ `XPHERE_API_URL` if not prod).
   → "Push to Xphere" appears on the search-results view.
3. **Xmail**: set `XMAIL_API_URL` + `XMAIL_USER_ID` + `XMAIL_ORG_ID` +
   `XMAIL_SERVICE_KEY` on Xphere; in Xmail, add a webhook to
   `https://xphere.app/api/integrations/xmail/events` authorized with the
   `xph_…` token, subscribed to the engagement events.
4. **Xpot**: apply migration `0005` (`drizzle push`); set `XPHERE_INBOUND_API_KEY`
   (any shared secret) + `XPHERE_API_KEY=<token>` on Xpot; set `XPOT_API_URL` +
   `XPOT_API_KEY=<same shared secret>` on Xphere. → "Send to Xpot" appears.
5. Before outreach, run the MCP dry-run, verify `blocked_from_email`, email
   verification credits, campaign sequence, and assigned sending inbox. Use
   `confirmed:true` only after explicit human approval.

All connection config is environment-driven — no product domains are hardcoded.
