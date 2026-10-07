# Meta Custom Audiences

`Settings → Integrations → Meta Audience` (`/settings/integrations/meta-audience`).
One `meta_audience_config` row per audience, per tenant, per ad account. The same
reconciler (`src/lib/meta/audience-reconcile.ts`) and hourly job
(`scripts/meta-audience-sync.ts`, `.github/workflows/meta-audience-sync.yml`)
serve every kind.

| Kind | Purpose | Who is in it | How it reaches Meta |
|---|---|---|---|
| `xcraper_master` | Prospecting | Every scraped prospect (`lifecycle_stage='prospect'`, source `xcraper`/`google-maps`) | Hashed email/phone, ADD/REMOVE diff |
| `prospect_segment` | Prospecting | Explicit members of a saved prospect segment | Hashed email/phone, ADD/REMOVE diff |
| `crm_contacts` | Remarketing | CRM contacts by lifecycle stage (default lead + opportunity + customer), optionally narrowed by `source`, `source_type`, any-of tags | Hashed email/phone, ADD/REMOVE diff |
| `pixel_website` | Remarketing | Pixel events (any-of) within a retention window (1–180 days), optional URL fragment | Rule audience created once; Meta maintains membership |

All list kinds share the same suppression: DND, unsubscribed, suppressed email,
archived duplicates and deleted rows are never uploaded and are REMOVEd if they
were. Contacts leaving a scope (e.g. a lead marked `lost`) are removed on the next
pass. Only hashes are stored (`meta_audience_memberships`).

## Remarketing pack

The "Remarketing pack" card creates the standard set for one ad account:

- `<Org> | Site Visitors 30D` — Pixel `PageView`, 30 days
- `<Org> | Site Visitors 180D` — Pixel `PageView`, 180 days
- `<Org> | Site Form Submitters 180D` — Pixel `Lead`, `Contact`, `CompleteRegistration`, `SubmitApplication`, `Schedule`
- `<Org> | CRM Leads` — lead + opportunity + customer
- `<Org> | CRM Customers` — customer (use as an exclusion)

Pixel audiences are skipped when no Pixel is chosen. Re-running it skips audiences
whose kind and scope already exist on that ad account. New audiences start enabled
when the connection passes the normal Enable preflight.

## Freshness

- New contacts (`contact.created`, `contact.captured`) mark the org's `crm_contacts`
  audiences dirty, and the next job run picks them up.
- Every enabled audience is reconciled at least hourly (`next_sync_at`). The
  scheduler is GitHub Actions cron, so in practice runs are a few hours apart.

## Pixel requirements

A `pixel_website` audience only fills if the site actually sends those events to
that Pixel. Check the Pixel in Events Manager: a form-submitter audience needs a
standard lead event (`Lead`, `Contact`, …). Custom events such as `form_open` do
not count. The Xphere tracker fires `PageView`, plus `Lead` on every form submit,
when the org has Meta CAPI with the browser Pixel enabled (`/ads/capi`).
