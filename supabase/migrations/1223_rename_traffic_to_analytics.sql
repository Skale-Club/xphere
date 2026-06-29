-- =============================================================================
-- Migration 1223: rename the "traffic" module to "analytics".
-- Full physical rename: 6 tables, indexes, RLS policies, updated_at triggers.
-- Two SECURITY DEFINER functions reference the tables by name (Postgres does NOT
-- rewrite function bodies on table rename) so they are recreated below verbatim
-- with the new table names. Finally, the stored RBAC permission key is migrated.
--
-- Data is preserved (ALTER TABLE ... RENAME keeps rows, FK constraints follow).
-- The application now references analytics_* names; the /api/traffic/* HTTP routes
-- are kept alive via a next.config rewrite to /api/analytics/* for already-deployed
-- tracking scripts.
-- =============================================================================

-- ---- Tables ----------------------------------------------------------------
ALTER TABLE public.traffic_setups        RENAME TO analytics_setups;
ALTER TABLE public.traffic_visitors      RENAME TO analytics_visitors;
ALTER TABLE public.traffic_sessions      RENAME TO analytics_sessions;
ALTER TABLE public.traffic_pageviews     RENAME TO analytics_pageviews;
ALTER TABLE public.traffic_events        RENAME TO analytics_events;
ALTER TABLE public.traffic_attributions  RENAME TO analytics_attributions;

-- ---- Indexes ---------------------------------------------------------------
ALTER INDEX IF EXISTS idx_traffic_visitors_org           RENAME TO idx_analytics_visitors_org;
ALTER INDEX IF EXISTS idx_traffic_visitors_contact       RENAME TO idx_analytics_visitors_contact;
ALTER INDEX IF EXISTS idx_traffic_sessions_org           RENAME TO idx_analytics_sessions_org;
ALTER INDEX IF EXISTS idx_traffic_sessions_visitor       RENAME TO idx_analytics_sessions_visitor;
ALTER INDEX IF EXISTS idx_traffic_sessions_started_at    RENAME TO idx_analytics_sessions_started_at;
ALTER INDEX IF EXISTS idx_traffic_sessions_utm_campaign  RENAME TO idx_analytics_sessions_utm_campaign;
ALTER INDEX IF EXISTS idx_traffic_pageviews_org_occurred RENAME TO idx_analytics_pageviews_org_occurred;
ALTER INDEX IF EXISTS idx_traffic_pageviews_session      RENAME TO idx_analytics_pageviews_session;
ALTER INDEX IF EXISTS idx_traffic_pageviews_path         RENAME TO idx_analytics_pageviews_path;
ALTER INDEX IF EXISTS idx_traffic_events_org_occurred    RENAME TO idx_analytics_events_org_occurred;
ALTER INDEX IF EXISTS idx_traffic_events_session         RENAME TO idx_analytics_events_session;
ALTER INDEX IF EXISTS idx_traffic_events_type            RENAME TO idx_analytics_events_type;
ALTER INDEX IF EXISTS idx_traffic_attributions_visitor   RENAME TO idx_analytics_attributions_visitor;
ALTER INDEX IF EXISTS idx_traffic_attributions_org       RENAME TO idx_analytics_attributions_org;

-- ---- RLS policies (rename only; USING/CHECK expressions unchanged) ----------
ALTER POLICY "traffic_setups_select"        ON public.analytics_setups       RENAME TO "analytics_setups_select";
ALTER POLICY "traffic_setups_insert"        ON public.analytics_setups       RENAME TO "analytics_setups_insert";
ALTER POLICY "traffic_setups_update"        ON public.analytics_setups       RENAME TO "analytics_setups_update";
ALTER POLICY "traffic_visitors_select"      ON public.analytics_visitors     RENAME TO "analytics_visitors_select";
ALTER POLICY "traffic_sessions_select"      ON public.analytics_sessions     RENAME TO "analytics_sessions_select";
ALTER POLICY "traffic_pageviews_select"     ON public.analytics_pageviews    RENAME TO "analytics_pageviews_select";
ALTER POLICY "traffic_events_select"        ON public.analytics_events       RENAME TO "analytics_events_select";
ALTER POLICY "traffic_attributions_select"  ON public.analytics_attributions RENAME TO "analytics_attributions_select";

-- ---- updated_at triggers ---------------------------------------------------
ALTER TRIGGER trg_traffic_setups_set_updated_at       ON public.analytics_setups       RENAME TO trg_analytics_setups_set_updated_at;
ALTER TRIGGER trg_traffic_visitors_set_updated_at     ON public.analytics_visitors     RENAME TO trg_analytics_visitors_set_updated_at;
ALTER TRIGGER trg_traffic_sessions_set_updated_at     ON public.analytics_sessions     RENAME TO trg_analytics_sessions_set_updated_at;
ALTER TRIGGER trg_traffic_attributions_set_updated_at ON public.analytics_attributions RENAME TO trg_analytics_attributions_set_updated_at;

-- ---- Recreate dependent functions with new table names ---------------------
-- get_ads_attribution: body identical to migration 1110, traffic_* -> analytics_*.
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

  filtered_sessions AS (
    SELECT id, utm_source, utm_medium, utm_campaign, visitor_id
    FROM analytics_sessions
    WHERE organization_id = (SELECT id FROM org)
      AND started_at BETWEEN p_from AND p_to
      AND utm_campaign IS NOT NULL
      AND (
        p_platform IS NULL
        OR (p_platform = 'meta'   AND utm_source IN ('meta','facebook','instagram','fb'))
        OR (p_platform = 'google' AND utm_source IN ('google','adwords','google-ads'))
      )
  ),

  visitor_signal AS (
    SELECT
      fs.utm_source, fs.utm_medium, fs.utm_campaign,
      fs.id AS session_id,
      tv.contact_id
    FROM filtered_sessions fs
    JOIN analytics_visitors tv ON tv.id = fs.visitor_id
      AND tv.contact_id IS NOT NULL
  ),

  event_signal AS (
    SELECT
      fs.utm_source, fs.utm_medium, fs.utm_campaign,
      fs.id AS session_id,
      te.contact_id
    FROM filtered_sessions fs
    JOIN analytics_events te ON te.session_id = fs.id
      AND te.contact_id IS NOT NULL
  ),

  all_contacts AS (
    SELECT utm_source, utm_medium, utm_campaign, contact_id
    FROM visitor_signal
    UNION
    SELECT utm_source, utm_medium, utm_campaign, contact_id
    FROM event_signal
  ),

  campaign_contacts AS (
    SELECT
      utm_source, utm_medium, utm_campaign,
      COUNT(DISTINCT contact_id) AS contact_count
    FROM all_contacts
    GROUP BY utm_source, utm_medium, utm_campaign
  ),

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

  deduped_opps AS (
    SELECT DISTINCT utm_source, utm_medium, utm_campaign, opp_id, opp_value
    FROM contact_opps
    WHERE opp_id IS NOT NULL
  ),

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

-- merge_contacts: body identical to migration 1057, with the two analytics FK
-- rewrites updated (traffic_events -> analytics_events, traffic_visitors ->
-- analytics_visitors). Everything else is unchanged.
CREATE OR REPLACE FUNCTION public.merge_contacts(
  survivor_id uuid,
  archived_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  survivor_org uuid;
  archived_org uuid;
  survivor_status text;
  archived_status text;
  caller_uid uuid := auth.uid();
BEGIN
  -- Guard 1: same-id (Pitfall 1)
  IF survivor_id = archived_id THEN
    RAISE EXCEPTION 'merge_contacts: survivor and archived must differ';
  END IF;

  -- Guard 2: load + lock both rows, check existence
  SELECT org_id, identity_status INTO survivor_org, survivor_status
    FROM public.contacts WHERE id = survivor_id FOR UPDATE;
  IF survivor_org IS NULL THEN
    RAISE EXCEPTION 'merge_contacts: survivor % not found', survivor_id;
  END IF;

  SELECT org_id, identity_status INTO archived_org, archived_status
    FROM public.contacts WHERE id = archived_id FOR UPDATE;
  IF archived_org IS NULL THEN
    RAISE EXCEPTION 'merge_contacts: archived % not found', archived_id;
  END IF;

  -- Guard 3: already-archived (Pitfall 2 + Pitfall 10 chain prevention)
  IF survivor_status = 'archived_duplicate' THEN
    RAISE EXCEPTION 'merge_contacts: survivor % is already archived', survivor_id;
  END IF;
  IF archived_status = 'archived_duplicate' THEN
    RAISE EXCEPTION 'merge_contacts: % is already archived', archived_id;
  END IF;

  -- Guard 4: cross-org (Pitfall 3)
  IF survivor_org <> archived_org THEN
    RAISE EXCEPTION 'merge_contacts: cross-org merge not allowed (% vs %)',
      survivor_org, archived_org;
  END IF;

  -- FK rewrites (verified 8-table list against prod 2026-05-25)
  -- Direct UPDATE for tables with no composite uniqueness:
  UPDATE public.bookings           SET linked_contact_id = survivor_id WHERE linked_contact_id = archived_id;
  UPDATE public.call_logs          SET contact_id        = survivor_id WHERE contact_id        = archived_id;
  UPDATE public.conversations      SET contact_id        = survivor_id WHERE contact_id        = archived_id;
  UPDATE public.opportunities      SET contact_id        = survivor_id WHERE contact_id        = archived_id;
  UPDATE public.analytics_events   SET contact_id        = survivor_id WHERE contact_id        = archived_id;
  UPDATE public.analytics_visitors SET contact_id        = survivor_id WHERE contact_id        = archived_id;

  -- Join tables (Pitfall 4): dedupe-then-delete to avoid PK/UNIQUE violations.
  INSERT INTO public.contact_tags (contact_id, tag_id, tagged_at, tagged_by)
    SELECT survivor_id, tag_id, tagged_at, tagged_by
      FROM public.contact_tags
     WHERE contact_id = archived_id
    ON CONFLICT DO NOTHING;
  DELETE FROM public.contact_tags WHERE contact_id = archived_id;

  INSERT INTO public.opportunity_contacts (org_id, opportunity_id, contact_id, is_primary)
    SELECT org_id, opportunity_id, survivor_id, is_primary
      FROM public.opportunity_contacts
     WHERE contact_id = archived_id
    ON CONFLICT DO NOTHING;
  DELETE FROM public.opportunity_contacts WHERE contact_id = archived_id;

  -- Mark archived row (D-02b)
  UPDATE public.contacts
     SET identity_status        = 'archived_duplicate',
         merged_into_contact_id = survivor_id,
         updated_at             = now()
   WHERE id = archived_id;

  -- Audit log (D-02c)
  INSERT INTO public.contact_merge_log
    (org_id, survivor_id, archived_id, merged_by, merged_at, strategy)
  VALUES
    (survivor_org, survivor_id, archived_id, caller_uid, now(), 'manual');
END;
$$;

-- ---- Migrate stored RBAC permission key ------------------------------------
UPDATE public.role_permissions
   SET permission_key = 'analytics.view'
 WHERE permission_key = 'traffic.view';
