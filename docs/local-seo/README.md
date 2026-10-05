# Local SEO — runbook

Module plan: [`.planning/local-seo/SPEC.md`](../../.planning/local-seo/SPEC.md).
Code: `src/lib/local-seo/`, UI under `/local-seo`.

## What runs where

| Piece | Path | Schedule |
|---|---|---|
| Geogrid worker tick | `GET /api/cron/local-seo-tick` | every minute (skale-cron) |
| Housekeeping (60-day SERP retention, stuck scans) | `GET /api/cron/local-seo-maintenance` | daily (skale-cron) |
| DataForSEO postback | `POST /api/local-seo/providers/dataforseo/postback?secret=…` | pushed by DataForSEO |

Both cron routes need `Authorization: Bearer $CRON_SECRET` and fail closed (503)
without it. Point skale-cron at `https://origin.xphere.app` (Cloudflare cuts
proxied requests at 100 s; the tick spends at most ~55 s):

```
* * * * *   local-seo-tick         GET https://origin.xphere.app/api/cron/local-seo-tick         expected 60s
17 4 * * *  local-seo-maintenance  GET https://origin.xphere.app/api/cron/local-seo-maintenance  expected 86400s
```

"Scan now" also runs one tick right after the scan is created (`after()`), so a
manual scan starts even before the cron is wired; scheduled scans need the cron.

## Configuration

| Setting | Where | Purpose |
|---|---|---|
| `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` | Admin → Settings → Local SEO (or env) | Primary rank provider (async, ~US$0.0006/point) |
| `SERPAPI_API_KEY` | Admin → Settings → Local SEO (or env) | Fallback provider (sync, ~US$0.015/point) and the business search when adding a location |
| `LOCAL_SEO_POSTBACK_SECRET` | runtime env | Secret in the DataForSEO postback URL. Without it the worker polls `task_get` instead (results arrive ~2 min later) |
| `LOCAL_SEO_POSTBACK_ORIGIN` | runtime env, optional | Public origin for the postback URL; defaults to `NEXT_PUBLIC_SITE_URL` |
| `GOOGLE_MAPS_BROWSER_KEY` | runtime env | Maps JavaScript API key for the geogrid map. Restrict it by HTTP referrer to `xphere.app`. Without it the UI shows the map-free SVG grid |
| `GOOGLE_MAPS_MAP_ID` | runtime env, optional | Map ID for Advanced Markers. Falls back to `DEMO_MAP_ID` (fine for testing; create a real one in Cloud Console for production) |
| `LOCAL_SEO_PROVIDER` | runtime env, optional | Force `dataforseo`, `serpapi` or `fake`. `fake` is an offline deterministic provider for dev/QA |
| `LOCAL_SEO_DISABLED=true` | runtime env | Kill switch: no new scans anywhere |
| `LOCAL_SEO_DAILY_POINT_CAP` | runtime env, default 20000 | Platform-wide ceiling of billable points per UTC day |
| `LOCAL_SEO_UNPLANNED_POINTS_MONTH` | runtime env, default 500 | Monthly points for orgs without a plan while billing enforcement is off |

Runtime env goes through `coolify-set-envs.yml` (manual dispatch), not the build.

## Quota

One grid point = one point of quota. Plan limits live in
`src/lib/billing/catalog.ts` (`local_seo_points_month`: Starter 0, Pro 1,000,
Enterprise 10,000). Unlike the other billing guards, the points quota is
enforced even while `BILLING_ENFORCEMENT_ENABLED` is off, because every point
is real provider spend. Usage is `local_seo_usage_ledger` (one row per scan;
`billable=false` for the fake provider).

## Metrics

- **ARP** — average rank where the business appears (1–20).
- **ATRP** — average over all points, a miss counting as 21.
- **SoLV** — % of points with rank ≤ 3.
- **Found** — % of points with rank ≤ 20.

Failed points are excluded (unknown, not a miss). A scan with any failed point
ends `partial`. Scans are only compared when their `comparable_key` matches
(same keyword, language, grid, zoom, centre and provider).

## Tracking, alerts and automation (Phase 2)

- **Schedules** (`local_seo_schedules`): daily / weekly / every 2 weeks /
  monthly at an hour in UTC; `minute_utc` is random so schedules spread over
  the hour. The tick claims due schedules with a conditional update (no double
  runs) and creates one scan per keyword through `createScan()`, so the quota
  applies. A quota error is stored in `last_error` and the schedule still moves
  to its next run.
- **Alerts** (`local_seo_alert_rules` → `local_seo_alerts`): metric + direction
  (`worse` respects polarity: lower SoLV/Found, higher ARP/ATRP) + threshold,
  compared with the previous scan with the same `comparable_key`. A fired alert
  creates an in-app notification (`local_seo_alert`, with push). One alert per
  scan per rule.
- **Workflow events**: `event:local_seo.scan_completed` (every finished scan) and
  `event:local_seo.rank_changed` (any metric moved; `change.<metric>` has
  `{from, to, delta, worse}`). Route alerts to email / Slack / Telegram with a
  workflow instead of a hardcoded channel.
- **Workflow action** `local_seo_run_scan` (`location_id`, optional
  `keyword_id`, `grid_size`) — quota-checked like the UI.
- **MCP tools**: `localseo_list_locations`, `localseo_list_scans`,
  `localseo_get_scan`, `localseo_get_competitors`, `localseo_trigger_scan`.
- **Annotations** (`local_seo_annotations`) are drawn on the Trends chart.
- **Competitors**: ranked by SoLV from each scan's snapshot; pinned competitors
  (`local_seo_competitors`) get a SoLV-over-time line next to the business.
  "View as" on the Rankings map recolours the grid by a competitor's rank.

## Google Business Profile (Phases 3 and 4)

**Before it can work** (human steps, see SPEC section 1):
1. Request Business Profile API access for the Google Cloud project behind
   `GOOGLE_CLIENT_ID`. Until Google approves, every call returns quota 0 and
   the location picker says so.
2. Enable these APIs on the project: My Business Account Management, My
   Business Business Information, Business Profile Performance, and the
   Google My Business API (v4, reviews and posts).
3. Add the redirect URI `https://xphere.app/api/local-seo/gbp/callback` to the
   OAuth client, and the `business.manage` scope to the consent screen.
   Verify the app: in Testing mode refresh tokens die after 7 days.
4. Add the cron below to skale-cron.

```
*/15 * * * *  gbp-sync-tick  GET https://origin.xphere.app/api/cron/gbp-sync-tick  expected 900s
```

**Flow:** Settings → Connect a Google account (needs `local_seo.admin`) → Pick
location. The tick then syncs reviews every 15 min (oldest first) and, once a
day per location, the profile snapshot and performance (90 days back the
first time, then the last 10 days; search keywords for the last 3 months).

**Every write goes through `gbp_change_requests`** (`src/lib/gbp/commands.ts`):
propose → (approve) → execute → read back. A person with `local_seo.approve`
approves by submitting; members, workflows and AI always wait for approval.
The only automatic writes are the org's opt-in auto-reply for 4–5★ reviews
and posts scheduled by an approver. Profile edits check for drift (the field
changed after the preview) and use `validateOnly` before writing; a published
edit can be rolled back. Successful profile edits and posts become annotations
on the Trends chart.

**Detection:** a daily snapshot is compared with the previous one; a change
not made through Xphere, or Google's `hasGoogleUpdated` flag, raises an alert
(in-app), an annotation and `event:gbp.google_update_detected`.

**Widget:** once a reviews profile's business is connected and synced, the
public widget (`/api/reviews/[token]`) serves the official reviews with the
same output contract; otherwise it keeps the SerpAPI scrape.

**Workflows:** triggers `event:gbp.review_received`, `event:gbp.review_negative`
(≤ 3★), `event:gbp.google_update_detected`; actions `gbp_draft_review_reply`,
`gbp_propose_post`, `gbp_propose_profile_change` (propose only). **MCP:**
`gbp_list_reviews`, `gbp_create_reply_draft`, `gbp_propose_change`.

| Setting | Purpose |
|---|---|
| `GBP_REPLY_MODEL` | OpenRouter model for reply drafts (default `anthropic/claude-haiku-4.5`) |

## Data retention

`local_seo_serp_results` (top 20 per point) is pruned after 60 days. Each point
keeps its rank and `top3`, and each scan its `local_seo_competitor_snapshots`,
so maps, trends and competitor history survive pruning.

## Troubleshooting

- **Scan stuck in Running** — is the tick running? Check `cron_heartbeats`
  (`local-seo-tick`). Async points with no postback are polled after 2 min and
  failed after 2 h; sync points abandoned by a dead tick are re-queued after
  10 min.
- **"No rank provider is configured"** — add the DataForSEO pair or a SerpAPI key
  in Admin → Settings → Local SEO.
- **Scan failed with an auth/quota message** — the provider rejected the key or
  the account is out of balance; every unfinished point of the scan is stopped.
