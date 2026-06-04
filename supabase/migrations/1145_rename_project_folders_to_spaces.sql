-- Rename project_folders → project_spaces and projects.folder_id → projects.space_id.
-- No data moved; pure schema renames.

-- 1. Rename the table.
ALTER TABLE project_folders RENAME TO project_spaces;

-- 2. Rename the RLS policy.
ALTER POLICY "project_folders org members" ON project_spaces
  RENAME TO "project_spaces org members";

-- 3. Rename indexes on project_spaces.
ALTER INDEX project_folders_org_parent_idx RENAME TO project_spaces_org_parent_idx;
ALTER INDEX project_folders_org_id_parent_id_name_key RENAME TO project_spaces_org_id_parent_id_name_key;

-- 4. Replace the updated_at trigger (drop old, create new under the new name).
DROP TRIGGER IF EXISTS trg_project_folders_touch ON project_spaces;

CREATE OR REPLACE FUNCTION touch_project_space_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_project_spaces_touch
  BEFORE UPDATE ON project_spaces
  FOR EACH ROW
  EXECUTE FUNCTION touch_project_space_updated_at();

-- 5. Rename the column on the projects table.
ALTER TABLE projects RENAME COLUMN folder_id TO space_id;

-- 6. Rename the index that filters on that column.
ALTER INDEX projects_folder_idx RENAME TO projects_space_idx;
