# Credential rotation and retention activation — 2026-11-05

The owner explicitly authorized all three follow-ups: rotate the Coolify token
and Supabase database password, delete `.env.local.bak-pre-dev`, and enable
screenshot deletion plus 30-day chat-media retention.

## Credentials and backup

- Rolled Coolify token id 1 through the provider's native `PersonalAccessToken.roll()`.
  Its existing permissions, scopes, team, and expiry were preserved.
- Updated `Skale-Club/xphere`'s `COOLIFY_TOKEN` GitHub secret and the token in
  `skaleclub-apps/.env`. A new-token API request returned 200; the old token
  returned 401. No token values were logged or committed.
- Supabase dev database password rotation is **blocked**: the management token
  returns 403 for this project, and changing the protected `postgres` role from
  its SQL connection returned SQLSTATE 42501. The original password still works;
  `.env.local` was not changed. Removed the unused staged URL and encrypted
  recovery file generated for this failed attempt. Owner-level Supabase access
  is required to finish this item.
- Deleted the specifically named `.env.local.bak-pre-dev` after verifying,
  without displaying the key, that its production encryption key still matches
  the one configured in the running production app.

## Required runtime fix

Production now uses all nine R2 logical buckets and runs imports, embeddings,
and push delivery in the app. The earlier Supabase Edge Function deployment
blocker from the initial R2 cutover no longer applies.

Legacy expired files are still physically in Supabase Storage, although the
corresponding analysis/message rows are now in the new Postgres. The database
service JWT signed by the app was rejected by Supabase Storage (HTTP 400);
the original Supabase service credential succeeded (HTTP 200).

`createDbExitFetch` now uses the original Supabase service credential only when
an exact old Storage URL is called with this app's database service token.
REST requests keep the new token and internal database destination. User and
anonymous tokens, other origins, lookalike origins, and Auth paths receive no
credential upgrade.

Permanent regression coverage was added in `tests/db-exit.test.ts`.
The focused database-exit/storage/retention suites passed (110 tests); the
critical battery and all workflow definitions passed. The local Next.js build
was stopped at the user's request because it burdened their PC; the production
build will run in GitHub Actions.

## Retention

Before activation, production reported both flags disabled. Simulation:

- Screenshots: 4,876 eligible analysis rows; the capped pass selected 300 rows
  and 600 objects, without deleting or clearing anything.
- Chat: 929 eligible messages; the remaining time budget selected 169 messages
  and objects, without deleting or flagging anything.
- Size estimates were unavailable with the invalid Storage credential.

The existing `skale-cron` schedule invokes `/api/cron/storage-retention` at
minute 41 of every hour (UTC), with the established bearer authentication.
Each run is bounded to 60 seconds and reports when further runs are needed.

Activation and first live-run results: pending deployment of the runtime fix.
Retention deletes only expired attachments and screenshot objects, preserves
message text and analysis rows, and marks affected messages as expired.
