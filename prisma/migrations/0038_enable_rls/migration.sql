-- Enable Row-Level Security (RLS) on every table in the public schema.
--
-- WHY: Supabase auto-exposes every public-schema table through its REST API,
-- authenticated by the public anon key (shipped in the browser for login). With
-- RLS off, anyone with the project URL + anon key can read/edit/delete the tables
-- directly (Supabase advisor: rls_disabled_in_public).
--
-- SAFE FOR THIS APP: all data access is via Prisma, connecting as the table owner
-- (postgres), which BYPASSES RLS. Supabase is used only for Auth + Storage
-- (service role). So enabling RLS with NO policies closes the public API to
-- anon/authenticated while leaving the application completely unaffected.
--
-- Intentionally NO policies (deny-all for the public API) and NO FORCE (FORCE
-- would also apply to the owner / Prisma).
--
-- Idempotent: ENABLE on an already-enabled table is a no-op. This same block is
-- appended to every future migration (see CLAUDE.md) so new tables never ship
-- with RLS disabled.
do $$
declare t record;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security;', t.tablename);
  end loop;
end $$;
