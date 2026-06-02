alter table conversations
  add column if not exists show_operator_name_prefix boolean not null default false;
