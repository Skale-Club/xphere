# Ads Control Plane — Round 4: Windsor parity

Goal: every write action Windsor.ai exposes for Google Ads and Meta Ads
(checked live via `list_actions` on 2026-09-27) exists in Xphere, through the
Command Engine (preview → policy → validate-only → approval → write →
read-back → ledger). Creates stay PAUSED; no autonomous mode.

## Architecture change (coordinator, first)

`google-adapter.ts` (1.7k lines) and `meta-adapter.ts` (1.1k) are too big to
extend in parallel. New commands live in **handler modules**:

```
src/lib/ads/providers/handlers.ts        CommandHandler contract + registry
src/lib/ads/providers/google/*.ts        one module per capability area
src/lib/ads/providers/meta/*.ts
```

A `CommandHandler` implements snapshot / plan / validate / execute / verify /
buildRollback for a set of command types. Both adapters consult the registry
first; existing commands stay where they are.

## Gap list → commands

### Google (vs Windsor)
| Windsor action | Xphere command | Risk | Module |
|---|---|---|---|
| set_campaign_bidding_strategy | `google.campaign.set_bidding_strategy` (manual_cpc, maximize_clicks, maximize_conversions [+tCPA], maximize_conversion_value [+tROAS]) | 3 | google/bidding |
| set_cpc_bid_ceiling | `google.campaign.set_cpc_bid_ceiling` | 3 | google/bidding |
| set_campaign_budget (total) | `google.campaign.set_total_budget` | 2 | google/bidding |
| set_campaign_geo_targeting (radius) | `google.campaign.add_proximity` (+ remove_location accepts PROXIMITY) | 2 | google/bidding |
| remove_keywords | `google.keyword.remove` (rollback = re-add same text/match) | 2 | google/bidding |
| create_campaign (Display) | `google.campaign.create_display` (+ ad_group.create derives DISPLAY_STANDARD) | 4 | google/bidding |
| create_ad_asset | `google.asset.create_and_link` (sitelink, callout, structured_snippet, call), `google.asset.unlink` | 2 | google/assets |
| create/rename/delete_customer_match_list | `google.user_list.create`, `google.user_list.rename`, `google.user_list.remove` | 3 | google/customer-match |
| upload_customer_match_list | `google.user_list.upload` (SHA-256 hashes only — raw PII never enters the ledger) | 3 | google/customer-match |
| attach/detach_user_list | `google.user_list.attach`, `google.user_list.detach` | 2 | google/customer-match |
| get_customer_match_upload_status | MCP read `ads_google_user_list_upload_status` | — | google/customer-match |

### Meta (vs Windsor)
| Windsor action | Xphere command | Risk | Module |
|---|---|---|---|
| create_adset | `meta.adset.create` (targeting, optimization, billing, budget daily/lifetime, bid, promoted_object, destination, DSA / regional regulation) | 4 | meta/adsets |
| set_*_budget (lifetime) | `meta.campaign.set_lifetime_budget`, `meta.adset.set_lifetime_budget` | 2 | meta/adsets |
| update_adset (optimization, DSA, regional, raw targeting) | `meta.adset.update_settings`, `meta.adset.replace_targeting` | 3 | meta/adsets |
| update_campaign (special categories) | `meta.campaign.update_settings` | 2 | meta/adsets |
| create_ad_image | `meta.media.upload_image` (from https URL, server-side fetch with SSRF guard) | 1 | meta/creatives |
| create_ad_video | `meta.media.upload_video` (file_url, waits for ready) | 1 | meta/creatives |
| create_ad (inline creative) | `meta.ad.create_with_creative` (link / image / video / click-to-message) | 4 | meta/creatives |
| update_ad_creative | `meta.ad.update_creative` (copy, headline, description, link, image, CTA, url_tags, carousel card) — rollback repoints to the old creative | 3 | meta/creatives |
| boost_post | `meta.post.boost` | 4 | meta/creatives |
| set_page_welcome_message | `meta.ad.set_welcome_message` | 2 | meta/creatives |

## Cross-cutting (coordinator)
- `src/lib/ads/safe-fetch.ts`: https-only, public-IP-only, size-capped fetch
  for media uploads (the URL comes from an AI client).
- Customer Match: MCP tool accepts raw emails/phones or an Xphere CRM tag,
  normalizes + hashes server-side, and submits hashes only.
- Catalog entries, MCP reads, docs, capabilities test, workflow allowlist
  (all new commands except risk ≤ 2 stay out of workflows automatically).

## Verification
- Unit tests per module (wire payloads, snapshots, rollback, errors).
- Full suite diff vs main, build.
- Live smoke test, preview-only (validate), on the Bigode Google account and
  the Skale Club Meta account; cancel every preview; confirm accounts unchanged.
- Ship: PR → merge → deploy → health.
