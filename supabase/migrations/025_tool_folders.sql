-- =============================================================================
-- Migration 025: Tool Folders — relational hierarchy replacing flat folder column
-- Phase: 19-db-foundation (v1.5)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Create tool_folders table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tool_folders (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  parent_id   UUID        REFERENCES public.tool_folders(id) ON DELETE CASCADE,
  position    INT         NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique constraint: prevent duplicate folder names within the same parent scope.
-- NULLS NOT DISTINCT (PG15+): treats two NULLs as equal, so two top-level folders
-- in the same org cannot share a name. Fallback if PG version < 15: replace with
-- UNIQUE(org_id, parent_id, name) + partial index (see comment below).
ALTER TABLE public.tool_folders
  ADD CONSTRAINT tool_folders_org_parent_name_key
  UNIQUE NULLS NOT DISTINCT (org_id, parent_id, name);

-- Fallback (if NULLS NOT DISTINCT is unavailable):
-- ALTER TABLE public.tool_folders ADD CONSTRAINT tool_folders_org_parent_name_key UNIQUE (org_id, parent_id, name);
-- CREATE UNIQUE INDEX tool_folders_top_level_name_key ON public.tool_folders (org_id, name) WHERE parent_id IS NULL;

-- -----------------------------------------------------------------------------
-- 2. Indexes
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS tool_folders_org_id_idx ON public.tool_folders (org_id);
CREATE INDEX IF NOT EXISTS tool_folders_parent_id_idx ON public.tool_folders (parent_id);

-- -----------------------------------------------------------------------------
-- 3. updated_at trigger (reuses existing update_updated_at() function)
-- -----------------------------------------------------------------------------
CREATE TRIGGER trg_tool_folders_updated_at
  BEFORE UPDATE ON public.tool_folders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- -----------------------------------------------------------------------------
-- 4. Row Level Security
-- -----------------------------------------------------------------------------
ALTER TABLE public.tool_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation" ON public.tool_folders
  FOR ALL
  TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

-- -----------------------------------------------------------------------------
-- 5. Add folder_id FK to tool_configs
-- -----------------------------------------------------------------------------
ALTER TABLE public.tool_configs
  ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES public.tool_folders(id) ON DELETE SET NULL;

-- -----------------------------------------------------------------------------
-- 6. Data migration: insert folders from organizations.tool_folder_order
-- -----------------------------------------------------------------------------
-- Step 6a: Insert top-level folders from the ordered array (preserves position)
INSERT INTO public.tool_folders (org_id, name, position, parent_id)
SELECT
  o.id,
  folder_name,
  (ordinality - 1)::INT,
  NULL
FROM public.organizations o,
     LATERAL unnest(o.tool_folder_order) WITH ORDINALITY AS u(folder_name, ordinality)
WHERE array_length(o.tool_folder_order, 1) > 0
ON CONFLICT ON CONSTRAINT tool_folders_org_parent_name_key DO NOTHING;

-- Step 6b: Insert any folder names on tool_configs not already in tool_folders
-- (handles "orphan" folder strings never added to tool_folder_order)
INSERT INTO public.tool_folders (org_id, name, position, parent_id)
SELECT DISTINCT
  tc.organization_id,
  tc.folder,
  0,
  NULL
FROM public.tool_configs tc
WHERE tc.folder IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.tool_folders tf
    WHERE tf.org_id = tc.organization_id
      AND tf.name = tc.folder
      AND tf.parent_id IS NULL
  )
ON CONFLICT ON CONSTRAINT tool_folders_org_parent_name_key DO NOTHING;

-- Step 6c: Back-fill folder_id on tool_configs from matched folder name
UPDATE public.tool_configs tc
SET folder_id = tf.id
FROM public.tool_folders tf
WHERE tf.org_id = tc.organization_id
  AND tf.name = tc.folder
  AND tf.parent_id IS NULL;

-- Safety check (informational — will show 0 if migration is clean):
-- SELECT COUNT(*) FROM tool_configs WHERE folder IS NOT NULL AND folder_id IS NULL;

-- -----------------------------------------------------------------------------
-- 7. Drop superseded columns
-- -----------------------------------------------------------------------------
ALTER TABLE public.tool_configs DROP COLUMN IF EXISTS folder;
ALTER TABLE public.organizations DROP COLUMN IF EXISTS tool_folder_order;
