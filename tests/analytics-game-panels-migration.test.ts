// tests/analytics-game-panels-migration.test.ts
// BS-ANALYTICS-001: migration 1333_analytics_game_panels.sql (player summary,
// games list, daily pick trend) and the TypeScript helpers that call it.
//
// Two layers, like tests/analytics-game-migration.test.ts:
//   1. Static contract checks (always run).
//   2. Execution against an in-process Postgres (@electric-sql/pglite), only when
//      pglite is installed (npm i --no-save @electric-sql/pglite, or point
//      PGLITE_MODULE at an install outside the repo). Never touches a real database.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const MIGRATIONS = path.resolve(__dirname, '../supabase/migrations')
const base = readFileSync(path.join(MIGRATIONS, '1332_analytics_game_events.sql'), 'utf8')
const sql = readFileSync(path.join(MIGRATIONS, '1333_analytics_game_panels.sql'), 'utf8')
const sqlNoComments = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n')

describe('migration 1333: static contract', () => {
  it('has no SECURITY DEFINER function and never touches anon grants except to revoke', () => {
    expect(sqlNoComments.toUpperCase()).not.toContain('SECURITY DEFINER')
    expect(sqlNoComments).toMatch(/REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon/)
    expect(sqlNoComments).toMatch(/GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role/)
    expect(sqlNoComments).not.toMatch(/GRANT[^;]*\banon\b/)
  })

  it('is idempotent: every function is dropped before it is created', () => {
    const created = [...sqlNoComments.matchAll(/CREATE OR REPLACE FUNCTION public\.(game_stats_\w+)/g)].map((m) => m[1])
    expect(created.sort()).toEqual(['game_stats_games', 'game_stats_pick_trend', 'game_stats_player_summary'])
    for (const name of created) {
      expect(sqlNoComments).toMatch(new RegExp(`DROP FUNCTION IF EXISTS public\\.${name}\\(`))
    }
  })

  it('reads only the 1332 views (never the raw tables) and is STABLE SQL', () => {
    expect(sqlNoComments).not.toMatch(/public\.analytics_(events|sessions)/)
    expect(sqlNoComments).toMatch(/public\.game_events/)
    expect(sqlNoComments).toMatch(/public\.game_match_facts/)
    const bodies = sqlNoComments.split(/CREATE OR REPLACE FUNCTION public\./).slice(1)
    expect(bodies).toHaveLength(3)
    for (const body of bodies) {
      expect(body).toMatch(/LANGUAGE sql\s+STABLE/)
      expect(body.slice(0, body.indexOf('RETURNS'))).toContain('p_from')
      expect(body.slice(0, body.indexOf('RETURNS'))).toContain('p_to')
      expect(body.slice(0, body.indexOf('RETURNS'))).toContain('p_org_id')
    }
  })

  it('has balanced dollar quoting', () => {
    expect((sqlNoComments.match(/\$\$/g) ?? []).length % 2).toBe(0)
  })

  it('exposes exactly the functions game-player-queries.ts calls, none of which 1332 defines', () => {
    const ts = readFileSync(path.resolve(__dirname, '../src/lib/analytics/game-player-queries.ts'), 'utf8')
    const called = new Set([...ts.matchAll(/'(game_stats_\w+)'/g)].map((m) => m[1]))
    const created = new Set([...sqlNoComments.matchAll(/CREATE OR REPLACE FUNCTION public\.(game_stats_\w+)/g)].map((m) => m[1]))
    expect([...called].sort()).toEqual([...created].sort())
    for (const name of created) expect(base).not.toContain(`FUNCTION public.${name}(`)
  })
})

// ─── Execution against pglite (skipped when not installed) ───────────────────

interface PgLike {
  exec(sql: string): Promise<unknown>
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
}

async function loadPglite(): Promise<(new () => PgLike) | null> {
  try {
    const name = process.env.PGLITE_MODULE ?? '@electric-sql/pglite'
    const mod = await import(/* @vite-ignore */ name)
    return mod.PGlite as new () => PgLike
  } catch {
    return null
  }
}

const PGlite = await loadPglite()

const ORG_A = '00000000-0000-0000-0000-00000000000a'
const ORG_B = '00000000-0000-0000-0000-00000000000b'
const V_A1 = '10000000-0000-0000-0000-000000000001'
const V_A2 = '10000000-0000-0000-0000-000000000002'
const V_B = '10000000-0000-0000-0000-0000000000b1'
const S_A1 = '20000000-0000-0000-0000-000000000001'
const S_A2 = '20000000-0000-0000-0000-000000000002'
const S_B = '20000000-0000-0000-0000-0000000000b1'
const WINDOW = `now() - interval '30 days', now() + interval '1 day'`

describe.skipIf(!PGlite)('migration 1333: executed on pglite', () => {
  let db: PgLike
  const rows = async (query: string) => (await db.query(query)).rows

  async function event(org: string, session: string, visitor: string, name: string, meta: Record<string, unknown>, ago: string) {
    await db.query(
      `INSERT INTO analytics_events (organization_id, session_id, visitor_id, event_type, event_name, metadata, occurred_at)
       VALUES ($1, $2, $3, 'game', $4, $5, now() - $6::interval)`,
      [org, session, visitor, name, JSON.stringify({ game_id: 'brasil-showdown', ...meta }), ago],
    )
  }

  async function setup() {
    db = new PGlite!()
    await db.exec(`
      CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE TABLE analytics_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, visitor_id uuid,
        session_key text, started_at timestamptz DEFAULT now(), referrer text, utm_source text, country_code text,
        device_type text, browser text, os text);
      CREATE TABLE analytics_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
        session_id uuid, visitor_id uuid,
        event_type text NOT NULL CONSTRAINT traffic_events_event_type_check CHECK (event_type IN (
          'form_submit','phone_click','sms_click','call_started','chat_started','booking_started','booking_completed',
          'contact_created','opportunity_created','deal_won','custom_conversion')),
        event_name text, url text, metadata jsonb NOT NULL DEFAULT '{}', occurred_at timestamptz NOT NULL DEFAULT now());
    `)
    await db.exec(base)
    await db.exec(sql)
    await db.exec(sql) // a second run must be a no-op
    await db.exec(`
      INSERT INTO analytics_sessions (id, organization_id, visitor_id, session_key, utm_source, device_type, connection_type)
        VALUES ('${S_A1}', '${ORG_A}', '${V_A1}', 'k1', 'Google', 'desktop', '4g'),
               ('${S_A2}', '${ORG_A}', '${V_A2}', 'k2', NULL, 'mobile', '3g');
      INSERT INTO analytics_sessions (id, organization_id, visitor_id, session_key, device_type)
        VALUES ('${S_B}', '${ORG_B}', '${V_B}', 'kb', 'desktop');
    `)

    // g1: a guest, 200 -> 120 minutes ago (80 minutes), matches m1 (completed) and m2 (CPU opponent).
    await event(ORG_A, S_A1, V_A1, 'screen_view', { screen: 'title', game_session_id: 'g1' }, '200 minutes')
    await event(ORG_A, S_A1, V_A1, 'match_start', { match_id: 'm1', p1_fighter: 'lula', p1_skin: 'a', p2_fighter: 'dilma', p2_skin: 'b', stage_id: 'rio', p2_control: 'human', game_session_id: 'g1' }, '180 minutes')
    await event(ORG_A, S_A1, V_A1, 'match_end', { match_id: 'm1', outcome: 'completed', winner_side: 'p1', duration_s: 60, game_session_id: 'g1' }, '179 minutes')
    await event(ORG_A, S_A1, V_A1, 'match_start', { match_id: 'm2', p1_fighter: 'lula', p1_skin: 'a', p2_fighter: 'dilma', p2_skin: 'c', stage_id: 'rio', p2_control: 'cpu', game_session_id: 'g1' }, '120 minutes')
    // g2: a signed-in player, one minute.
    await event(ORG_A, S_A2, V_A2, 'match_start', { match_id: 'm4', p1_fighter: 'dilma', p1_skin: 'b', p2_fighter: 'lula', p2_skin: 'a', stage_id: 'sp', p2_control: 'human', player_id: 'pl1', is_guest: false, game_session_id: 'g2' }, '50 minutes')
    await event(ORG_A, S_A2, V_A2, 'match_end', { match_id: 'm4', outcome: 'completed', winner_side: 'p2', duration_s: 55, player_id: 'pl1', game_session_id: 'g2' }, '49 minutes')
    // g3: a single event (never timed), same signed-in player.
    await event(ORG_A, S_A2, V_A2, 'screen_view', { screen: 'title', player_id: 'pl1', is_guest: false, game_session_id: 'g3' }, '10 minutes')
    // g4: a tab left open for 5 hours (not timed).
    await event(ORG_A, S_A1, V_A1, 'screen_view', { screen: 'title', game_session_id: 'g4' }, '400 minutes')
    await event(ORG_A, S_A1, V_A1, 'screen_view', { screen: 'menu', game_session_id: 'g4' }, '100 minutes')
    await event(ORG_B, S_B, V_B, 'match_start', { match_id: 'mb1', p1_fighter: 'x', p2_fighter: 'y', stage_id: 'z', p2_control: 'human', game_session_id: 'gb' }, '2 hours')
  }

  it('summarizes players, matches per player and session time', async () => {
    await setup()
    const [s] = await rows(`SELECT * FROM game_stats_player_summary(${WINDOW}, '${ORG_A}')`)
    expect(s).toMatchObject({
      players: 2,
      signed_in_players: 1,
      guest_players: 1,
      players_with_match: 2,
      matches_started: 3,
      game_sessions: 4,
      timed_sessions: 2,
    })
    expect(Number(s.matches_per_player)).toBeCloseTo(1.5)
    // g1 = 4800 s, g2 = 60 s (the one-event g3 and the 5 hour g4 are not timed)
    expect(Number(s.avg_session_s)).toBeCloseTo(2430, 0)
    expect(Number(s.median_session_s)).toBeCloseTo(2430, 0)
  })

  it('applies the guest filter and returns zeros for an empty window', async () => {
    const [guests] = await rows(`SELECT * FROM game_stats_player_summary(${WINDOW}, '${ORG_A}', NULL, NULL, NULL, true)`)
    expect(guests).toMatchObject({ players: 1, signed_in_players: 0, guest_players: 1, matches_started: 2 })
    const [empty] = await rows(`SELECT * FROM game_stats_player_summary(now() - interval '2 years', now() - interval '1 year', '${ORG_A}')`)
    expect(empty).toMatchObject({ players: 0, matches_started: 0, matches_per_player: null, avg_session_s: null })
  })

  it('lists the organizations / games that have events', async () => {
    const all = await rows(`SELECT organization_id, game_id, events, players FROM game_stats_games(${WINDOW})`)
    expect(all.map((r) => r.organization_id).sort()).toEqual([ORG_A, ORG_B])
    const [a] = await rows(`SELECT * FROM game_stats_games(${WINDOW}, '${ORG_A}')`)
    expect(a).toMatchObject({ organization_id: ORG_A, game_id: 'brasil-showdown', events: 9, players: 2 })
    expect(await rows(`SELECT * FROM game_stats_games(now() - interval '2 years', now() - interval '1 year')`)).toEqual([])
  })

  it('trends the top picks per day, human sides only unless CPU is included', async () => {
    const total = (r: Record<string, unknown>[], item: string) =>
      r.filter((x) => x.item === item).reduce((n, x) => n + Number(x.picks), 0)
    const fighters = await rows(`SELECT * FROM game_stats_pick_trend('fighter', ${WINDOW}, '${ORG_A}')`)
    expect(total(fighters, 'lula')).toBe(3) // m1 p1, m2 p1, m4 p2
    expect(total(fighters, 'dilma')).toBe(2) // m1 p2, m4 p1 (m2 p2 is a CPU)
    const withCpu = await rows(`SELECT * FROM game_stats_pick_trend('fighter', ${WINDOW}, '${ORG_A}', p_include_cpu => true)`)
    expect(total(withCpu, 'dilma')).toBe(3)

    const top1 = await rows(`SELECT * FROM game_stats_pick_trend('fighter', ${WINDOW}, '${ORG_A}', p_top => 1)`)
    expect([...new Set(top1.map((r) => r.item))]).toEqual(['lula'])

    const skins = await rows(`SELECT * FROM game_stats_pick_trend('skin', ${WINDOW}, '${ORG_A}')`)
    expect(total(skins, 'lula/a')).toBe(3)
    expect(total(skins, 'dilma/b')).toBe(2)

    const stages = await rows(`SELECT * FROM game_stats_pick_trend('stage', ${WINDOW}, '${ORG_A}')`)
    expect(total(stages, 'rio')).toBe(2)
    expect(total(stages, 'sp')).toBe(1)
    expect(await rows(`SELECT * FROM game_stats_pick_trend('bogus', ${WINDOW}, '${ORG_A}')`)).toEqual([])
  })

  it('cuts tenants by RLS, lets the service role see every org, and blocks anon', async () => {
    await db.exec(`
      GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
      GRANT SELECT ON analytics_events, analytics_sessions TO authenticated, service_role, anon;
      CREATE FUNCTION get_current_org_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.org', true), '')::uuid $$;
      ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;
      ALTER TABLE analytics_sessions ENABLE ROW LEVEL SECURITY;
      CREATE POLICY ev_sel ON analytics_events FOR SELECT TO authenticated USING (organization_id = (SELECT get_current_org_id()));
      CREATE POLICY se_sel ON analytics_sessions FOR SELECT TO authenticated USING (organization_id = (SELECT get_current_org_id()));
    `)
    await db.exec(`SET app.org = '${ORG_A}'; SET ROLE authenticated;`)
    const own = await rows(`SELECT organization_id FROM game_stats_games(${WINDOW})`)
    const otherSummary = await rows(`SELECT players FROM game_stats_player_summary(${WINDOW}, '${ORG_B}')`)
    await db.exec(`RESET ROLE; SET ROLE service_role;`)
    const all = await rows(`SELECT organization_id FROM game_stats_games(${WINDOW})`)
    await db.exec(`RESET ROLE; SET ROLE anon;`)
    await expect(db.query(`SELECT * FROM game_stats_games(${WINDOW})`)).rejects.toThrow(/permission denied/)
    await db.exec(`RESET ROLE;`)

    expect(own.map((r) => r.organization_id)).toEqual([ORG_A])
    expect(otherSummary[0].players).toBe(0)
    expect(all).toHaveLength(2)
  })
})
