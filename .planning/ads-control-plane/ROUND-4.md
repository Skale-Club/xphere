# Ads Control Plane — Round 4: Windsor parity

Goal: every write action Windsor.ai exposes for Google Ads and Meta Ads
(checked live via `list_actions` and parameter schemas on 2026-10-05) exists in Xphere, through the
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
| advanced ad-group / geo / political parameters | `google.ad_group.set_rotation_mode`; location/proximity `bid_modifier`; create Search/Display `contains_eu_political_advertising` | 1–4 | google/advanced + base/bidding |
| advanced Customer Match parameters | list membership life span (including no-expiration `10000`), postal identifiers, ADD/REMOVE jobs, TARGETING/OBSERVATION attach mode | 1–3 | google/customer-match |

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
| advanced campaign/ad parameters | lifetime campaign budget, ad-set budget sharing, ad `conversion_domain` / `display_sequence` | 2–4 | base adapter |
| full advanced ad/ad-set payloads | `meta.ad.create_from_spec`; guarded `extra_params` on ad-set create/update; `degrees_of_freedom_spec`; rich `welcome_message_spec` | 2–4 | meta/adsets + meta/creatives |
| create_ad_images | `meta.media.upload_images` (1–20 images, 100 MB aggregate) | 1 | meta/creatives |

## Cross-cutting (coordinator)
- `src/lib/ads/safe-fetch.ts`: https-only, public-IP-only, size-capped fetch
  for media uploads (the URL comes from an AI client).
- Customer Match: MCP tool accepts raw emails/phones/postal identifiers or an
  Xphere CRM tag, normalizes + hashes names/emails/phones server-side, and
  never returns raw input. Country and postal code follow Google's required
  unhashed address format inside the protected change payload.
- Catalog entries, MCP reads, docs, capabilities test, workflow allowlist
  (all new commands except risk ≤ 2 stay out of workflows automatically).

## Advanced-parameter parity addendum (2026-10-05)

The MCP does not need one bespoke tool per mutation. `ads_get_capabilities`
publishes the catalog schemas, while `ads_preview_change(s)` and
`ads_approve_change(s)` accept every implemented command above. The only
special write helper remains Customer Match, because it must hash raw PII
before the command enters the ledger.

Meta's rapidly changing ad-set fields are exposed through `extra_params`, but
only safe Graph field names are accepted and core fields cannot be overridden.
The change still receives a diff, Meta `validate_only`, approval, read-back,
and ledger entry. This is the compatibility path for advanced Windsor fields
that do not warrant a permanent first-class Xphere command.

## Verification
- Unit tests per module (wire payloads, snapshots, rollback, errors).
- Full suite diff vs main, build.
- Live smoke test, preview-only (validate), on the Bigode Google account and
  the Skale Club Meta account; cancel every preview; confirm accounts unchanged.
- Ship: PR → merge → deploy → health.
