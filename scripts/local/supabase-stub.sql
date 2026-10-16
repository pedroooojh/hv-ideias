-- Reproduz o mínimo do ambiente Supabase usado pelas migrações, para rodar o
-- schema real em Postgres embutido (PGlite) nos testes e no emulador local.
-- NÃO é aplicado no Supabase de verdade.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (
  id uuid primary key,
  email text unique,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  -- Colunas do Supabase usadas pelas migrações (convites).
  invited_at timestamptz,
  email_confirmed_at timestamptz
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
