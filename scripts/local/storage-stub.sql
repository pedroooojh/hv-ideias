-- Reproduz o mínimo do schema "storage" do Supabase usado pelas migrações
-- (bucket, objetos com RLS e storage.foldername), para os testes e o emulador.
-- Idempotente: o emulador roda este arquivo a cada início, inclusive em bancos
-- locais criados antes de existir o Storage. NÃO é aplicado no Supabase de verdade.
create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid,
  metadata jsonb,
  created_at timestamptz not null default now(),
  unique (bucket_id, name)
);

alter table storage.objects enable row level security;

-- Pastas do caminho, sem o nome do arquivo: 'a/b/c.png' -> {a,b}.
create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1];
$$;

grant usage on schema storage to anon, authenticated;
grant select on storage.buckets to anon, authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
grant execute on function storage.foldername(text) to anon, authenticated;
