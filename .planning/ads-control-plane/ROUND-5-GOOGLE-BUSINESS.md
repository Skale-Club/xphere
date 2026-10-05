# Ads Control Plane — Round 5: Google Business Profile

Goal: add the complete live Windsor `google_my_business` write surface to the
same guarded mutation path as Ads without coupling it to paid-media reporting.

## Shipped surface

| Windsor action | Xphere command | Risk |
|---|---|---|
| `create_local_post` | `google_business.local_post.create` | 4 |
| `update_local_post` | `google_business.local_post.update` | 2 |
| `reply_to_review` | `google_business.review.reply` | 3 |
| `upload_media` | `google_business.media.upload` | 4 |
| `update_location` | `google_business.location.update_info` | 2 |
| `update_service_items` | `google_business.location.update_service_items` | 2 |
| `update_categories` | `google_business.location.update_categories` | 4 |
| `update_service_area` | `google_business.location.update_service_area` | 3 |
| `update_attributes` | `google_business.location.update_attributes` | 2 |
| `update_address` | `google_business.location.update_address` | 4 |
| `set_regular_hours` | `google_business.location.set_regular_hours` | 2 |
| `set_special_hours` | `google_business.location.set_special_hours` | 2 |
| `set_open_status` | `google_business.location.set_open_status` | 4 |

## Boundaries

- OAuth uses `business.manage`; credentials remain AES-256-GCM encrypted and
  org-scoped in `ads_connections` under platform `google_business`.
- The connection key is the full `accounts/{account}/locations/{location}` so
  both Business Information v1 and the v4 Posts/Reviews/Media endpoints have
  the ids they require.
- Google Reviews via SerpAPI remains a separate read/widget path. It neither
  grants nor requires write access.
- Business Profile rows are excluded from paid-media daily snapshots, journey
  executions and report-cache invalidation; the immutable change ledger is the
  operational audit source.
- Location patches use Google's `validateOnly` where supported. v4 post,
  review and media operations receive Xphere schema preflight plus read-back.

## MCP

Six read/capability tools expose connected locations and current profile,
review, post and media state. All thirteen writes are available through the
existing generic `ads_preview_change` → explicit confirmation →
`ads_approve_change` → `ads_get_change_status` sequence. This keeps the exact
same one-time confirmation token, policy and optimistic-concurrency behavior.

Ten task-completion eval scenarios live in
`docs/mcp/google-business-evals.xml`.
