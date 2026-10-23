-- =============================================================================
-- Migration 1333: extra rollups for the game panels (BS-ANALYTICS-001).
--
-- Builds on 1332 (views game_events / game_match_facts, helpers game_try_*).
-- Three small read-only functions the tenant Game tab and the admin global
-- panels need and 1332 does not cover:
--
--   game_stats_player_summary  distinct players (signed-in vs guest), players
--                              that played a match, matches per player, game
--                              session count and session time (avg / median / p95).
--   game_stats_games           which (organization, game) pairs have game events
--                              in a window; feeds the admin organization / game
--                              selectors without scanning in application code.
--   game_stats_pick_trend      daily picks of the top-N fighters, skins or
--                              stages, for the trend charts.
--
-- Same security model as 1332: SECURITY INVOKER functions over security_invoker
-- views. A tenant user is cut to their own organization by RLS whatever p_org_id
-- they pass; the cross-org admin panel calls them with the service role. No
-- SECURITY DEFINER, nothing for anon.
--
-- Time windows are [p_from, p_to). Day buckets use p_tz (default UTC).
-- Idempotent: safe to run twice.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Player summary
--    A "player" is an actor as defined by game_events.actor_id (the signed-in
--    player id, else the browser visitor). A game session lasts from its first
--    to its last game event; sessions of one event, or longer than 4 hours
--    (a tab left open), are not timed.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.game_stats_player_summary(timestamptz, timestamptz, uuid, text, text, text, boolean);
CREATE OR REPLACE FUNCTION public.game_stats_player_summary(
  p_from    timestamptz,
  p_to      timestamptz,
  p_org_id  uuid    DEFAULT NULL,
  p_game_id text    DEFAULT NULL,
  p_device  text    DEFAULT NULL,
  p_source  text    DEFAULT NULL,
  p_guest   boolean DEFAULT NULL
)
RETURNS TABLE (
  players bigint, signed_in_players bigint, guest_players bigint,
  players_with_match bigint, matches_started bigint, matches_per_player numeric,
  game_sessions bigint, timed_sessions bigint,
  avg_session_s numeric, median_session_s numeric, p95_session_s numeric
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH e AS (
    SELECT g.organization_id, g.actor_id, g.player_id, g.game_session_id, g.occurred_at
    FROM public.game_events g
    WHERE g.occurred_at >= p_from AND g.occurred_at < p_to
      AND g.actor_id IS NOT NULL
      AND (p_org_id IS NULL OR g.organization_id = p_org_id)
      AND (p_game_id IS NULL OR g.game_id = p_game_id)
      AND (p_device IS NULL OR g.device_type = p_device)
      AND (p_source IS NULL OR g.source = p_source)
      AND (p_guest IS NULL OR g.is_guest = p_guest)
  ),
  actors AS (
    SELECT e.organization_id, e.actor_id, bool_or(e.player_id IS NOT NULL) AS signed_in
    FROM e
    GROUP BY e.organization_id, e.actor_id
  ),
  played AS (
    SELECT f.organization_id, f.actor_id, count(*) AS matches
    FROM public.game_match_facts f
    WHERE f.started_at >= p_from AND f.started_at < p_to
      AND (p_org_id IS NULL OR f.organization_id = p_org_id)
      AND (p_game_id IS NULL OR f.game_id = p_game_id)
      AND (p_device IS NULL OR f.device_type = p_device)
      AND (p_source IS NULL OR f.source = p_source)
      AND (p_guest IS NULL OR f.is_guest = p_guest)
      AND f.actor_id IS NOT NULL
    GROUP BY f.organization_id, f.actor_id
  ),
  sess AS (
    SELECT e.organization_id, e.game_session_id,
           count(*) AS events,
           extract(epoch FROM (max(e.occurred_at) - min(e.occurred_at)))::double precision AS dur
    FROM e
    WHERE e.game_session_id IS NOT NULL
    GROUP BY e.organization_id, e.game_session_id
  ),
  timed AS (
    SELECT s.dur FROM sess s WHERE s.events >= 2 AND s.dur >= 0 AND s.dur <= 14400
  ),
  a AS (
    SELECT count(*)::bigint                                  AS players,
           (count(*) FILTER (WHERE signed_in))::bigint       AS signed_in_players,
           (count(*) FILTER (WHERE NOT signed_in))::bigint   AS guest_players
    FROM actors
  ),
  p AS (
    SELECT count(*)::bigint AS players_with_match,
           COALESCE(sum(matches), 0)::bigint AS matches_started
    FROM played
  ),
  s AS (
    SELECT (SELECT count(*) FROM sess)::bigint AS game_sessions,
           count(*)::bigint AS timed_sessions,
           round((avg(dur))::numeric, 1) AS avg_session_s,
           round((percentile_cont(0.5)  WITHIN GROUP (ORDER BY dur))::numeric, 1) AS median_session_s,
           round((percentile_cont(0.95) WITHIN GROUP (ORDER BY dur))::numeric, 1) AS p95_session_s
    FROM timed
  )
  SELECT
    a.players, a.signed_in_players, a.guest_players,
    p.players_with_match, p.matches_started,
    round(p.matches_started::numeric / NULLIF(p.players_with_match, 0), 2),
    s.game_sessions, s.timed_sessions, s.avg_session_s, s.median_session_s, s.p95_session_s
  FROM a, p, s
$$;

-- ---------------------------------------------------------------------------
-- 2. Which games each organization has events for in a window
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.game_stats_games(timestamptz, timestamptz, uuid);
CREATE OR REPLACE FUNCTION public.game_stats_games(
  p_from    timestamptz,
  p_to      timestamptz,
  p_org_id  uuid DEFAULT NULL
)
RETURNS TABLE (organization_id uuid, game_id text, events bigint, players bigint, last_event_at timestamptz)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    g.organization_id,
    g.game_id,
    count(*)::bigint,
    count(DISTINCT g.actor_id)::bigint,
    max(g.occurred_at)
  FROM public.game_events g
  WHERE g.occurred_at >= p_from AND g.occurred_at < p_to
    AND (p_org_id IS NULL OR g.organization_id = p_org_id)
  GROUP BY g.organization_id, g.game_id
  ORDER BY count(*) DESC, g.organization_id, g.game_id
$$;

-- ---------------------------------------------------------------------------
-- 3. Daily picks of the top-N items
--    p_kind: 'fighter' | 'skin' | 'stage'. item = fighter_id, "fighter/skin"
--    (skin "-" when unknown) or stage_id. Only the p_top most picked items of
--    the whole window are returned, so the result stays under the API row cap.
--    Side p2 counts only when it is not a CPU, unless p_include_cpu.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.game_stats_pick_trend(text, timestamptz, timestamptz, uuid, text, text, text, boolean, boolean, text, integer);
CREATE OR REPLACE FUNCTION public.game_stats_pick_trend(
  p_kind        text,
  p_from        timestamptz,
  p_to          timestamptz,
  p_org_id      uuid    DEFAULT NULL,
  p_game_id     text    DEFAULT NULL,
  p_device      text    DEFAULT NULL,
  p_source      text    DEFAULT NULL,
  p_guest       boolean DEFAULT NULL,
  p_include_cpu boolean DEFAULT false,
  p_tz          text    DEFAULT 'UTC',
  p_top         integer DEFAULT 8
)
RETURNS TABLE (day date, item text, picks bigint)
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
    SELECT (x.started_at AT TIME ZONE p_tz)::date AS pday,
           CASE WHEN p_kind = 'skin' THEN x.fighter_id || '/' || COALESCE(x.skin_id, '-') ELSE x.fighter_id END AS pitem
    FROM (
      SELECT m.started_at, m.p1_fighter AS fighter_id, m.p1_skin AS skin_id FROM m
      UNION ALL
      SELECT m.started_at, m.p2_fighter, m.p2_skin FROM m
      WHERE p_include_cpu OR m.p2_control IS DISTINCT FROM 'cpu'
    ) x
    WHERE p_kind IN ('fighter', 'skin') AND x.fighter_id IS NOT NULL
    UNION ALL
    SELECT (m.started_at AT TIME ZONE p_tz)::date, m.stage_id
    FROM m
    WHERE p_kind = 'stage' AND m.stage_id IS NOT NULL
  ),
  top_items AS (
    SELECT pk.pitem
    FROM picked pk
    GROUP BY pk.pitem
    ORDER BY count(*) DESC, pk.pitem
    LIMIT GREATEST(p_top, 1)
  )
  SELECT pk.pday, pk.pitem, count(*)::bigint
  FROM picked pk
  JOIN top_items t ON t.pitem = pk.pitem
  GROUP BY pk.pday, pk.pitem
  ORDER BY pk.pday, pk.pitem
$$;

-- ---------------------------------------------------------------------------
-- 4. Privileges (same as 1332)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('game_stats_player_summary', 'game_stats_games', 'game_stats_pick_trend')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn.sig);
  END LOOP;
END $$;
