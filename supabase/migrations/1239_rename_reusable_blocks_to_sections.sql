-- migration 1239: reusable_email_blocks → email_section_templates
-- Standardizes DB naming on "section template" to match the UI (Sections tab,
-- standalone section editor) — see src/app/(dashboard)/email-templates/actions.ts.

alter table public.reusable_email_blocks rename to email_section_templates;
alter table public.email_section_templates rename column block_type to section_type;

-- Backfill the shared folders.entity_type discriminator before swapping the
-- check constraint (migration 1235 registered 'reusable_email_block').
update public.folders set entity_type = 'email_section_template' where entity_type = 'reusable_email_block';

alter table public.folders drop constraint if exists folders_entity_type_check;
alter table public.folders add constraint folders_entity_type_check
  check (entity_type in ('workflow', 'project', 'tool', 'email_template', 'email_section_template'));
