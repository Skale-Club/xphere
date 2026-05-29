-- =============================================================================
-- Migration 1109: get_ads_attribution — SECURITY DEFINER function for
-- campaign-level lead & revenue attribution via UTM → visitor → contact → opp.
-- Uses two signals:
--   1. traffic_visitors.contact_id  (visitor identified any time)
--   2. traffic_events.contact_id    (contact_created event during session)
-- Platform filter: 'meta' → utm_source IN (meta,facebook,instagram,fb)
--                 'google' → utm_source IN (google,adwords,google-ads)
--                 NULL → all paid sources with utm_campaign set
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_ads_attribution(
  p_from      TIMESTAMPTZ,
  p_to        TIMESTAMPTZ,
  p_platform  TEXT DEFAULT NULL   -- 'meta' | 'google' | NULL
)
RETURNS TABLE (
  utm_source           TEXT,
  utm_medium           TEXT,
  utm_campaign         TEXT,
  sessions             BIGINT,
  identified_contacts  BIGINT,
  opportunities        BIGINT,
  revenue              NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH org AS (
    SELECT get_current_org_id() AS id
  ),

  -- Signal 1: sessions where visitor has a linked contact
  visitor_signal AS (
    SELECT
      ts.utm_source,
      ts.utm_medium,
      ts.utm_campaign,
      ts.id AS session_id,
      tv.contact_id
    FROM traffic_sessions ts
    JOIN traffic_visitors tv ON tv.id = ts.visitor_id
      AND tv.contact_id IS NOT NULL
    WHERE ts.organization_id = (SELECT id FROM org)
      AND ts.started_at BETWEEN p_from AND p_to
      AND ts.utm_campaign IS NOT NULL
      AND (
        p_platform IS NULL
        OR (p_platform = 'meta'   AND ts.utm_source IN ('meta','facebook','instagram','fb'))
        OR (p_platform = 'google' AND ts.utm_source IN ('google','adwords','google-ads'))
      )
  ),

  -- Signal 2: sessions where a contact_created event fired
  event_signal AS (
    SELECT
      ts.utm_source,
      ts.utm_medium,
      ts.utm_campaign,
      ts.id AS session_id,
      te.contact_id
    FROM traffic_sessions ts
    JOIN traffic_events te ON te.session_id = ts.id
      AND te.contact_id IS NOT NULL
    WHERE ts.organization_id = (SELECT id FROM org)
      AND ts.started_at BETWEEN p_from AND p_to
      AND ts.utm_campaign IS NOT NULL
      AND (
        p_platform IS NULL
        OR (p_platform = 'meta'   AND ts.utm_source IN ('meta','facebook','instagram','fb'))
        OR (p_platform = 'google' AND ts.utm_source IN ('google','adwords','google-ads'))
      )
  ),

  -- All sessions in range matching platform filter
  all_sessions AS (
    SELECT ts.utm_source, ts.utm_medium, ts.utm_campaign, ts.id AS session_id
    FROM traffic_sessions ts
    WHERE ts.organization_id = (SELECT id FROM org)
      AND ts.started_at BETWEEN p_from AND p_to
      AND ts.utm_campaign IS NOT NULL
      AND (
        p_platform IS NULL
        OR (p_platform = 'meta'   AND ts.utm_source IN ('meta','facebook','instagram','fb'))
        OR (p_platform = 'google' AND ts.utm_source IN ('google','adwords','google-ads'))
      )
  ),

  -- Union both contact signals, deduplicate by (campaign, contact)
  all_contacts AS (
    SELECT utm_source, utm_medium, utm_campaign, contact_id
    FROM visitor_signal
    UNION
    SELECT utm_source, utm_medium, utm_campaign, contact_id
    FROM event_signal
  ),

  -- Resolve opportunities linked to identified contacts
  contact_opps AS (
    SELECT
      ac.utm_source,
      ac.utm_medium,
      ac.utm_campaign,
      ac.contact_id,
      o.id AS opp_id,
      COALESCE(o.value, 0) AS opp_value
    FROM all_contacts ac
    LEFT JOIN opportunities o ON o.contact_id = ac.contact_id
      AND o.org_id = (SELECT id FROM org)
  )

  SELECT
    s.utm_source,
    s.utm_medium,
    s.utm_campaign,
    COUNT(DISTINCT s.session_id)          AS sessions,
    COUNT(DISTINCT co.contact_id)         AS identified_contacts,
    COUNT(DISTINCT co.opp_id)             AS opportunities,
    COALESCE(SUM(DISTINCT co.opp_value), 0) AS revenue
  FROM all_sessions s
  LEFT JOIN contact_opps co
    ON  co.utm_source    IS NOT DISTINCT FROM s.utm_source
    AND co.utm_medium    IS NOT DISTINCT FROM s.utm_medium
    AND co.utm_campaign  IS NOT DISTINCT FROM s.utm_campaign
  GROUP BY s.utm_source, s.utm_medium, s.utm_campaign
  ORDER BY revenue DESC, sessions DESC
  LIMIT 100
$$;
