-- R08: Project folders, archive, and trash. Port of migration 100 (workflow folders) for the projects module.

CREATE TABLE project_folders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT,                       -- optional hex, e.g. '#6366F1'
  icon        TEXT,                       -- optional lucide icon name
  parent_id   UUID REFERENCES project_folders(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL DEFAULT 0,
  created_by  UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, parent_id, name)
);

ALTER TABLE project_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_folders org members"
  ON project_folders
  USING (org_id = get_current_org_id())
  WITH CHECK (org_id = get_current_org_id());

CREATE INDEX project_folders_org_parent_idx
  ON project_folders(org_id, parent_id);

-- Extend projects with folder linkage + lifecycle columns.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS folder_id   UUID REFERENCES project_folders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS position    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS projects_folder_idx
  ON projects(folder_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS projects_archived_idx
  ON projects(org_id, archived_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS projects_deleted_idx
  ON projects(org_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

-- Keep updated_at fresh on folder rows.
CREATE OR REPLACE FUNCTION touch_project_folder_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_project_folders_touch ON project_folders;
CREATE TRIGGER trg_project_folders_touch
  BEFORE UPDATE ON project_folders
  FOR EACH ROW
  EXECUTE FUNCTION touch_project_folder_updated_at();
