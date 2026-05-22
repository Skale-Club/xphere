-- ---------------------------------------------------------------------------
-- SEED-091: get_org_member_profiles RPC
-- Returns org members joined with auth.users for email, phone, and display
-- name. Uses SECURITY DEFINER so it can read auth.users, which is otherwise
-- inaccessible to normal authenticated queries.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_org_member_profiles(
  p_org_id   uuid,
  p_page     int DEFAULT 1,
  p_per_page int DEFAULT 20
)
RETURNS TABLE (
  id           uuid,
  user_id      uuid,
  role         text,
  joined_at    timestamptz,
  email        text,
  phone        text,
  full_name    text,
  total_count  bigint
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT
    om.id,
    om.user_id,
    om.role::text,
    om.created_at                                             AS joined_at,
    au.email,
    au.phone,
    COALESCE(
      au.raw_user_meta_data->>'full_name',
      au.raw_user_meta_data->>'name'
    )::text                                                   AS full_name,
    COUNT(*) OVER()                                           AS total_count
  FROM public.org_members om
  JOIN auth.users au ON au.id = om.user_id
  WHERE om.organization_id = p_org_id
  ORDER BY om.created_at ASC
  LIMIT  p_per_page
  OFFSET (p_page - 1) * p_per_page;
$$;

-- Only org admins (via requireAdmin server action) should call this; no
-- direct RLS is needed since the function itself is gated server-side.
-- Revoke anonymous/public access for defence-in-depth.
REVOKE EXECUTE ON FUNCTION public.get_org_member_profiles(uuid, int, int) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_org_member_profiles(uuid, int, int) TO authenticated;
