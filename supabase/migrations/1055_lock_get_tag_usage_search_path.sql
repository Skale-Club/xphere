-- Lock search_path on get_tag_usage to prevent search_path hijack on a SECURITY DEFINER function.
-- Without this, a malicious schema in the caller's search_path could shadow built-in functions
-- and execute under the function owner's privileges. The other 12 SECDEF functions in public
-- already have search_path locked; this brings get_tag_usage in line.
--
-- Finding: Security Review — Xphere, item S01 (Injection) baseline scan, 2026-05-25.

ALTER FUNCTION public.get_tag_usage(uuid)
  SET search_path = public, pg_temp;
