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
