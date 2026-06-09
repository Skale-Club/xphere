-- Migration 1205: MCP Tokens — User-Based Authentication
-- Transition from org-scoped tokens to per-user, per-org tokens.
-- Allows one token per (org_id, user_id) pair, enabling team collaboration
-- while maintaining per-user audit trails.

-- Step 1: Add user_id column with temporary NOT NULL DEFERRED
ALTER TABLE public.project_mcp_tokens
  ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- Step 2: Backfill existing tokens with inferred user context
-- Strategy: For each token, find the user who owns the org (first owner)
-- or use the earliest org member. If no user found, set to NULL temporarily.
UPDATE public.project_mcp_tokens t
SET user_id = (
  SELECT COALESCE(
    -- Prefer: creator of the org (owner)
    (SELECT om.user_id FROM public.org_members om
     WHERE om.organization_id = t.org_id
       AND om.role = 'owner'
     LIMIT 1),
    -- Fallback: any active member of the org (earliest)
    (SELECT om.user_id FROM public.org_members om
     WHERE om.organization_id = t.org_id
     ORDER BY om.created_at ASC
     LIMIT 1)
  )
)
WHERE user_id IS NULL;

-- Step 3: Now enforce NOT NULL (after backfill, any remaining NULLs indicate orphaned data)
ALTER TABLE public.project_mcp_tokens
  ALTER COLUMN user_id SET NOT NULL;

-- Step 4: Drop old org-only UNIQUE constraint
ALTER TABLE public.project_mcp_tokens
  DROP CONSTRAINT project_mcp_tokens_org_id_key;

-- Step 5: Add composite UNIQUE constraint: one token per (org, user) pair
ALTER TABLE public.project_mcp_tokens
  ADD CONSTRAINT project_mcp_tokens_org_user_uniq UNIQUE (org_id, user_id);

-- Step 6: Update RLS policy to enforce per-user access with admin override
-- Remove old policy
DROP POLICY IF EXISTS project_mcp_tokens_org ON public.project_mcp_tokens;

-- Add new policy: org-scoped AND user-aware
-- Users see only their own tokens; org owners can manage any token
CREATE POLICY project_mcp_tokens_org_user ON public.project_mcp_tokens
  USING (
    org_id = get_current_org_id()
    AND (
      user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.org_members om
        WHERE om.organization_id = public.project_mcp_tokens.org_id
          AND om.user_id = auth.uid()
          AND om.role = 'owner'
      )
    )
  );

-- Step 7: Add index for efficient (org_id, user_id) lookups
CREATE INDEX IF NOT EXISTS project_mcp_tokens_org_user_idx
  ON public.project_mcp_tokens (org_id, user_id);
