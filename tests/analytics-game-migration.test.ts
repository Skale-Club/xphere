// tests/analytics-game-migration.test.ts
// BS-ANALYTICS-001: migration 1332_analytics_game_events.sql.
//
// Two layers:
//   1. Static contract checks (always run): the CHECK keeps every legacy event
//      type and adds 'game', nothing is SECURITY DEFINER, anon is locked out, the
//      SQL functions and the TypeScript helpers agree on names.
//   2. Execution against an in-process Postgres (@electric-sql/pglite). The repo
//      has no local-Postgres pattern and this test must never touch a real
//      database, so the layer runs only when pglite is installed
//      (npm i --no-save @electric-sql/pglite) and is skipped otherwise.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const MIGRATIONS = path.resolve(__dirname, '../supabase/migrations')
const MIGRATION_FILE = '1332_analytics_game_events.sql'
const sql = readFileSync(path.join(MIGRATIONS, MIGRATION_FILE), 'utf8')
const sqlNoComments = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n')

describe('migration 1332: static contract', () => {
  it('is the highest numbered migration and its number is unique', () => {
    const numbers = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => f.split('_')[0])
    expect(numbers.filter((n) => n === '1332')).toHaveLength(1)
    expect(Math.max(...numbers.map(Number))).toBeGreaterThanOrEqual(1332)
  })

  it('keeps every event type allowed by the original traffic CHECK and adds game', () => {
    const original = readFileSync(path.join(MIGRATIONS, '1053_traffic_module.sql'), 'utf8')
    const originalBlock = original.match(/CHECK \(event_type IN \(([\s\S]*?)\)\)/)
    expect(originalBlock).not.toBeNull()
    const legacy = [...originalBlock![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
    expect(legacy.length).toBeGreaterThan(5)

    const next = sqlNoComments.match(/analytics_events_event_type_check\s+CHECK \(event_type IN \(([\s\S]*?)\)\)/)
    expect(next).not.toBeNull()
    const allowed = [...next![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
    for (const type of legacy) expect(allowed).toContain(type)
    expect(allowed).toContain('game')
    expect(new Set(allowed).size).toBe(allowed.length)
  })

  it('enforces the same event name rule as the ingest validation', () => {
    expect(sqlNoComments).toContain("event_name ~ '^[a-z][a-z0-9_]{0,47}$'")
    expect(sqlNoComments).toContain('event_name IS NOT NULL')
  })

  it('adds the (organization_id, event_name, occurred_at) index and the session columns', () => {
    expect(sqlNoComments).toMatch(/CREATE INDEX IF NOT EXISTS idx_analytics_events_game_name_occurred[\s\S]*?\(organization_id, event_name, occurred_at\)/)
    for (const column of ['connection_type', 'screen_width', 'screen_height']) {
      expect(sqlNoComments).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${column}\\b`))
    }
  })

  it('has no SECURITY DEFINER function: tenants are cut by RLS, admin uses the service role', () => {
    expect(sqlNoComments.toUpperCase()).not.toContain('SECURITY DEFINER')
  })

  it('creates both views as security_invoker so RLS of the caller applies', () => {
    for (const view of ['game_events', 'game_match_facts']) {
      expect(sqlNoComments).toMatch(new RegExp(`CREATE OR REPLACE VIEW public\\.${view}\\s+WITH \\(security_invoker = true\\)`))
    }
  })

  it('locks anon out of the views and every function', () => {
    expect(sqlNoComments).toMatch(/REVOKE ALL ON public\.game_events, public\.game_match_facts FROM PUBLIC, anon/)
    expect(sqlNoComments).toMatch(/REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon/)
    expect(sqlNoComments).toMatch(/GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role/)
  })

  it('is idempotent: functions are dropped/replaced, columns and indexes guarded', () => {
    const created = [...sqlNoComments.matchAll(/CREATE OR REPLACE FUNCTION public\.(game_stats_\w+)/g)].map((m) => m[1])
    expect(created.length).toBeGreaterThanOrEqual(13)
    for (const name of created) {
      expect(sqlNoComments).toMatch(new RegExp(`DROP FUNCTION IF EXISTS public\\.${name}\\(`))
    }
    expect(sqlNoComments).not.toMatch(/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/)
    expect(sqlNoComments).not.toMatch(/ADD COLUMN (?!IF NOT EXISTS)/)
  })

  it('every rollup function takes the window and org filter', () => {
    const bodies = sqlNoComments.split(/CREATE OR REPLACE FUNCTION public\./).slice(1)
    for (const body of bodies.filter((b) => b.startsWith('game_stats_'))) {
      const name = body.slice(0, body.indexOf('('))
      const signature = body.slice(0, body.indexOf('RETURNS'))
      expect(signature, name).toContain('p_from')
      expect(signature, name).toContain('p_to')
      expect(signature, name).toContain('p_org_id')
      expect(body, name).toMatch(/LANGUAGE sql\s+STABLE/)
    }
  })

  it('has balanced dollar quoting', () => {
    expect((sqlNoComments.match(/\$\$/g) ?? []).length % 2).toBe(0)
  })

  it('exposes exactly the functions the TypeScript helpers call', () => {
    const ts = readFileSync(path.resolve(__dirname, '../src/lib/analytics/game-queries.ts'), 'utf8')
    const called = new Set([...ts.matchAll(/'(game_stats_\w+)'/g)].map((m) => m[1]))
    const created = new Set([...sqlNoComments.matchAll(/CREATE OR REPLACE FUNCTION public\.(game_stats_\w+)/g)].map((m) => m[1]))
    expect([...called].sort()).toEqual([...created].sort())
  })
})

// ─── Execution against pglite (skipped when not installed) ───────────────────

interface PgLike {
  exec(sql: string): Promise<unknown>
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
}

async function loadPglite(): Promise<(new () => PgLike) | null> {
  try {
    const name = '@electric-sql/pglite'
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

describe.skipIf(!PGlite)('migration 1332: executed on pglite', () => {
  let db: PgLike

  async function event(org: string, session: string, visitor: string, name: string, meta: Record<string, unknown>, ago = '0 minutes') {
    await db.query(
      `INSERT INTO analytics_events (organization_id, session_id, visitor_id, event_type, event_name, metadata, occurred_at)
       VALUES ($1, $2, $3, 'game', $4, $5, now() - $6::interval)`,
      [org, session, visitor, name, JSON.stringify({ game_id: 'brasil-showdown', ...meta }), ago],
    )
  }
  const rows = async (query: string) => (await db.query(query)).rows

  async function setup() {
    db = new PGlite!()
    // Minimal stand-ins for the tables the migration alters. The original
    // inline CHECK keeps its traffic_events_* name, as in production.
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
    await db.exec(sql)
    await db.exec(sql) // a second run must be a no-op
    await db.exec(`
      INSERT INTO analytics_sessions (id, organization_id, visitor_id, session_key, utm_source, device_type, browser, os, country_code, connection_type)
        VALUES ('${S_A1}', '${ORG_A}', '${V_A1}', 'k1', 'Google', 'desktop', 'Chrome', 'Windows', 'BR', '4g'),
               ('${S_A2}', '${ORG_A}', '${V_A2}', 'k2', NULL, 'mobile', 'Safari', 'iOS', 'BR', '3g');
      INSERT INTO analytics_sessions (id, organization_id, visitor_id, session_key, referrer, device_type)
        VALUES ('${S_B}', '${ORG_B}', '${V_B}', 'kb', 'https://www.tiktok.com/abc', 'desktop');
    `)

    await event(ORG_A, S_A1, V_A1, 'match_start', { match_id: 'm1', p1_fighter: 'lula', p1_skin: 'a', p2_fighter: 'dilma', p2_skin: 'b', stage_id: 'rio', p2_control: 'human', game_session_id: 'g1', is_guest: true }, '3 hours')
    await event(ORG_A, S_A1, V_A1, 'match_end', { match_id: 'm1', outcome: 'completed', winner_side: 'p1', winner_fighter: 'lula', loser_fighter: 'dilma', duration_s: 60, game_session_id: 'g1' }, '179 minutes')
    await event(ORG_A, S_A1, V_A1, 'match_start', { match_id: 'm2', p1_fighter: 'lula', p1_skin: 'a', p2_fighter: 'dilma', p2_skin: 'c', stage_id: 'rio', p2_control: 'cpu', game_session_id: 'g1' }, '2 hours')
    await event(ORG_A, S_A1, V_A1, 'match_start', { match_id: 'm3', p1_fighter: 'dilma', p1_skin: 'b', p2_fighter: 'lula', p2_skin: 'a', stage_id: 'sp', p2_control: 'human', game_session_id: 'g1' }, '1 minute')
    await event(ORG_A, S_A2, V_A2, 'match_start', { match_id: 'm4', p1_fighter: 'dilma', p1_skin: 'b', p2_fighter: 'lula', p2_skin: 'a', stage_id: 'sp', p2_control: 'human', player_id: 'pl1', is_guest: false, game_session_id: 'g2' }, '50 minutes')
    await event(ORG_A, S_A2, V_A2, 'match_end', { match_id: 'm4', winner_side: 'p2', duration_s: '45.5', game_session_id: 'g2', player_id: 'pl1' }, '49 minutes')
    await event(ORG_A, S_A2, V_A2, 'match_start', { match_id: 'm5', p1_fighter: 'lula', p1_skin: 'a', p2_fighter: 'dilma', stage_id: 'rio', p2_control: 'human', game_session_id: 'g2' }, '40 minutes')
    await event(ORG_A, S_A2, V_A2, 'match_end', { match_id: 'm5', outcome: 'quit', game_session_id: 'g2' }, '39 minutes')
    await event(ORG_B, S_B, V_B, 'match_start', { match_id: 'mb1', p1_fighter: 'x', p2_fighter: 'y', stage_id: 'z', p2_control: 'human', game_session_id: 'gb' }, '2 hours')
    await event(ORG_B, S_B, V_B, 'match_end', { match_id: 'mb1', outcome: 'completed', winner_side: 'p2', duration_s: 30, game_session_id: 'gb' }, '119 minutes')

    const screen = (s: string, v: string, gs: string, name: string, from: string | null, ms: number | null, ago: string) =>
      event(ORG_A, s, v, 'screen_view', { screen: name, from_screen: from, ms_on_previous: ms, game_session_id: gs }, ago)
    await screen(S_A1, V_A1, 'g1', 'title', null, null, '200 minutes')
    await screen(S_A1, V_A1, 'g1', 'fighter_select', 'title', 4000, '199 minutes')
    await screen(S_A1, V_A1, 'g1', 'stage_select', 'fighter_select', 9000, '198 minutes')
    await screen(S_A1, V_A1, 'g1', 'match', 'stage_select', 2000, '197 minutes')
    await screen(S_A2, V_A2, 'g2', 'title', null, null, '100 minutes')
    await screen(S_A2, V_A2, 'g2', 'fighter_select', 'title', 6000, '99 minutes')
    await screen(S_A2, V_A2, 'g3', 'fighter_select', null, null, '90 minutes') // skipped the title: not in the funnel

    await event(ORG_A, S_A1, V_A1, 'game_loaded', { load_ms: 1000, from_cache: false, game_session_id: 'g1' }, '200 minutes')
    await event(ORG_A, S_A2, V_A2, 'game_loaded', { load_ms: 3000, from_cache: true, game_session_id: 'g2' }, '100 minutes')
    await event(ORG_A, S_A2, V_A2, 'game_loaded', { load_ms: 'not-a-number', game_session_id: 'g2' }, '100 minutes')
    await event(ORG_A, S_A2, V_A2, 'game_error', { phase: 'audio', code: 'decode', game_session_id: 'g2' }, '95 minutes')
  }

  it('applies twice and keeps the CHECK semantics', async () => {
    await setup()
    const insert = (type: string, name: string | null) =>
      db.query(`INSERT INTO analytics_events (organization_id, event_type, event_name) VALUES ('${ORG_A}', $1, $2)`, [type, name])
    await expect(insert('game', 'match_start')).resolves.toBeDefined()
    await expect(insert('form_submit', null)).resolves.toBeDefined()
    await expect(insert('game', 'Bad-Name')).rejects.toThrow()
    await expect(insert('game', null)).rejects.toThrow()
    await expect(insert('game', 'a'.repeat(49))).rejects.toThrow()
    await expect(insert('nonsense', 'x')).rejects.toThrow()
  })

  it('builds one fact row per match with the outcome rules', async () => {
    const facts = await rows(
      `SELECT match_id, outcome, winner_side, winner_fighter, loser_fighter, duration_s::float AS duration_s, player_id, is_guest, device_type, source
       FROM game_match_facts WHERE organization_id = '${ORG_A}' ORDER BY match_id`,
    )
    const byId = Object.fromEntries(facts.map((f) => [f.match_id, f]))
    expect(Object.keys(byId)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5'])
    expect(byId.m1).toMatchObject({ outcome: 'completed', winner_fighter: 'lula', loser_fighter: 'dilma', duration_s: 60, is_guest: true, device_type: 'desktop', source: 'google' })
    expect(byId.m2.outcome).toBe('abandoned') // no end after the grace window
    expect(byId.m3.outcome).toBe('in_progress') // no end yet, inside the grace window
    expect(byId.m4).toMatchObject({ outcome: 'completed', winner_side: 'p2', winner_fighter: 'lula', loser_fighter: 'dilma', duration_s: 45.5, player_id: 'pl1', is_guest: false, source: 'direct' })
    expect(byId.m5.outcome).toBe('quit')
  })

  it('summarizes started / completed / abandoned and durations', async () => {
    const [s] = await rows(`SELECT * FROM game_stats_match_summary(${WINDOW}, '${ORG_A}')`)
    expect(s).toMatchObject({ started: 5, completed: 2, abandoned: 2, in_progress: 1, p1_wins: 1, p2_wins: 1 })
    expect(Number(s.abandon_rate)).toBeCloseTo(0.5)
    expect(Number(s.avg_duration_s)).toBeCloseTo(52.75)
    expect(Number(s.median_duration_s)).toBeCloseTo(52.75)
  })

  it('counts picks per fighter, skin and stage with device / source / guest filters', async () => {
    const fighters = await rows(`SELECT fighter_id, picks FROM game_stats_pick_counts('fighter', ${WINDOW}, '${ORG_A}')`)
    expect(Object.fromEntries(fighters.map((r) => [r.fighter_id, Number(r.picks)]))).toEqual({ lula: 5, dilma: 4 }) // m2's CPU side excluded
    const withCpu = await rows(`SELECT fighter_id, picks FROM game_stats_pick_counts('fighter', ${WINDOW}, '${ORG_A}', null, null, null, null, true)`)
    expect(Object.fromEntries(withCpu.map((r) => [r.fighter_id, Number(r.picks)]))).toEqual({ lula: 5, dilma: 5 })
    const skins = await rows(`SELECT fighter_id, skin_id, picks FROM game_stats_pick_counts('skin', ${WINDOW}, '${ORG_A}') WHERE skin_id IS NOT NULL`)
    expect(skins).toContainEqual({ fighter_id: 'lula', skin_id: 'a', picks: 5 })
    const stagesMobile = await rows(`SELECT stage_id, picks FROM game_stats_pick_counts('stage', ${WINDOW}, '${ORG_A}', null, 'mobile')`)
    expect(Object.fromEntries(stagesMobile.map((r) => [r.stage_id, Number(r.picks)]))).toEqual({ rio: 1, sp: 1 })
    const stagesGoogle = await rows(`SELECT stage_id, picks FROM game_stats_pick_counts('stage', ${WINDOW}, '${ORG_A}', null, null, 'google')`)
    expect(Object.fromEntries(stagesGoogle.map((r) => [r.stage_id, Number(r.picks)]))).toEqual({ rio: 2, sp: 1 })
    const guests = await rows(`SELECT fighter_id, picks FROM game_stats_pick_counts('fighter', ${WINDOW}, '${ORG_A}', null, null, null, true)`)
    expect(Object.fromEntries(guests.map((r) => [r.fighter_id, Number(r.picks)]))).toEqual({ lula: 4, dilma: 3 })
  })

  it('computes wins, win rate and matchups from completed matches only', async () => {
    const wins = await rows(`SELECT fighter_id, matches, wins, win_rate::float AS win_rate FROM game_stats_fighter_wins(${WINDOW}, '${ORG_A}')`)
    expect(wins).toContainEqual({ fighter_id: 'lula', matches: 2, wins: 2, win_rate: 1 })
    expect(wins).toContainEqual({ fighter_id: 'dilma', matches: 2, wins: 0, win_rate: 0 })
    const matchups = await rows(`SELECT fighter_id, opponent_id, matches, wins FROM game_stats_matchups(${WINDOW}, '${ORG_A}')`)
    expect(matchups).toContainEqual({ fighter_id: 'lula', opponent_id: 'dilma', matches: 2, wins: 2 })
    expect(matchups).toContainEqual({ fighter_id: 'dilma', opponent_id: 'lula', matches: 2, wins: 0 })
  })

  it('builds the ordered screen funnel and time per screen', async () => {
    const funnel = await rows(`SELECT screen, game_sessions FROM game_stats_screen_funnel(${WINDOW}, '${ORG_A}')`)
    expect(funnel).toEqual([
      { screen: 'title', game_sessions: 2 },
      { screen: 'fighter_select', game_sessions: 2 },
      { screen: 'stage_select', game_sessions: 1 },
      { screen: 'match', game_sessions: 1 },
      { screen: 'post_match', game_sessions: 0 },
    ])
    const time = await rows(`SELECT screen, samples, avg_seconds::float AS avg_seconds FROM game_stats_screen_time(${WINDOW}, '${ORG_A}')`)
    expect(time).toContainEqual({ screen: 'title', samples: 2, avg_seconds: 5 })
    expect(time).toContainEqual({ screen: 'fighter_select', samples: 1, avg_seconds: 9 })
  })

  it('reports load time percentiles ignoring unparsable values, and errors per session', async () => {
    const [load] = await rows(`SELECT loads, p50_ms::float AS p50, p95_ms::float AS p95 FROM game_stats_load_times(${WINDOW}, '${ORG_A}')`)
    expect(load).toMatchObject({ loads: 2, p50: 2000 })
    expect(load.p95 as number).toBeGreaterThan(2000)
    const byConnection = await rows(`SELECT group_key, p50_ms::float AS p50 FROM game_stats_load_times(${WINDOW}, '${ORG_A}', null, null, null, null, 'connection')`)
    expect(byConnection).toContainEqual({ group_key: '3g', p50: 3000 })
    const [err] = await rows(`SELECT sessions_with_error, errors, error_rate::float AS rate FROM game_stats_error_rate(${WINDOW}, '${ORG_A}')`)
    expect(err.errors).toBe(1)
    expect(err.sessions_with_error).toBe(1)
    expect(err.rate as number).toBeGreaterThan(0)
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
    const own = await rows(`SELECT started FROM game_stats_match_summary(${WINDOW})`)
    const other = await rows(`SELECT started FROM game_stats_match_summary(${WINDOW}, '${ORG_B}')`)
    await db.exec(`RESET ROLE; SET ROLE service_role;`)
    const all = await rows(`SELECT started FROM game_stats_match_summary(${WINDOW})`)
    await db.exec(`RESET ROLE; SET ROLE anon;`)
    await expect(db.query(`SELECT * FROM game_stats_match_summary(${WINDOW})`)).rejects.toThrow(/permission denied/)
    await db.exec(`RESET ROLE;`)

    expect(own[0].started).toBe(5)
    expect(other[0].started).toBe(0)
    expect(all[0].started).toBe(6)
  })
})
