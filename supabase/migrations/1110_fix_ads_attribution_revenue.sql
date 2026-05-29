-- =============================================================================
-- Migration 1110: fix get_ads_attribution revenue calculation.
-- Bug: SUM(DISTINCT opp_value) deduplicates by value, not by opp_id.
--      Two opportunities with the same value (e.g. both $1,000) were counted
--      as one. Fix: deduplicate on opp_id in a separate CTE before summing.
-- Also: identified_contacts and opportunities now come from pre-aggregated CTEs
--       instead of COUNT(DISTINCT ...) over the cross-joined sessions × opps,
--       which was safe but less efficient.
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

  -- Platform filter applied once, reused in every signal CTE
  filtered_sessions AS (
    SELECT id, utm_source, utm_medium, utm_campaign, visitor_id
    FROM traffic_sessions
    WHERE organization_id = (SELECT id FROM org)
      AND started_at BETWEEN p_from AND p_to
      AND utm_campaign IS NOT NULL
      AND (
        p_platform IS NULL
        OR (p_platform = 'meta'   AND utm_source IN ('meta','facebook','instagram','fb'))
        OR (p_platform = 'google' AND utm_source IN ('google','adwords','google-ads'))
      )
  ),

  -- Signal 1: sessions where the visitor has a linked contact
  visitor_signal AS (
    SELECT
      fs.utm_source, fs.utm_medium, fs.utm_campaign,
      fs.id AS session_id,
      tv.contact_id
    FROM filtered_sessions fs
    JOIN traffic_visitors tv ON tv.id = fs.visitor_id
      AND tv.contact_id IS NOT NULL
  ),

  -- Signal 2: sessions where a contact_id fired on a traffic_event
  event_signal AS (
    SELECT
      fs.utm_source, fs.utm_medium, fs.utm_campaign,
      fs.id AS session_id,
      te.contact_id
    FROM filtered_sessions fs
    JOIN traffic_events te ON te.session_id = fs.id
      AND te.contact_id IS NOT NULL
  ),

  -- Union both signals, deduplicate (campaign, contact) pairs
  all_contacts AS (
    SELECT utm_source, utm_medium, utm_campaign, contact_id
    FROM visitor_signal
    UNION
    SELECT utm_source, utm_medium, utm_campaign, contact_id
    FROM event_signal
  ),

  -- Contact count per campaign (already deduplicated by the UNION above)
  campaign_contacts AS (
    SELECT
      utm_source, utm_medium, utm_campaign,
      COUNT(DISTINCT contact_id) AS contact_count
    FROM all_contacts
    GROUP BY utm_source, utm_medium, utm_campaign
  ),

  -- Opportunities linked to identified contacts
  contact_opps AS (
    SELECT
      ac.utm_source, ac.utm_medium, ac.utm_campaign,
      ac.contact_id,
      o.id   AS opp_id,
      COALESCE(o.value, 0) AS opp_value
    FROM all_contacts ac
    LEFT JOIN opportunities o
      ON o.contact_id = ac.contact_id
     AND o.org_id = (SELECT id FROM org)
  ),

  -- Deduplicate by opp_id before summing revenue.
  -- Without this, an opp shared across two campaign rows would be double-counted,
  -- and two opps with identical values would be merged by SUM(DISTINCT value).
  deduped_opps AS (
    SELECT DISTINCT utm_source, utm_medium, utm_campaign, opp_id, opp_value
    FROM contact_opps
    WHERE opp_id IS NOT NULL
  ),

  -- Revenue and opportunity count per campaign
  campaign_revenue AS (
    SELECT
      utm_source, utm_medium, utm_campaign,
      COUNT(*)        AS opp_count,
      SUM(opp_value)  AS total_revenue
    FROM deduped_opps
    GROUP BY utm_source, utm_medium, utm_campaign
  )

  SELECT
    fs.utm_source,
    fs.utm_medium,
    fs.utm_campaign,
    COUNT(DISTINCT fs.id)                   AS sessions,
    COALESCE(cc.contact_count,  0)          AS identified_contacts,
    COALESCE(cr.opp_count,      0)          AS opportunities,
    COALESCE(cr.total_revenue,  0)          AS revenue
  FROM filtered_sessions fs
  LEFT JOIN campaign_contacts cc
    ON  cc.utm_source   IS NOT DISTINCT FROM fs.utm_source
    AND cc.utm_medium   IS NOT DISTINCT FROM fs.utm_medium
    AND cc.utm_campaign IS NOT DISTINCT FROM fs.utm_campaign
  LEFT JOIN campaign_revenue cr
    ON  cr.utm_source   IS NOT DISTINCT FROM fs.utm_source
    AND cr.utm_medium   IS NOT DISTINCT FROM fs.utm_medium
    AND cr.utm_campaign IS NOT DISTINCT FROM fs.utm_campaign
  GROUP BY
    fs.utm_source, fs.utm_medium, fs.utm_campaign,
    cc.contact_count,
    cr.opp_count, cr.total_revenue
  ORDER BY revenue DESC, sessions DESC
  LIMIT 100
$$;
