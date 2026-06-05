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
| Xmail | `XMAIL_API_URL`, `XMAIL_USER_ID` | `POST {XMAIL_API_URL}/api/outreach/leads/bulk-import` (`x-user-id`) |
| Xpot | `XPOT_API_URL`, `XPOT_API_KEY` | `POST {XPOT_API_URL}/api/xpot/inbound/prospects` (Bearer) |

## The four integrations

### Xcraper (lead import) — repo `xcraper`
Scraped businesses → company prospects. On the search-results view, **Push to
Xphere** calls `pushRunToXphere`, which posts the run's contacts to
`/api/v1/prospects` (`source.type=xcraper`, `external_run_id`). Dedup key is the
Google Place ID. Env: `XPHERE_API_URL`, `XPHERE_API_KEY`.

### Xmail (email outreach) — repo `skaleclub-mail` (config only)
The **Start outreach** bulk action resolves each prospect's email and bulk-imports
them as Xmail leads. Xmail runs the sending and POSTs engagement events back to
`/api/integrations/xmail/events`, which maps `sent/opened/clicked/replied/
bounced/unsubscribed` onto the timeline and `engagement_status`. **Replies update
engagement only — never lifecycle.** Xmail needs no code changes: point an Xmail
webhook at the Xphere endpoint (with the workspace API key) and set `x-user-id`.

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
3. **Xmail**: set `XMAIL_API_URL` + `XMAIL_USER_ID` on Xphere; in Xmail, add a
   webhook to `https://xphere.app/api/integrations/xmail/events` authorized with
   the `xph_…` token, subscribed to the engagement events.
4. **Xpot**: apply migration `0005` (`drizzle push`); set `XPHERE_INBOUND_API_KEY`
   (any shared secret) + `XPHERE_API_KEY=<token>` on Xpot; set `XPOT_API_URL` +
   `XPOT_API_KEY=<same shared secret>` on Xphere. → "Send to Xpot" appears.
5. Promote the Xphere `dev` branch to `main` to deploy; merge the
   `feat/xphere-integration` branches in `xcraper` and `xpot`.

All connection config is environment-driven — no product domains are hardcoded.
