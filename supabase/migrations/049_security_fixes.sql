-- =============================================================================
-- Migration 049: Security Fixes — Supabase Linter Warnings
-- Fixes:
--   1. function_search_path_mutable — update_updated_at missing SET search_path
--   2. rls_policy_always_true      — service_role_can_manage_documents (USING true)
--   3. anon_security_definer_function_executable — revoke anon EXECUTE on internal fns
--   4. authenticated_security_definer_function_executable — revoke authenticated EXECUTE
--      on fns that must not be callable via REST RPC
--
-- NOTE: auth_leaked_password_protection is a Supabase Dashboard setting
--   (Auth > Password Security > Enable leaked password protection).
--   It cannot be configured via SQL migration — fix it manually in the Dashboard.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Fix 1: function_search_path_mutable
-- update_updated_at() was missing SET search_path, making it vulnerable to
-- search_path injection attacks in trigger context.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Fix 2: rls_policy_always_true
-- "service_role_can_manage_documents" uses USING (true) / WITH CHECK (true),
-- which the linter flags as always-true. service_role already bypasses RLS
-- in Supabase by default — this policy is redundant and overly broad.
-- Drop it; the Edge Function (which uses the service_role key) does not need it.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "service_role_can_manage_documents" ON public.documents;

-- ---------------------------------------------------------------------------
-- Fix 3 & 4: anon/authenticated EXECUTE revokes
--
-- These SECURITY DEFINER functions are used internally (RLS policies, triggers)
-- and must NOT be callable via Supabase REST RPC by external clients.
--
-- get_current_org_id() and get_user_org_ids() are used inside RLS USING clauses.
-- Revoking EXECUTE from `authenticated` would break RLS evaluation — so we only
-- revoke from `anon` for those two.
--
-- match_documents, next_agent_prompt_version, and trg_agent_prompt_version_snapshot
-- should never be called directly via REST by any role — revoke from both.
-- ---------------------------------------------------------------------------

-- Internal org-resolution helpers: revoke anon only (authenticated needed for RLS)
REVOKE EXECUTE ON FUNCTION public.get_current_org_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_user_org_ids() FROM anon;

-- Semantic search: not a public RPC endpoint
REVOKE EXECUTE ON FUNCTION public.match_documents(extensions.vector, jsonb) FROM anon, authenticated;

-- Prompt versioning internals: called only by trigger, never via REST
REVOKE EXECUTE ON FUNCTION public.next_agent_prompt_version(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_agent_prompt_version_snapshot() FROM anon, authenticated;
