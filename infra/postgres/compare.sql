-- Read-only fingerprint of the Xphere schema and data. Run against source and
-- target; the outputs must match line for line (row counts are exact).
\pset tuples_only on
\pset format unaligned
begin transaction read only;

select 'rows|' || table_name || '|' ||
  (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text
from information_schema.tables
where table_schema = 'public' and table_type = 'BASE TABLE'
order by table_name;

select 'objects|tables|' || count(*) from pg_tables where schemaname = 'public';
select 'objects|views|' || count(*) from pg_views where schemaname = 'public';
select 'objects|policies|' || count(*) from pg_policies where schemaname = 'public';
select 'objects|rls_on|' || count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity;
select 'objects|functions|' || count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public';
select 'objects|triggers|' || count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal;
select 'objects|indexes|' || count(*) from pg_indexes where schemaname = 'public';
select 'objects|fks|' || count(*) from pg_constraint k join pg_namespace n on n.oid = k.connamespace
  where n.nspname = 'public' and k.contype = 'f';
select 'objects|enums|' || count(*) from pg_type t join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public' and t.typtype = 'e';
select 'objects|migrations|' || count(*) || '|' || max(version) from supabase_migrations.schema_migrations;

select 'seq|' || sequencename || '|' || coalesce(last_value::text, 'null') from pg_sequences where schemaname = 'public' order by 1;

-- pgvector: nearest neighbours with stored vectors as the query. HNSW is
-- approximate, so the exact (sequential) order is listed too.
select 'vec|documents|' || string_agg(id::text, ',' order by d) from (
  select d.id, d.embedding <=> (select embedding from public.documents where embedding is not null order by id limit 1) as d
  from public.documents d where d.embedding is not null order by d limit 5) x;
select 'vec|ads_memories|' || string_agg(id::text, ',' order by d) from (
  select m.id, m.embedding <=> (select embedding from public.ads_memories where embedding is not null order by id limit 1) as d
  from public.ads_memories m where m.embedding is not null order by d limit 5) x;
select 'rpc|match_documents|' || coalesce(string_agg(id::text, ',' order by id), 'none') from (
  select id from public.match_documents((select embedding from public.documents where embedding is not null order by id limit 1), '{}'::jsonb, 5)) x;
select 'rpc|match_global_knowledge|' || count(*) from public.match_global_knowledge(
  (select embedding from public.documents where embedding is not null order by id limit 1), null, 5);
select 'rpc|match_ads_memories|' || count(*) from public.match_ads_memories(
  (select org_id from public.ads_memories where embedding is not null order by id limit 1),
  (select embedding from public.ads_memories where embedding is not null order by id limit 1), null, null, 5);

rollback;
