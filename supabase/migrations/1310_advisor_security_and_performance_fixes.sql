-- Migration 1310: Supabase advisor fixes (security + performance). Idempotent.
--
-- 1) rls_disabled_in_public (CRITICAL): platform_tracking_config had RLS off and
--    the default anon/authenticated grants, so anyone holding the public anon key
--    could rewrite the GTM container / Pixel ID that the root layout injects into
--    every page. The table is only read/written by the service-role client
--    (src/lib/tracking/config.ts, admin/tracking actions), which bypasses RLS, so
--    RLS with no policy plus revoked grants is a no-op for the app.
ALTER TABLE public.platform_tracking_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_tracking_config FROM anon, authenticated;

-- 2) security_definer_view: website_analyzer_candidates is read only by the
--    website-analyzer cron with the service-role key (BYPASSRLS), so switching
--    to security_invoker changes nothing for it while making base-table RLS apply
--    to any other caller.
ALTER VIEW public.website_analyzer_candidates SET (security_invoker = on);

-- 3) function_search_path_mutable: pin search_path on every public function
--    that lacked one. None is SECURITY DEFINER; the value matches the default
--    role search_path so name resolution inside the bodies is unchanged.
ALTER FUNCTION public.inbox_entries(uuid,text,text,text[],boolean,boolean,text,text,uuid,boolean,integer,integer) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.normalize_phone(text) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.sync_contact_name_fields() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.trigger_update_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.inbox_entries_count(uuid,text,text,text[],boolean,boolean,text,text,uuid,boolean) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.set_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.touch_project_space_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.enforce_contact_identity_at_commit_fn() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.touch_workflow_folder_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.ads_change_events_append_only() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.promote_channel_only_on_identity_fn() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.prevent_channel_identity_orphan_fn() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.set_billing_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.touch_project_folder_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.touch_whatsapp_providers_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.touch_telegram_bots_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.touch_whatsapp_cloud_accounts_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.touch_evolution_instances_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.set_booking_organizer() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.validate_event_type_location_kinds() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.touch_agent_group_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.update_zernio_whatsapp_templates_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.validate_booking_location_kind() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.inbox_unread_count() SET search_path = public, extensions, pg_temp;

-- 4) auth_rls_initplan: wrap auth.uid() in a scalar subquery so Postgres runs
--    it once per statement (InitPlan) instead of once per row. Expressions are
--    otherwise copied verbatim from the live pg_policies definitions.
ALTER POLICY contact_merge_exclusions_insert ON public.contact_merge_exclusions
  WITH CHECK (((org_id = ( SELECT get_current_org_id() AS get_current_org_id)) AND (EXISTS ( SELECT 1
   FROM org_members
  WHERE ((org_members.user_id = (select auth.uid())) AND (org_members.organization_id = contact_merge_exclusions.org_id) AND (org_members.role = ANY (ARRAY['admin'::user_role, 'owner'::user_role])))))));

ALTER POLICY contact_verifications_delete ON public.contact_verifications
  USING (((org_id = ( SELECT get_current_org_id() AS get_current_org_id)) AND (EXISTS ( SELECT 1
   FROM org_members
  WHERE ((org_members.user_id = (select auth.uid())) AND (org_members.organization_id = contact_verifications.org_id) AND (org_members.role = ANY (ARRAY['admin'::user_role, 'owner'::user_role])))))));

ALTER POLICY contact_verifications_insert ON public.contact_verifications
  WITH CHECK (((org_id = ( SELECT get_current_org_id() AS get_current_org_id)) AND (EXISTS ( SELECT 1
   FROM org_members
  WHERE ((org_members.user_id = (select auth.uid())) AND (org_members.organization_id = contact_verifications.org_id) AND (org_members.role = ANY (ARRAY['admin'::user_role, 'owner'::user_role])))))));

ALTER POLICY contact_verifications_update ON public.contact_verifications
  USING ((org_id = ( SELECT get_current_org_id() AS get_current_org_id)))
  WITH CHECK (((org_id = ( SELECT get_current_org_id() AS get_current_org_id)) AND (EXISTS ( SELECT 1
   FROM org_members
  WHERE ((org_members.user_id = (select auth.uid())) AND (org_members.organization_id = contact_verifications.org_id) AND (org_members.role = ANY (ARRAY['admin'::user_role, 'owner'::user_role])))))));

ALTER POLICY "own reads" ON public.conversation_reads
  USING ((user_id = (select auth.uid())))
  WITH CHECK ((user_id = (select auth.uid())));

ALTER POLICY inbox_saved_views_owner ON public.inbox_saved_views
  USING (((user_id = (select auth.uid())) AND (org_id = get_current_org_id())));

ALTER POLICY mcp_oauth_clients_owner_select ON public.mcp_oauth_clients
  USING ((created_by_user_id = (select auth.uid())));

ALTER POLICY mcp_oauth_tokens_owner_select ON public.mcp_oauth_tokens
  USING ((user_id = (select auth.uid())));

ALTER POLICY notifications_owner ON public.notifications
  USING (((user_id = (select auth.uid())) AND
CASE
    WHEN is_realtime_rls_check() THEN (org_id = ANY (member_org_ids()))
    ELSE (org_id = ( SELECT get_current_org_id() AS get_current_org_id))
END))
  WITH CHECK (((user_id = (select auth.uid())) AND (org_id = ( SELECT get_current_org_id() AS get_current_org_id))));

ALTER POLICY org_members_select ON public.org_members
  USING (((user_id = (select auth.uid())) OR (organization_id = ( SELECT get_current_org_id() AS get_current_org_id))));

ALTER POLICY pipeline_saved_views_owner ON public.pipeline_saved_views
  USING ((owner_id = (select auth.uid())))
  WITH CHECK ((owner_id = (select auth.uid())));

ALTER POLICY project_mcp_tokens_org_user ON public.project_mcp_tokens
  USING (((org_id = get_current_org_id()) AND ((user_id = (select auth.uid())) OR (EXISTS ( SELECT 1
   FROM org_members om
  WHERE ((om.organization_id = project_mcp_tokens.org_id) AND (om.user_id = (select auth.uid())) AND (om.role = 'owner'::user_role)))))));

ALTER POLICY push_sub_owner ON public.push_subscriptions
  USING ((user_id = (select auth.uid())))
  WITH CHECK ((user_id = (select auth.uid())));

ALTER POLICY active_org_insert ON public.user_active_org
  WITH CHECK ((user_id = (select auth.uid())));

ALTER POLICY active_org_select ON public.user_active_org
  USING ((user_id = (select auth.uid())));

ALTER POLICY active_org_update ON public.user_active_org
  USING ((user_id = (select auth.uid())))
  WITH CHECK ((user_id = (select auth.uid())));

-- 5) multiple_permissive_policies
-- 5a) email_templates had two identical FOR ALL policies; "org members" (USING
--     only, so WITH CHECK defaults to the same expression) duplicates
--     org_email_templates exactly.
DROP POLICY IF EXISTS "org members" ON public.email_templates;

-- 5b) The RBAC tables paired a member SELECT policy with an owner FOR ALL
--     "write" policy, so every SELECT evaluated both. Split the write policy into
--     INSERT/UPDATE/DELETE with the same owner-only expression.
DROP POLICY IF EXISTS org_custom_roles_write ON public.org_custom_roles;
DROP POLICY IF EXISTS org_custom_roles_insert ON public.org_custom_roles;
DROP POLICY IF EXISTS org_custom_roles_update ON public.org_custom_roles;
DROP POLICY IF EXISTS org_custom_roles_delete ON public.org_custom_roles;
CREATE POLICY org_custom_roles_insert ON public.org_custom_roles FOR INSERT TO authenticated
  WITH CHECK ((organization_id = (SELECT get_current_org_id())) AND ((SELECT current_org_role())::text = 'owner'::text));
CREATE POLICY org_custom_roles_update ON public.org_custom_roles FOR UPDATE TO authenticated
  USING ((organization_id = (SELECT get_current_org_id())) AND ((SELECT current_org_role())::text = 'owner'::text))
  WITH CHECK ((organization_id = (SELECT get_current_org_id())) AND ((SELECT current_org_role())::text = 'owner'::text));
CREATE POLICY org_custom_roles_delete ON public.org_custom_roles FOR DELETE TO authenticated
  USING ((organization_id = (SELECT get_current_org_id())) AND ((SELECT current_org_role())::text = 'owner'::text));

DROP POLICY IF EXISTS role_permissions_write ON public.role_permissions;
DROP POLICY IF EXISTS role_permissions_insert ON public.role_permissions;
DROP POLICY IF EXISTS role_permissions_update ON public.role_permissions;
DROP POLICY IF EXISTS role_permissions_delete ON public.role_permissions;
CREATE POLICY role_permissions_insert ON public.role_permissions FOR INSERT TO authenticated
  WITH CHECK ((organization_id = (SELECT get_current_org_id())) AND ((SELECT current_org_role())::text = 'owner'::text));
CREATE POLICY role_permissions_update ON public.role_permissions FOR UPDATE TO authenticated
  USING ((organization_id = (SELECT get_current_org_id())) AND ((SELECT current_org_role())::text = 'owner'::text))
  WITH CHECK ((organization_id = (SELECT get_current_org_id())) AND ((SELECT current_org_role())::text = 'owner'::text));
CREATE POLICY role_permissions_delete ON public.role_permissions FOR DELETE TO authenticated
  USING ((organization_id = (SELECT get_current_org_id())) AND ((SELECT current_org_role())::text = 'owner'::text));

DROP POLICY IF EXISTS role_settings_write ON public.role_settings;
DROP POLICY IF EXISTS role_settings_insert ON public.role_settings;
DROP POLICY IF EXISTS role_settings_update ON public.role_settings;
DROP POLICY IF EXISTS role_settings_delete ON public.role_settings;
CREATE POLICY role_settings_insert ON public.role_settings FOR INSERT TO authenticated
  WITH CHECK ((organization_id = (SELECT get_current_org_id())) AND ((SELECT current_org_role())::text = 'owner'::text));
CREATE POLICY role_settings_update ON public.role_settings FOR UPDATE TO authenticated
  USING ((organization_id = (SELECT get_current_org_id())) AND ((SELECT current_org_role())::text = 'owner'::text))
  WITH CHECK ((organization_id = (SELECT get_current_org_id())) AND ((SELECT current_org_role())::text = 'owner'::text));
CREATE POLICY role_settings_delete ON public.role_settings FOR DELETE TO authenticated
  USING ((organization_id = (SELECT get_current_org_id())) AND ((SELECT current_org_role())::text = 'owner'::text));

DROP POLICY IF EXISTS custom_role_permissions_write ON public.custom_role_permissions;
DROP POLICY IF EXISTS custom_role_permissions_insert ON public.custom_role_permissions;
DROP POLICY IF EXISTS custom_role_permissions_update ON public.custom_role_permissions;
DROP POLICY IF EXISTS custom_role_permissions_delete ON public.custom_role_permissions;
CREATE POLICY custom_role_permissions_insert ON public.custom_role_permissions FOR INSERT TO authenticated
  WITH CHECK ((EXISTS (SELECT 1 FROM org_custom_roles ocr WHERE ocr.id = custom_role_permissions.custom_role_id AND ocr.organization_id = (SELECT get_current_org_id()))) AND ((SELECT current_org_role())::text = 'owner'::text));
CREATE POLICY custom_role_permissions_update ON public.custom_role_permissions FOR UPDATE TO authenticated
  USING ((EXISTS (SELECT 1 FROM org_custom_roles ocr WHERE ocr.id = custom_role_permissions.custom_role_id AND ocr.organization_id = (SELECT get_current_org_id()))) AND ((SELECT current_org_role())::text = 'owner'::text))
  WITH CHECK ((EXISTS (SELECT 1 FROM org_custom_roles ocr WHERE ocr.id = custom_role_permissions.custom_role_id AND ocr.organization_id = (SELECT get_current_org_id()))) AND ((SELECT current_org_role())::text = 'owner'::text));
CREATE POLICY custom_role_permissions_delete ON public.custom_role_permissions FOR DELETE TO authenticated
  USING ((EXISTS (SELECT 1 FROM org_custom_roles ocr WHERE ocr.id = custom_role_permissions.custom_role_id AND ocr.organization_id = (SELECT get_current_org_id()))) AND ((SELECT current_org_role())::text = 'owner'::text));

-- 6) duplicate_index: each of these is a plain index identical to the index
--    backing a UNIQUE constraint on the same columns. Keep the constraint's.
DROP INDEX IF EXISTS public.idx_organizations_widget_token;
DROP INDEX IF EXISTS public.idx_assistant_mappings_vapi_id;
DROP INDEX IF EXISTS public.idx_legacy_tool_configs_org_tool;
DROP INDEX IF EXISTS public.idx_calls_vapi_call_id;
DROP INDEX IF EXISTS public.idx_chat_sessions_session_key;
DROP INDEX IF EXISTS public.idx_agents_org_slug;
DROP INDEX IF EXISTS public.idx_agent_prompt_versions_agent;
DROP INDEX IF EXISTS public.idx_agent_channel_defaults_org_channel;
DROP INDEX IF EXISTS public.idx_tool_idem_org_key;
DROP INDEX IF EXISTS public.idx_gbp_widget_token;
DROP INDEX IF EXISTS public.idx_call_settings_org_user;
DROP INDEX IF EXISTS public.idx_calendar_profiles_slug;
DROP INDEX IF EXISTS public.workflow_versions_workflow_id_version_number_idx;
DROP INDEX IF EXISTS public.project_mcp_tokens_org_user_idx;
DROP INDEX IF EXISTS public.mcp_oauth_clients_client_id_idx;
DROP INDEX IF EXISTS public.idx_email_unsubscribes_org_email;
DROP INDEX IF EXISTS public.idx_ads_journey_org_id;
DROP INDEX IF EXISTS public.idx_billing_customers_stripe_customer_id;
DROP INDEX IF EXISTS public.call_routing_chains_org_idx;
DROP INDEX IF EXISTS public.idx_agent_channel_routing_modes_org_channel;
