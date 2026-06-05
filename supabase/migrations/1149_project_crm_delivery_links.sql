-- Migration 1145: Project CRM delivery links
-- Connects delivery projects to CRM accounts, opportunities, contacts, and
-- internal project members without making any of those relationships mandatory.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_opportunity_id uuid REFERENCES public.opportunities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS primary_contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_projects_account_id
  ON public.projects (account_id)
  WHERE account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_projects_source_opportunity_id
  ON public.projects (source_opportunity_id)
  WHERE source_opportunity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_projects_primary_contact_id
  ON public.projects (primary_contact_id)
  WHERE primary_contact_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_project_crm_links()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.accounts a
    WHERE a.id = NEW.account_id AND a.org_id = NEW.org_id
  ) THEN
    RAISE EXCEPTION 'project account_id belongs to a different organization';
  END IF;

  IF NEW.source_opportunity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.opportunities o
    WHERE o.id = NEW.source_opportunity_id AND o.org_id = NEW.org_id
  ) THEN
    RAISE EXCEPTION 'project source_opportunity_id belongs to a different organization';
  END IF;

  IF NEW.primary_contact_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = NEW.primary_contact_id AND c.org_id = NEW.org_id
  ) THEN
    RAISE EXCEPTION 'project primary_contact_id belongs to a different organization';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_project_crm_links ON public.projects;
CREATE TRIGGER trg_validate_project_crm_links
  BEFORE INSERT OR UPDATE OF org_id, account_id, source_opportunity_id, primary_contact_id
  ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_project_crm_links();

CREATE TABLE IF NOT EXISTS public.project_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        text,
  is_owner    boolean NOT NULL DEFAULT false,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_members_project_id
  ON public.project_members (project_id);

CREATE INDEX IF NOT EXISTS idx_project_members_user_id
  ON public.project_members (org_id, user_id);

ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_members_org_isolation ON public.project_members;
CREATE POLICY project_members_org_isolation ON public.project_members
  FOR ALL
  USING      (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

DROP TRIGGER IF EXISTS trg_project_members_set_updated_at ON public.project_members;
CREATE TRIGGER trg_project_members_set_updated_at
  BEFORE UPDATE ON public.project_members
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE IF NOT EXISTS public.project_contacts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  contact_id  uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  role        text,
  is_primary  boolean NOT NULL DEFAULT false,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_project_contacts_project_id
  ON public.project_contacts (project_id);

CREATE INDEX IF NOT EXISTS idx_project_contacts_contact_id
  ON public.project_contacts (contact_id);

ALTER TABLE public.project_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_contacts_org_isolation ON public.project_contacts;
CREATE POLICY project_contacts_org_isolation ON public.project_contacts
  FOR ALL
  USING      (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

DROP TRIGGER IF EXISTS trg_project_contacts_set_updated_at ON public.project_contacts;
CREATE TRIGGER trg_project_contacts_set_updated_at
  BEFORE UPDATE ON public.project_contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE FUNCTION public.validate_project_people_links()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = NEW.project_id AND p.org_id = NEW.org_id
  ) THEN
    RAISE EXCEPTION 'project link belongs to a different organization';
  END IF;

  IF TG_TABLE_NAME = 'project_contacts' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = NEW.contact_id AND c.org_id = NEW.org_id
    ) THEN
      RAISE EXCEPTION 'project contact belongs to a different organization';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_project_members_links ON public.project_members;
CREATE TRIGGER trg_validate_project_members_links
  BEFORE INSERT OR UPDATE OF org_id, project_id
  ON public.project_members
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_project_people_links();

DROP TRIGGER IF EXISTS trg_validate_project_contacts_links ON public.project_contacts;
CREATE TRIGGER trg_validate_project_contacts_links
  BEFORE INSERT OR UPDATE OF org_id, project_id, contact_id
  ON public.project_contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_project_people_links();
