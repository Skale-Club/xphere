# Game analytics panels (BS-ANALYTICS-001)

Two read-only views over the game events that the tracking script stores as
`analytics_events.event_type = 'game'`. Plan and event model: the Brasil Showdown
repo, `games/brasil-showdown/docs/analytics/player-analytics-plan.md`.

| Panel | Route | Who | Client |
| --- | --- | --- | --- |
| Tenant "Game" tab | `/analytics` | any user of the organization | authenticated server client (RLS cuts to the active org) |
| Global game analytics | `/admin/analytics/game` | platform admin (`PLATFORM_ADMIN_EMAIL`) | service-role client |

There is no player-facing ranking and nothing public. Outcomes are reported by the
game client, so these numbers are for balance and product decisions, not for a
public leaderboard (that needs a server-validated result first).

## Data layer

- Migration `1332_analytics_game_events.sql`: views `game_events`,
  `game_match_facts` and the `game_stats_*` functions (picks, wins, matchups, match
  summary and daily, screen funnel / time / exits, DAU/WAU/MAU, retention, load
  times, error rate and breakdown).
- Migration `1333_analytics_game_panels.sql` (this change): `game_stats_player_summary`
  (distinct players, signed in vs guest, matches per player, session time),
  `game_stats_games` (organizations / games that have events, for the admin
  selectors) and `game_stats_pick_trend` (daily picks of the top N items).
- All functions are `SECURITY INVOKER` over `security_invoker` views, with no access
  for `anon`. A tenant user can pass any `p_org_id` and still only sees their own
  organization (RLS on `analytics_events` / `analytics_sessions`); the admin panel
  passes no org to read all of them. Apply with `npx supabase db push`; the panels
  fail closed (the tab stays hidden) until 1332 is applied.
- TypeScript: `src/lib/analytics/game-queries.ts` (1332 helpers),
  `game-player-queries.ts` (1333 helpers), `game-panels.ts` (loaders, input
  validation, pure view helpers).

## Tenant Game tab

`src/app/(dashboard)/analytics/_components/dashboard-view.tsx` wraps the existing
traffic cards in a "Traffic" tab, untouched, and shows a "Game" tab only when
`getGameAvailability(from, to)` finds at least one game event in the selected
period. The period selector is the page's own. Server actions in `actions.ts`:

- `getGameAvailability(from, to)`: cheap probe, `false` on any error so the traffic
  dashboard never breaks.
- `getGameDashboardData(from, to, tz)`: one call that loads every panel. `tz` is the
  browser's IANA zone and only decides the day buckets.

Content: players (active, signed in, guests, new accounts = CRM contacts created in
the period, DAU/WAU/MAU), matches (started / completed / abandoned, matches per
player, match and session time), D1/D7/D30 return, screen funnel
(title, fighter select, stage select, match, post match), exit screens, time per
screen, fighter / skin / stage picks, load p50/p95, error and crash-free rate, top
errors, and breakdowns by device, browser, OS, connection and source.

## Admin global panels

`/admin/analytics/game` (a "Game analytics" switch sits next to the existing traffic
overview). Filters: period (today to 90 days, this/last month), organization (or all),
game, device, source, guests / signed in. Server actions in
`game/_actions/game-admin-actions.ts` re-check `PLATFORM_ADMIN_EMAIL` themselves
before creating the service-role client and validate every filter
(`parseGameAdminInput`: ids, enums, time zone, window of at most 400 days).

Content: started / completed / abandoned, average and median duration, side
advantage (P1 vs P2), most and least picked fighters and stages, skin per fighter,
picks by segment (this vs previous period, device, guest vs signed in, top sources),
wins and win rate per fighter, matchup win-rate matrix, daily trends of matches and of
the top picks, DAU/WAU/MAU, retention cohorts, screen funnel and exit screens, load
p50/p95 by device and connection, error and crash-free rate by build and browser, top
errors.

## Known limits

- A guest who later signs in counts as a new actor (the actor is the player id, else
  the browser visitor).
- Retention ignores the device and source filters (they would change a cohort).
- Fighters, skins and stages nobody picked do not appear; the roster lives in the game.
- Not built yet (no data function): win rate vs CPU per difficulty, perfect-round and
  time-out rates, comeback rate, time to first match, device switches (ST-022).
- Reading `contacts` for "new accounts" is best effort: it shows "-" if the count
  cannot be read.

## Tests

`tests/analytics-game-panels.test.ts` (loaders, validation, helpers),
`analytics-game-tenant-actions.test.ts`, `analytics-game-admin-actions.test.ts`,
`analytics-game-player-queries.test.ts` (mocked rpc), and
`analytics-game-panels-migration.test.ts` (static contract, plus execution on
`@electric-sql/pglite` when installed; set `PGLITE_MODULE` to point at an install
outside the repo).
