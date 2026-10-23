-- =============================================================================
-- Migration 1332: game analytics data layer (BS-ANALYTICS-001).
--
-- Lets the analytics tables carry per-game events (`event_type = 'game'` plus an
-- `event_name` such as match_start / match_end / screen_view) and adds the SQL
-- views and rollup functions the game panels read.
--
--   1. analytics_events.event_type CHECK accepts 'game' (every old value kept);
--      a second CHECK keeps game event names lowercase snake_case, max 48 chars.
--   2. Partial index (organization_id, event_name, occurred_at) for game rows.
--   3. analytics_sessions gains connection_type / screen_width / screen_height
--      (nullable, filled by the tracking script on session_start).
--   4. Views: game_events (parsed game rows + session context) and
--      game_match_facts (one row per match_id).
--   5. Functions game_stats_*: picks, wins, matchups, match summary and daily
--      trend, screen funnel / time per screen / exit screens, DAU/WAU/MAU,
--      D1/D7/D30 retention, load time p50/p95, error rate and error breakdown.
--
-- Security model. The views are `security_invoker` and the functions are
-- SECURITY INVOKER, so they run with the caller's privileges:
--   * a signed-in tenant user reads through the authenticated role and RLS on
--     analytics_events / analytics_sessions (organization_id =
--     get_current_org_id()) limits every row to their own organization, whatever
--     p_org_id they pass;
--   * the cross-org super-admin panel calls the very same functions with the
--     service-role client (BYPASSRLS), p_org_id NULL = all organizations. That
--     is the existing admin pattern: src/app/(admin)/layout.tsx gates on
--     PLATFORM_ADMIN_EMAIL and the admin actions use createServiceRoleClient().
--     No SECURITY DEFINER function is needed, so none can leak across tenants
--     through /rpc. anon has no access to anything created here.
--
-- Time windows are [p_from, p_to). Day buckets use p_tz (default UTC).
-- Idempotent: safe to run twice.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. event_type CHECK: keep every existing value, add 'game'
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  c record;
BEGIN
  -- The inline constraint was created as traffic_events_event_type_check and kept
  -- its name through the traffic -> analytics rename (1223). Do not trust the
  -- name: drop the CHECK on analytics_events whose definition lists the known
  -- event types (this also removes our own constraint on a re-run).
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'analytics_events'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%form_submit%'
  LOOP
    EXECUTE format('ALTER TABLE public.analytics_events DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.analytics_events
  ADD CONSTRAINT analytics_events_event_type_check
  CHECK (event_type IN (
    'form_submit','phone_click','sms_click','call_started',
    'chat_started','booking_started','booking_completed',
    'contact_created','opportunity_created','deal_won','custom_conversion',
    'game'
  )) NOT VALID;
ALTER TABLE public.analytics_events VALIDATE CONSTRAINT analytics_events_event_type_check;

ALTER TABLE public.analytics_events
  DROP CONSTRAINT IF EXISTS analytics_events_game_event_name_check;
ALTER TABLE public.analytics_events
  ADD CONSTRAINT analytics_events_game_event_name_check
  CHECK (event_type <> 'game' OR (event_name IS NOT NULL AND event_name ~ '^[a-z][a-z0-9_]{0,47}$')) NOT VALID;
ALTER TABLE public.analytics_events VALIDATE CONSTRAINT analytics_events_game_event_name_check;

-- ---------------------------------------------------------------------------
-- 2. Index for game rollups
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_analytics_events_game_name_occurred
  ON public.analytics_events (organization_id, event_name, occurred_at)
  WHERE event_type = 'game';

-- ---------------------------------------------------------------------------
-- 3. Session context sent by the tracking script on session_start
-- ---------------------------------------------------------------------------
ALTER TABLE public.analytics_sessions
  ADD COLUMN IF NOT EXISTS connection_type text,
  ADD COLUMN IF NOT EXISTS screen_width    integer,
  ADD COLUMN IF NOT EXISTS screen_height   integer;

COMMENT ON COLUMN public.analytics_sessions.connection_type IS
  'navigator.connection.effectiveType at session_start (slow-2g, 2g, 3g, 4g); NULL when the browser does not expose it.';

-- ---------------------------------------------------------------------------
-- 4. Helpers (pure, no table access)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.game_try_numeric(p_text text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE WHEN p_text ~ '^-?[0-9]{1,15}(\.[0-9]{1,6})?$' THEN p_text::numeric END
$$;

CREATE OR REPLACE FUNCTION public.game_try_int(p_text text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE WHEN p_text ~ '^[0-9]{1,9}$' THEN p_text::integer END
$$;

-- ---------------------------------------------------------------------------
-- 5. View game_events: one row per game event with parsed common properties
--    and the traffic-session context (device, browser, OS, source, connection).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.game_events
WITH (security_invoker = true) AS
SELECT
  e.id                                                        AS event_id,
  e.organization_id,
  e.occurred_at,
  e.event_name,
  e.visitor_id,
  e.session_id,
  COALESCE(NULLIF(e.metadata->>'game_session_id', ''), e.session_id::text)
                                                              AS game_session_id,
  COALESCE(NULLIF(e.metadata->>'game_id', ''), 'unknown')     AS game_id,
  NULLIF(e.metadata->>'game_version', '')                     AS game_version,
  NULLIF(e.metadata->>'build', '')                            AS build,
  NULLIF(e.metadata->>'player_id', '')                        AS player_id,
  CASE
    WHEN (e.metadata->'is_guest') IS NOT NULL THEN lower(e.metadata->>'is_guest') = 'true'
    ELSE NULLIF(e.metadata->>'player_id', '') IS NULL
  END                                                         AS is_guest,
  -- Who counts as one player: the signed-in player id, else the browser visitor.
  -- A guest who later signs in is counted as a new actor (documented limit).
  COALESCE(NULLIF(e.metadata->>'player_id', ''), 'v:' || e.visitor_id::text)
                                                              AS actor_id,
  NULLIF(e.metadata->>'input_device', '')                     AS input_device,
  NULLIF(e.metadata->>'screen', '')                           AS screen,
  public.game_try_int(e.metadata->>'seq')                     AS seq,
  s.device_type,
  s.browser,
  s.os,
  s.country_code,
  s.connection_type,
  COALESCE(
    NULLIF(lower(s.utm_source), ''),
    NULLIF(regexp_replace(substring(s.referrer from '^https?://([^/?#:]+)'), '^www\.', ''), ''),
    'direct'
  )                                                           AS source,
  e.metadata
FROM public.analytics_events e
LEFT JOIN public.analytics_sessions s ON s.id = e.session_id
WHERE e.event_type = 'game';

COMMENT ON VIEW public.game_events IS
  'Game events (analytics_events.event_type = game) with parsed common properties and session context. security_invoker: RLS of the caller applies.';

-- ---------------------------------------------------------------------------
-- 6. View game_match_facts: one row per (organization, game, match_id), built
--    from match_start (+ latest match_end). A match with no match_end becomes
--    'abandoned' once the 30 minute grace window after its start has passed and
--    'in_progress' before that.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.game_match_facts
WITH (security_invoker = true) AS
WITH starts AS (
  SELECT DISTINCT ON (g.organization_id, g.game_id, g.metadata->>'match_id')
    g.organization_id,
    g.game_id,
    g.metadata->>'match_id'                                   AS match_id,
    g.event_id,
    g.occurred_at,
    g.session_id,
    g.visitor_id,
    g.game_session_id,
    g.game_version,
    g.build,
    g.player_id,
    g.is_guest,
    g.actor_id,
    g.device_type,
    g.browser,
    g.os,
    g.country_code,
    g.connection_type,
    g.source,
    NULLIF(g.metadata->>'mode', '')                           AS mode,
    NULLIF(g.metadata->>'p1_fighter', '')                     AS p1_fighter,
    NULLIF(g.metadata->>'p1_skin', '')                        AS p1_skin,
    NULLIF(g.metadata->>'p2_fighter', '')                     AS p2_fighter,
    NULLIF(g.metadata->>'p2_skin', '')                        AS p2_skin,
    NULLIF(g.metadata->>'stage_id', '')                       AS stage_id,
    lower(NULLIF(g.metadata->>'p2_control', ''))              AS p2_control,
    NULLIF(g.metadata->>'difficulty', '')                     AS difficulty
  FROM public.game_events g
  WHERE g.event_name = 'match_start'
    AND NULLIF(g.metadata->>'match_id', '') IS NOT NULL
  ORDER BY g.organization_id, g.game_id, g.metadata->>'match_id', g.occurred_at
),
ends AS (
  SELECT DISTINCT ON (g.organization_id, g.game_id, g.metadata->>'match_id')
    g.organization_id,
    g.game_id,
    g.metadata->>'match_id'                                   AS match_id,
    g.event_id,
    g.occurred_at,
    g.player_id,
    lower(NULLIF(g.metadata->>'outcome', ''))                 AS outcome_raw,
    lower(NULLIF(g.metadata->>'winner_side', ''))             AS winner_side_raw,
    NULLIF(g.metadata->>'winner_fighter', '')                 AS winner_fighter,
    NULLIF(g.metadata->>'loser_fighter', '')                  AS loser_fighter,
    public.game_try_numeric(g.metadata->>'duration_s')        AS duration_s,
    public.game_try_int(g.metadata->>'rounds_p1')             AS rounds_p1,
    public.game_try_int(g.metadata->>'rounds_p2')             AS rounds_p2
  FROM public.game_events g
  WHERE g.event_name = 'match_end'
    AND NULLIF(g.metadata->>'match_id', '') IS NOT NULL
  ORDER BY g.organization_id, g.game_id, g.metadata->>'match_id', g.occurred_at DESC
),
joined AS (
  SELECT
    st.*,
    en.event_id IS NOT NULL                                   AS end_reported,
    en.occurred_at                                            AS ended_at,
    CASE
      WHEN en.event_id IS NOT NULL THEN
        CASE
          WHEN en.outcome_raw IS NULL THEN 'completed'
          WHEN en.outcome_raw IN ('completed', 'abandoned', 'quit', 'crash') THEN en.outcome_raw
          ELSE 'unknown'
        END
      WHEN st.occurred_at < now() - interval '30 minutes' THEN 'abandoned'
      ELSE 'in_progress'
    END                                                       AS outcome,
    CASE WHEN en.winner_side_raw IN ('p1', 'p2') THEN en.winner_side_raw END
                                                              AS winner_side,
    en.winner_fighter,
    en.loser_fighter,
    en.duration_s                                             AS reported_duration_s,
    en.rounds_p1,
    en.rounds_p2,
    en.player_id                                              AS end_player_id
  FROM starts st
  LEFT JOIN ends en
    ON en.organization_id = st.organization_id
   AND en.game_id = st.game_id
   AND en.match_id = st.match_id
)
SELECT
  j.organization_id,
  j.game_id,
  j.match_id,
  j.occurred_at                                               AS started_at,
  j.ended_at,
  j.outcome,
  (j.outcome = 'completed')                                   AS is_completed,
  (j.outcome IN ('abandoned', 'quit', 'crash'))               AS is_abandoned,
  j.end_reported,
  j.mode,
  j.p1_fighter,
  j.p1_skin,
  j.p2_fighter,
  j.p2_skin,
  j.stage_id,
  j.p2_control,
  j.difficulty,
  j.winner_side,
  -- Winner / loser fighter: as reported, else derived from the side and the picks.
  COALESCE(j.winner_fighter,
    CASE j.winner_side WHEN 'p1' THEN j.p1_fighter WHEN 'p2' THEN j.p2_fighter END)
                                                              AS winner_fighter,
  COALESCE(j.loser_fighter,
    CASE j.winner_side WHEN 'p1' THEN j.p2_fighter WHEN 'p2' THEN j.p1_fighter END)
                                                              AS loser_fighter,
  -- Duration: as reported by the client, else end - start for a completed match.
  COALESCE(
    j.reported_duration_s,
    CASE WHEN j.outcome = 'completed' AND j.ended_at IS NOT NULL
         THEN GREATEST(extract(epoch FROM (j.ended_at - j.occurred_at)), 0)::numeric END
  )                                                           AS duration_s,
  j.rounds_p1,
  j.rounds_p2,
  COALESCE(j.player_id, j.end_player_id)                      AS player_id,
  CASE
    WHEN (j.player_id IS NULL AND j.end_player_id IS NULL) THEN j.is_guest
    ELSE false
  END                                                         AS is_guest,
  j.actor_id,
  j.session_id,
  j.visitor_id,
  j.game_session_id,
  j.game_version,
  j.build,
  j.device_type,
  j.browser,
  j.os,
  j.country_code,
  j.connection_type,
  j.source
FROM joined j;

COMMENT ON VIEW public.game_match_facts IS
  'One row per match_id from match_start/match_end. outcome: completed | abandoned | quit | crash | unknown | in_progress (no end yet, inside the 30 min grace window). A match with no end after the grace window is abandoned. is_abandoned = abandoned, quit or crash.';

-- ---------------------------------------------------------------------------
-- 7. Rollup functions. Common filters: p_org_id (NULL = every org the caller
--    can see), p_game_id, p_device (desktop|mobile|tablet|unknown), p_source
--    (utm_source or referrer host, "direct"), p_guest (true guests only,
--    false signed-in only, NULL both).
-- ---------------------------------------------------------------------------

-- 7.1 Picks by fighter / skin / stage -----------------------------------------
-- Counted per match entered. p_kind: 'fighter' | 'skin' | 'stage'. Side p2 is
-- counted only when it is not a CPU, unless p_include_cpu is true.
DROP FUNCTION IF EXISTS public.game_stats_pick_counts(text, timestamptz, timestamptz, uuid, text, text, text, boolean, boolean);
CREATE OR REPLACE FUNCTION public.game_stats_pick_counts(
  p_kind        text,
  p_from        timestamptz,
  p_to          timestamptz,
  p_org_id      uuid    DEFAULT NULL,
  p_game_id     text    DEFAULT NULL,
  p_device      text    DEFAULT NULL,
  p_source      text    DEFAULT NULL,
  p_guest       boolean DEFAULT NULL,
  p_include_cpu boolean DEFAULT false
)
RETURNS TABLE (fighter_id text, skin_id text, stage_id text, picks bigint, share numeric)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH m AS (
    SELECT f.*
    FROM public.game_match_facts f
    WHERE f.started_at >= p_from AND f.started_at < p_to
      AND (p_org_id IS NULL OR f.organization_id = p_org_id)
      AND (p_game_id IS NULL OR f.game_id = p_game_id)
      AND (p_device IS NULL OR f.device_type = p_device)
      AND (p_source IS NULL OR f.source = p_source)
      AND (p_guest IS NULL OR f.is_guest = p_guest)
  ),
  picked AS (
    SELECT x.fighter_id AS f_id,
           CASE WHEN p_kind = 'skin' THEN x.skin_id END AS s_id,
           NULL::text AS st_id
    FROM (
      SELECT m.p1_fighter AS fighter_id, m.p1_skin AS skin_id FROM m
      UNION ALL
      SELECT m.p2_fighter, m.p2_skin FROM m
      WHERE p_include_cpu OR m.p2_control IS DISTINCT FROM 'cpu'
    ) x
    WHERE p_kind IN ('fighter', 'skin') AND x.fighter_id IS NOT NULL
    UNION ALL
    SELECT NULL::text, NULL::text, m.stage_id
    FROM m
    WHERE p_kind = 'stage' AND m.stage_id IS NOT NULL
  )
  SELECT
    picked.f_id,
    picked.s_id,
    picked.st_id,
    count(*)::bigint,
    round(count(*)::numeric / NULLIF(sum(count(*)) OVER (), 0), 4)
  FROM picked
  GROUP BY picked.f_id, picked.s_id, picked.st_id
  ORDER BY count(*) DESC, picked.f_id, picked.s_id, picked.st_id
$$;

-- 7.2 Wins and win rate per fighter -------------------------------------------
-- Completed matches with a winner only; both sides count (CPU included).
DROP FUNCTION IF EXISTS public.game_stats_fighter_wins(timestamptz, timestamptz, uuid, text, text, text, boolean);
CREATE OR REPLACE FUNCTION public.game_stats_fighter_wins(
  p_from    timestamptz,
  p_to      timestamptz,
  p_org_id  uuid    DEFAULT NULL,
  p_game_id text    DEFAULT NULL,
  p_device  text    DEFAULT NULL,
  p_source  text    DEFAULT NULL,
  p_guest   boolean DEFAULT NULL
)
RETURNS TABLE (fighter_id text, matches bigint, wins bigint, losses bigint, win_rate numeric)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH m AS (
    SELECT f.*
    FROM public.game_match_facts f
    WHERE f.started_at >= p_from AND f.started_at < p_to
      AND f.is_completed AND f.winner_side IS NOT NULL
      AND (p_org_id IS NULL OR f.organization_id = p_org_id)
      AND (p_game_id IS NULL OR f.game_id = p_game_id)
      AND (p_device IS NULL OR f.device_type = p_device)
      AND (p_source IS NULL OR f.source = p_source)
      AND (p_guest IS NULL OR f.is_guest = p_guest)
  ),
  sides AS (
    SELECT m.p1_fighter AS fighter_id, (m.winner_side = 'p1') AS won FROM m WHERE m.p1_fighter IS NOT NULL
    UNION ALL
    SELECT m.p2_fighter, (m.winner_side = 'p2') FROM m WHERE m.p2_fighter IS NOT NULL
  )
  SELECT
    s.fighter_id,
    count(*)::bigint,
    count(*) FILTER (WHERE s.won)::bigint,
    count(*) FILTER (WHERE NOT s.won)::bigint,
    round(count(*) FILTER (WHERE s.won)::numeric / count(*), 4)
  FROM sides s
  GROUP BY s.fighter_id
  ORDER BY count(*) DESC, s.fighter_id
$$;

-- 7.3 Matchup matrix (one row per ordered pair fighter vs opponent) -----------
DROP FUNCTION IF EXISTS public.game_stats_matchups(timestamptz, timestamptz, uuid, text, text, text, boolean);
CREATE OR REPLACE FUNCTION public.game_stats_matchups(
  p_from    timestamptz,
  p_to      timestamptz,
  p_org_id  uuid    DEFAULT NULL,
  p_game_id text    DEFAULT NULL,
  p_device  text    DEFAULT NULL,
  p_source  text    DEFAULT NULL,
  p_guest   boolean DEFAULT NULL
)
RETURNS TABLE (fighter_id text, opponent_id text, matches bigint, wins bigint, win_rate numeric)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH m AS (
    SELECT f.*
    FROM public.game_match_facts f
    WHERE f.started_at >= p_from AND f.started_at < p_to
      AND f.is_completed AND f.winner_side IS NOT NULL
      AND f.p1_fighter IS NOT NULL AND f.p2_fighter IS NOT NULL
      AND (p_org_id IS NULL OR f.organization_id = p_org_id)
      AND (p_game_id IS NULL OR f.game_id = p_game_id)
      AND (p_device IS NULL OR f.device_type = p_device)
      AND (p_source IS NULL OR f.source = p_source)
      AND (p_guest IS NULL OR f.is_guest = p_guest)
  ),
  pairs AS (
    SELECT m.p1_fighter AS fighter_id, m.p2_fighter AS opponent_id, (m.winner_side = 'p1') AS won FROM m
    UNION ALL
    SELECT m.p2_fighter, m.p1_fighter, (m.winner_side = 'p2') FROM m
  )
  SELECT
    p.fighter_id,
    p.opponent_id,
    count(*)::bigint,
    count(*) FILTER (WHERE p.won)::bigint,
    round(count(*) FILTER (WHERE p.won)::numeric / count(*), 4)
  FROM pairs p
  GROUP BY p.fighter_id, p.opponent_id
  ORDER BY p.fighter_id, p.opponent_id
$$;

-- 7.4 Match summary: started / completed / abandoned, duration, side balance --
DROP FUNCTION IF EXISTS public.game_stats_match_summary(timestamptz, timestamptz, uuid, text, text, text, boolean);
CREATE OR REPLACE FUNCTION public.game_stats_match_summary(
  p_from    timestamptz,
  p_to      timestamptz,
  p_org_id  uuid    DEFAULT NULL,
  p_game_id text    DEFAULT NULL,
  p_device  text    DEFAULT NULL,
  p_source  text    DEFAULT NULL,
  p_guest   boolean DEFAULT NULL
)
RETURNS TABLE (
  started bigint, completed bigint, abandoned bigint, in_progress bigint,
  abandon_rate numeric, avg_duration_s numeric, median_duration_s numeric,
  p1_wins bigint, p2_wins bigint
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    count(*)::bigint,
    count(*) FILTER (WHERE f.is_completed)::bigint,
    count(*) FILTER (WHERE f.is_abandoned)::bigint,
    count(*) FILTER (WHERE f.outcome = 'in_progress')::bigint,
    round(count(*) FILTER (WHERE f.is_abandoned)::numeric / NULLIF(count(*) FILTER (WHERE f.outcome <> 'in_progress'), 0), 4),
    round((avg(f.duration_s) FILTER (WHERE f.is_completed))::numeric, 2),
    round((percentile_cont(0.5) WITHIN GROUP (ORDER BY f.duration_s::double precision)
           FILTER (WHERE f.is_completed AND f.duration_s IS NOT NULL))::numeric, 2),
    count(*) FILTER (WHERE f.is_completed AND f.winner_side = 'p1')::bigint,
    count(*) FILTER (WHERE f.is_completed AND f.winner_side = 'p2')::bigint
  FROM public.game_match_facts f
  WHERE f.started_at >= p_from AND f.started_at < p_to
    AND (p_org_id IS NULL OR f.organization_id = p_org_id)
    AND (p_game_id IS NULL OR f.game_id = p_game_id)
    AND (p_device IS NULL OR f.device_type = p_device)
    AND (p_source IS NULL OR f.source = p_source)
    AND (p_guest IS NULL OR f.is_guest = p_guest)
$$;

-- 7.5 Daily trend of matches ----------------------------------------------------
DROP FUNCTION IF EXISTS public.game_stats_match_daily(timestamptz, timestamptz, uuid, text, text, text, boolean, text);
CREATE OR REPLACE FUNCTION public.game_stats_match_daily(
  p_from    timestamptz,
  p_to      timestamptz,
  p_org_id  uuid    DEFAULT NULL,
  p_game_id text    DEFAULT NULL,
  p_device  text    DEFAULT NULL,
  p_source  text    DEFAULT NULL,
  p_guest   boolean DEFAULT NULL,
  p_tz      text    DEFAULT 'UTC'
)
RETURNS TABLE (day date, started bigint, completed bigint, abandoned bigint)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    (f.started_at AT TIME ZONE p_tz)::date,
    count(*)::bigint,
    count(*) FILTER (WHERE f.is_completed)::bigint,
    count(*) FILTER (WHERE f.is_abandoned)::bigint
  FROM public.game_match_facts f
  WHERE f.started_at >= p_from AND f.started_at < p_to
    AND (p_org_id IS NULL OR f.organization_id = p_org_id)
    AND (p_game_id IS NULL OR f.game_id = p_game_id)
    AND (p_device IS NULL OR f.device_type = p_device)
    AND (p_source IS NULL OR f.source = p_source)
    AND (p_guest IS NULL OR f.is_guest = p_guest)
  GROUP BY 1
  ORDER BY 1
$$;

-- 7.6 Screen funnel -------------------------------------------------------------
-- A game session reaches step n when it viewed steps 1..n in order (first view
-- of each step not earlier than the previous step's first view).
DROP FUNCTION IF EXISTS public.game_stats_screen_funnel(timestamptz, timestamptz, uuid, text, text, text, boolean, text[]);
CREATE OR REPLACE FUNCTION public.game_stats_screen_funnel(
  p_from    timestamptz,
  p_to      timestamptz,
  p_org_id  uuid    DEFAULT NULL,
  p_game_id text    DEFAULT NULL,
  p_device  text    DEFAULT NULL,
  p_source  text    DEFAULT NULL,
  p_guest   boolean DEFAULT NULL,
  p_steps   text[]  DEFAULT ARRAY['title', 'fighter_select', 'stage_select', 'match', 'post_match']
)
RETURNS TABLE (step_index integer, screen text, game_sessions bigint, pct_of_previous numeric, pct_of_first numeric)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH steps AS (
    SELECT s.screen, s.n::integer AS n
    FROM unnest(p_steps) WITH ORDINALITY AS s(screen, n)
  ),
  views AS (
    SELECT g.game_session_id, g.metadata->>'screen' AS screen, min(g.occurred_at) AS first_at
    FROM public.game_events g
    WHERE g.event_name = 'screen_view'
      AND g.occurred_at >= p_from AND g.occurred_at < p_to
      AND g.game_session_id IS NOT NULL
      AND g.metadata->>'screen' = ANY (p_steps)
      AND (p_org_id IS NULL OR g.organization_id = p_org_id)
      AND (p_game_id IS NULL OR g.game_id = p_game_id)
      AND (p_device IS NULL OR g.device_type = p_device)
      AND (p_source IS NULL OR g.source = p_source)
      AND (p_guest IS NULL OR g.is_guest = p_guest)
    GROUP BY g.game_session_id, g.metadata->>'screen'
  ),
  grid AS (
    SELECT sess.game_session_id, st.n, st.screen, v.first_at
    FROM (SELECT DISTINCT vw.game_session_id FROM views vw) sess
    CROSS JOIN steps st
    LEFT JOIN views v ON v.game_session_id = sess.game_session_id AND v.screen = st.screen
  ),
  flagged AS (
    SELECT gr.game_session_id, gr.n, gr.screen,
      (gr.first_at IS NOT NULL
       AND (gr.n = 1 OR gr.first_at >= lag(gr.first_at) OVER (PARTITION BY gr.game_session_id ORDER BY gr.n))) AS step_ok
    FROM grid gr
  ),
  reached AS (
    SELECT fl.n, fl.screen,
      bool_and(fl.step_ok) OVER (PARTITION BY fl.game_session_id ORDER BY fl.n) AS reached
    FROM flagged fl
  ),
  counts AS (
    SELECT st.n, st.screen,
      count(*) FILTER (WHERE r.reached)::bigint AS sessions
    FROM steps st
    LEFT JOIN reached r ON r.n = st.n
    GROUP BY st.n, st.screen
  )
  SELECT
    c.n,
    c.screen,
    c.sessions,
    round(c.sessions::numeric / NULLIF(lag(c.sessions) OVER (ORDER BY c.n), 0), 4),
    round(c.sessions::numeric / NULLIF(first_value(c.sessions) OVER (ORDER BY c.n), 0), 4)
  FROM counts c
  ORDER BY c.n
$$;

-- 7.7 Time per screen (from screen_view.ms_on_previous / from_screen) ----------
-- Samples above 30 minutes are dropped (tab left open).
DROP FUNCTION IF EXISTS public.game_stats_screen_time(timestamptz, timestamptz, uuid, text, text, text, boolean);
CREATE OR REPLACE FUNCTION public.game_stats_screen_time(
  p_from    timestamptz,
  p_to      timestamptz,
  p_org_id  uuid    DEFAULT NULL,
  p_game_id text    DEFAULT NULL,
  p_device  text    DEFAULT NULL,
  p_source  text    DEFAULT NULL,
  p_guest   boolean DEFAULT NULL
)
RETURNS TABLE (screen text, samples bigint, avg_seconds numeric, median_seconds numeric, p95_seconds numeric)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH t AS (
    SELECT g.metadata->>'from_screen' AS screen,
           (public.game_try_numeric(g.metadata->>'ms_on_previous') / 1000.0)::double precision AS seconds
    FROM public.game_events g
    WHERE g.event_name = 'screen_view'
      AND g.occurred_at >= p_from AND g.occurred_at < p_to
      AND NULLIF(g.metadata->>'from_screen', '') IS NOT NULL
      AND (p_org_id IS NULL OR g.organization_id = p_org_id)
      AND (p_game_id IS NULL OR g.game_id = p_game_id)
      AND (p_device IS NULL OR g.device_type = p_device)
      AND (p_source IS NULL OR g.source = p_source)
      AND (p_guest IS NULL OR g.is_guest = p_guest)
  )
  SELECT
    t.screen,
    count(*)::bigint,
    round((avg(t.seconds))::numeric, 2),
    round((percentile_cont(0.5) WITHIN GROUP (ORDER BY t.seconds))::numeric, 2),
    round((percentile_cont(0.95) WITHIN GROUP (ORDER BY t.seconds))::numeric, 2)
  FROM t
  WHERE t.seconds IS NOT NULL AND t.seconds >= 0 AND t.seconds <= 1800
  GROUP BY t.screen
  ORDER BY count(*) DESC, t.screen
$$;

-- 7.8 Exit screens: the last screen_view of each game session -------------------
DROP FUNCTION IF EXISTS public.game_stats_exit_screens(timestamptz, timestamptz, uuid, text, text, text, boolean);
CREATE OR REPLACE FUNCTION public.game_stats_exit_screens(
  p_from    timestamptz,
  p_to      timestamptz,
  p_org_id  uuid    DEFAULT NULL,
  p_game_id text    DEFAULT NULL,
  p_device  text    DEFAULT NULL,
  p_source  text    DEFAULT NULL,
  p_guest   boolean DEFAULT NULL
)
RETURNS TABLE (screen text, game_sessions bigint, share numeric)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH last_view AS (
    SELECT DISTINCT ON (g.organization_id, g.game_session_id)
      g.metadata->>'screen' AS screen
    FROM public.game_events g
    WHERE g.event_name = 'screen_view'
      AND g.occurred_at >= p_from AND g.occurred_at < p_to
      AND g.game_session_id IS NOT NULL
      AND NULLIF(g.metadata->>'screen', '') IS NOT NULL
      AND (p_org_id IS NULL OR g.organization_id = p_org_id)
      AND (p_game_id IS NULL OR g.game_id = p_game_id)
      AND (p_device IS NULL OR g.device_type = p_device)
      AND (p_source IS NULL OR g.source = p_source)
      AND (p_guest IS NULL OR g.is_guest = p_guest)
    ORDER BY g.organization_id, g.game_session_id, g.occurred_at DESC, g.seq DESC NULLS LAST
  )
  SELECT
    lv.screen,
    count(*)::bigint,
    round(count(*)::numeric / NULLIF(sum(count(*)) OVER (), 0), 4)
  FROM last_view lv
  GROUP BY lv.screen
  ORDER BY count(*) DESC, lv.screen
$$;

-- 7.9 DAU / WAU / MAU per day ---------------------------------------------------
-- Rolling distinct actors over 1 / 7 / 30 days ending on each day. Reads 29 days
-- before p_from so the first days of the window are complete.
DROP FUNCTION IF EXISTS public.game_stats_active_players(timestamptz, timestamptz, uuid, text, text, text, boolean, text);
CREATE OR REPLACE FUNCTION public.game_stats_active_players(
  p_from    timestamptz,
  p_to      timestamptz,
  p_org_id  uuid    DEFAULT NULL,
  p_game_id text    DEFAULT NULL,
  p_device  text    DEFAULT NULL,
  p_source  text    DEFAULT NULL,
  p_guest   boolean DEFAULT NULL,
  p_tz      text    DEFAULT 'UTC'
)
RETURNS TABLE (day date, dau bigint, wau bigint, mau bigint)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH days AS (
    SELECT d::date AS day
    FROM generate_series(
      (p_from AT TIME ZONE p_tz)::date::timestamp,
      ((p_to - interval '1 microsecond') AT TIME ZONE p_tz)::date::timestamp,
      interval '1 day'
    ) AS d
  ),
  acts AS (
    SELECT DISTINCT g.actor_id, (g.occurred_at AT TIME ZONE p_tz)::date AS day
    FROM public.game_events g
    WHERE g.occurred_at >= p_from - interval '29 days' AND g.occurred_at < p_to
      AND g.actor_id IS NOT NULL
      AND (p_org_id IS NULL OR g.organization_id = p_org_id)
      AND (p_game_id IS NULL OR g.game_id = p_game_id)
      AND (p_device IS NULL OR g.device_type = p_device)
      AND (p_source IS NULL OR g.source = p_source)
      AND (p_guest IS NULL OR g.is_guest = p_guest)
  )
  SELECT
    d.day,
    (count(DISTINCT a.actor_id) FILTER (WHERE a.day = d.day))::bigint,
    (count(DISTINCT a.actor_id) FILTER (WHERE a.day > d.day - 7))::bigint,
    count(DISTINCT a.actor_id)::bigint
  FROM days d
  LEFT JOIN acts a ON a.day BETWEEN d.day - 29 AND d.day
  GROUP BY d.day
  ORDER BY d.day
$$;

-- 7.10 D1 / D7 / D30 retention by first-seen cohort ------------------------------
-- First seen = the first day an actor has any game event (all history, not only
-- the window). Dn = the actor is active exactly n days after the cohort day. A
-- rate is NULL while the cohort is younger than n days. Device and source are
-- not filters here: they would change an actor's cohort.
DROP FUNCTION IF EXISTS public.game_stats_retention(timestamptz, timestamptz, uuid, text, boolean, text);
CREATE OR REPLACE FUNCTION public.game_stats_retention(
  p_from    timestamptz,
  p_to      timestamptz,
  p_org_id  uuid    DEFAULT NULL,
  p_game_id text    DEFAULT NULL,
  p_guest   boolean DEFAULT NULL,
  p_tz      text    DEFAULT 'UTC'
)
RETURNS TABLE (
  cohort_day date, cohort_size bigint,
  d1_retained bigint, d7_retained bigint, d30_retained bigint,
  d1_rate numeric, d7_rate numeric, d30_rate numeric
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH acts AS (
    SELECT DISTINCT g.actor_id, (g.occurred_at AT TIME ZONE p_tz)::date AS day
    FROM public.game_events g
    WHERE g.actor_id IS NOT NULL
      AND (p_org_id IS NULL OR g.organization_id = p_org_id)
      AND (p_game_id IS NULL OR g.game_id = p_game_id)
      AND (p_guest IS NULL OR g.is_guest = p_guest)
  ),
  first_seen AS (
    SELECT a.actor_id, min(a.day) AS first_day FROM acts a GROUP BY a.actor_id
  ),
  cohort AS (
    SELECT fs.actor_id, fs.first_day
    FROM first_seen fs
    WHERE fs.first_day BETWEEN (p_from AT TIME ZONE p_tz)::date
                           AND ((p_to - interval '1 microsecond') AT TIME ZONE p_tz)::date
  ),
  per_actor AS (
    SELECT c.first_day, c.actor_id,
      COALESCE(bool_or(a.day = c.first_day + 1), false)  AS d1,
      COALESCE(bool_or(a.day = c.first_day + 7), false)  AS d7,
      COALESCE(bool_or(a.day = c.first_day + 30), false) AS d30
    FROM cohort c
    LEFT JOIN acts a ON a.actor_id = c.actor_id AND a.day > c.first_day AND a.day <= c.first_day + 30
    GROUP BY c.first_day, c.actor_id
  ),
  today AS (SELECT (now() AT TIME ZONE p_tz)::date AS d)
  SELECT
    pa.first_day,
    count(*)::bigint,
    (count(*) FILTER (WHERE pa.d1))::bigint,
    (count(*) FILTER (WHERE pa.d7))::bigint,
    (count(*) FILTER (WHERE pa.d30))::bigint,
    CASE WHEN pa.first_day + 1  <= (SELECT t.d FROM today t) THEN round(count(*) FILTER (WHERE pa.d1)::numeric  / count(*), 4) END,
    CASE WHEN pa.first_day + 7  <= (SELECT t.d FROM today t) THEN round(count(*) FILTER (WHERE pa.d7)::numeric  / count(*), 4) END,
    CASE WHEN pa.first_day + 30 <= (SELECT t.d FROM today t) THEN round(count(*) FILTER (WHERE pa.d30)::numeric / count(*), 4) END
  FROM per_actor pa
  GROUP BY pa.first_day
  ORDER BY pa.first_day
$$;

-- 7.11 Load time p50 / p95 (game_loaded.load_ms) --------------------------------
-- p_group_by: all | device | browser | os | connection | build | version | source | country
DROP FUNCTION IF EXISTS public.game_stats_load_times(timestamptz, timestamptz, uuid, text, text, text, boolean, text);
CREATE OR REPLACE FUNCTION public.game_stats_load_times(
  p_from      timestamptz,
  p_to        timestamptz,
  p_org_id    uuid    DEFAULT NULL,
  p_game_id   text    DEFAULT NULL,
  p_device    text    DEFAULT NULL,
  p_source    text    DEFAULT NULL,
  p_guest     boolean DEFAULT NULL,
  p_group_by  text    DEFAULT 'all'
)
RETURNS TABLE (group_key text, loads bigint, avg_ms numeric, p50_ms numeric, p95_ms numeric, from_cache_share numeric)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH l AS (
    SELECT
      CASE p_group_by
        WHEN 'device'     THEN COALESCE(g.device_type, 'unknown')
        WHEN 'browser'    THEN COALESCE(g.browser, 'unknown')
        WHEN 'os'         THEN COALESCE(g.os, 'unknown')
        WHEN 'connection' THEN COALESCE(g.connection_type, 'unknown')
        WHEN 'build'      THEN COALESCE(g.build, 'unknown')
        WHEN 'version'    THEN COALESCE(g.game_version, 'unknown')
        WHEN 'source'     THEN COALESCE(g.source, 'direct')
        WHEN 'country'    THEN COALESCE(g.country_code, 'unknown')
        ELSE 'all'
      END AS gkey,
      public.game_try_numeric(g.metadata->>'load_ms')::double precision AS load_ms,
      (lower(COALESCE(g.metadata->>'from_cache', '')) = 'true') AS from_cache
    FROM public.game_events g
    WHERE g.event_name = 'game_loaded'
      AND g.occurred_at >= p_from AND g.occurred_at < p_to
      AND (p_org_id IS NULL OR g.organization_id = p_org_id)
      AND (p_game_id IS NULL OR g.game_id = p_game_id)
      AND (p_device IS NULL OR g.device_type = p_device)
      AND (p_source IS NULL OR g.source = p_source)
      AND (p_guest IS NULL OR g.is_guest = p_guest)
  )
  SELECT
    l.gkey,
    count(*)::bigint,
    round((avg(l.load_ms))::numeric, 0),
    round((percentile_cont(0.5)  WITHIN GROUP (ORDER BY l.load_ms))::numeric, 0),
    round((percentile_cont(0.95) WITHIN GROUP (ORDER BY l.load_ms))::numeric, 0),
    round(count(*) FILTER (WHERE l.from_cache)::numeric / count(*), 4)
  FROM l
  WHERE l.load_ms IS NOT NULL AND l.load_ms >= 0
  GROUP BY l.gkey
  ORDER BY count(*) DESC, l.gkey
$$;

-- 7.12 Error rate: share of game sessions that logged a game_error --------------
-- p_group_by: same keys as game_stats_load_times. crash_free_rate = 1 - error_rate.
DROP FUNCTION IF EXISTS public.game_stats_error_rate(timestamptz, timestamptz, uuid, text, text, text, boolean, text);
CREATE OR REPLACE FUNCTION public.game_stats_error_rate(
  p_from      timestamptz,
  p_to        timestamptz,
  p_org_id    uuid    DEFAULT NULL,
  p_game_id   text    DEFAULT NULL,
  p_device    text    DEFAULT NULL,
  p_source    text    DEFAULT NULL,
  p_guest     boolean DEFAULT NULL,
  p_group_by  text    DEFAULT 'all'
)
RETURNS TABLE (group_key text, game_sessions bigint, sessions_with_error bigint, errors bigint, error_rate numeric, crash_free_rate numeric)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH e AS (
    SELECT
      CASE p_group_by
        WHEN 'device'     THEN COALESCE(g.device_type, 'unknown')
        WHEN 'browser'    THEN COALESCE(g.browser, 'unknown')
        WHEN 'os'         THEN COALESCE(g.os, 'unknown')
        WHEN 'connection' THEN COALESCE(g.connection_type, 'unknown')
        WHEN 'build'      THEN COALESCE(g.build, 'unknown')
        WHEN 'version'    THEN COALESCE(g.game_version, 'unknown')
        WHEN 'source'     THEN COALESCE(g.source, 'direct')
        WHEN 'country'    THEN COALESCE(g.country_code, 'unknown')
        ELSE 'all'
      END AS gkey,
      g.organization_id::text || '/' || g.game_session_id AS sess_key,
      (g.event_name = 'game_error') AS is_error
    FROM public.game_events g
    WHERE g.occurred_at >= p_from AND g.occurred_at < p_to
      AND g.game_session_id IS NOT NULL
      AND (p_org_id IS NULL OR g.organization_id = p_org_id)
      AND (p_game_id IS NULL OR g.game_id = p_game_id)
      AND (p_device IS NULL OR g.device_type = p_device)
      AND (p_source IS NULL OR g.source = p_source)
      AND (p_guest IS NULL OR g.is_guest = p_guest)
  )
  SELECT
    e.gkey,
    count(DISTINCT e.sess_key)::bigint,
    (count(DISTINCT e.sess_key) FILTER (WHERE e.is_error))::bigint,
    (count(*) FILTER (WHERE e.is_error))::bigint,
    round(count(DISTINCT e.sess_key) FILTER (WHERE e.is_error)::numeric
          / NULLIF(count(DISTINCT e.sess_key), 0), 4),
    round(1 - count(DISTINCT e.sess_key) FILTER (WHERE e.is_error)::numeric
          / NULLIF(count(DISTINCT e.sess_key), 0), 4)
  FROM e
  GROUP BY e.gkey
  ORDER BY count(DISTINCT e.sess_key) DESC, e.gkey
$$;

-- 7.13 Error breakdown by phase and code ------------------------------------------
DROP FUNCTION IF EXISTS public.game_stats_error_breakdown(timestamptz, timestamptz, uuid, text, text, text, boolean);
CREATE OR REPLACE FUNCTION public.game_stats_error_breakdown(
  p_from    timestamptz,
  p_to      timestamptz,
  p_org_id  uuid    DEFAULT NULL,
  p_game_id text    DEFAULT NULL,
  p_device  text    DEFAULT NULL,
  p_source  text    DEFAULT NULL,
  p_guest   boolean DEFAULT NULL
)
RETURNS TABLE (phase text, code text, errors bigint, game_sessions bigint, last_seen_at timestamptz)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    COALESCE(NULLIF(g.metadata->>'phase', ''), 'unknown'),
    COALESCE(NULLIF(g.metadata->>'code', ''), 'unknown'),
    count(*)::bigint,
    count(DISTINCT g.organization_id::text || '/' || g.game_session_id)::bigint,
    max(g.occurred_at)
  FROM public.game_events g
  WHERE g.event_name = 'game_error'
    AND g.occurred_at >= p_from AND g.occurred_at < p_to
    AND (p_org_id IS NULL OR g.organization_id = p_org_id)
    AND (p_game_id IS NULL OR g.game_id = p_game_id)
    AND (p_device IS NULL OR g.device_type = p_device)
    AND (p_source IS NULL OR g.source = p_source)
    AND (p_guest IS NULL OR g.is_guest = p_guest)
  GROUP BY 1, 2
  ORDER BY count(*) DESC, 1, 2
$$;

-- ---------------------------------------------------------------------------
-- 8. Privileges: nothing here is reachable by anon. Signed-in users and the
--    service role (admin panel) get SELECT / EXECUTE; RLS does the tenant cut.
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.game_events, public.game_match_facts FROM PUBLIC, anon;
GRANT SELECT ON public.game_events, public.game_match_facts TO authenticated, service_role;

DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (p.proname LIKE 'game\_stats\_%' OR p.proname IN ('game_try_numeric', 'game_try_int'))
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn.sig);
  END LOOP;
END $$;
