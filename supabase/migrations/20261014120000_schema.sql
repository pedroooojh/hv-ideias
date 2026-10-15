-- =============================================================================
-- Hubvision Ideias — schema
--
-- Princípios:
--   * Nenhum dado é público: o papel `anon` (sem login) não lê nem escreve nada.
--   * Toda escrita passa por funções RPC (ver 20261014120100_api.sql). Os papéis
--     `anon` e `authenticated` não têm INSERT/UPDATE/DELETE em nenhuma tabela.
--   * RLS está habilitado em todas as tabelas expostas, com políticas apenas de
--     leitura, como defesa em profundidade caso alguém consulte as tabelas direto.
--   * Exclusões de conteúdo são lógicas (deleted_at). Contas não são excluídas,
--     são desativadas (profiles.status = 'disabled').
-- =============================================================================

create schema if not exists private;
revoke all on schema private from public;

-- -----------------------------------------------------------------------------
-- Funções utilitárias de trigger
-- -----------------------------------------------------------------------------

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Perfis (1:1 com auth.users)
-- -----------------------------------------------------------------------------

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 2 and 80),
  role        text not null default 'user' check (role in ('user', 'admin')),
  status      text not null default 'active' check (status in ('active', 'disabled')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

-- Cria o perfil automaticamente no cadastro. O papel é sempre 'user':
-- metadados enviados pelo cliente nunca definem o perfil administrativo.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  v_name := btrim(coalesce(new.raw_user_meta_data ->> 'name', ''));
  if char_length(v_name) < 2 then
    v_name := split_part(coalesce(new.email, ''), '@', 1);
  end if;
  if char_length(v_name) < 2 then
    v_name := 'Usuário';
  end if;

  insert into public.profiles (id, name)
  values (new.id, left(v_name, 80));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- -----------------------------------------------------------------------------
-- Projetos
-- -----------------------------------------------------------------------------

create table public.projects (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(btrim(name)) between 3 and 120),
  description  text not null check (char_length(btrim(description)) between 10 and 4000),
  category     text not null check (char_length(btrim(category)) between 2 and 60),
  status       text not null default 'em_avaliacao'
               check (status in ('em_avaliacao', 'planejado', 'em_desenvolvimento', 'concluido', 'arquivado')),
  created_by   uuid references public.profiles (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  deleted_by   uuid references public.profiles (id)
);

create index projects_active_idx on public.projects (updated_at desc) where deleted_at is null;

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Tipos de sugestão (tabela de referência: novos tipos = novas linhas)
-- -----------------------------------------------------------------------------

create table public.suggestion_types (
  slug        text primary key check (slug ~ '^[a-z][a-z0-9_]{1,39}$'),
  label       text not null check (char_length(btrim(label)) between 2 and 60),
  sort_order  integer not null default 0,
  is_active   boolean not null default true
);

insert into public.suggestion_types (slug, label, sort_order) values
  ('melhoria', 'Melhoria', 1),
  ('nova_funcionalidade', 'Nova funcionalidade', 2);

-- -----------------------------------------------------------------------------
-- Sugestões
-- -----------------------------------------------------------------------------

create table public.suggestions (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects (id) on delete restrict,
  author_id          uuid not null references public.profiles (id) on delete restrict,
  type               text not null references public.suggestion_types (slug) on update cascade,
  title              text not null check (char_length(btrim(title)) between 5 and 150),
  description        text not null check (char_length(btrim(description)) between 10 and 5000),
  status             text not null default 'em_analise'
                     check (status in ('em_analise', 'planejado', 'em_desenvolvimento', 'implementado', 'nao_aprovado')),
  status_reason      text check (status_reason is null or char_length(status_reason) <= 1000),
  status_changed_at  timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  deleted_by         uuid references public.profiles (id)
);

create index suggestions_project_idx on public.suggestions (project_id, created_at desc) where deleted_at is null;
create index suggestions_author_idx on public.suggestions (author_id) where deleted_at is null;

create trigger suggestions_set_updated_at
  before update on public.suggestions
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Votos (somente positivos; retirar o voto = remover a linha)
-- -----------------------------------------------------------------------------

create table public.votes (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  suggestion_id  uuid not null references public.suggestions (id) on delete cascade,
  created_at     timestamptz not null default now(),
  constraint votes_user_suggestion_key unique (user_id, suggestion_id)
);

create index votes_suggestion_idx on public.votes (suggestion_id);

-- Garantia no banco: o autor nunca vota na própria sugestão, mesmo que alguma
-- função futura esqueça de verificar.
create or replace function private.prevent_self_vote()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.suggestions s
    where s.id = new.suggestion_id and s.author_id = new.user_id
  ) then
    raise exception 'Você não pode votar na sua própria sugestão.' using errcode = 'HV403';
  end if;
  return new;
end;
$$;

create trigger votes_prevent_self_vote
  before insert or update on public.votes
  for each row execute function private.prevent_self_vote();

-- -----------------------------------------------------------------------------
-- Comentários
-- -----------------------------------------------------------------------------

create table public.comments (
  id               uuid primary key default gen_random_uuid(),
  suggestion_id    uuid not null references public.suggestions (id) on delete restrict,
  author_id        uuid not null references public.profiles (id) on delete restrict,
  content          text not null check (char_length(btrim(content)) between 1 and 2000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  edited_at        timestamptz,
  deleted_at       timestamptz,
  deleted_by       uuid references public.profiles (id),
  deletion_reason  text check (deletion_reason in ('author', 'moderation')),
  constraint comments_deletion_consistent check ((deleted_at is null) = (deletion_reason is null))
);

create index comments_suggestion_idx on public.comments (suggestion_id, created_at);

create trigger comments_set_updated_at
  before update on public.comments
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Histórico de status (visível aos usuários, para transparência)
-- -----------------------------------------------------------------------------

create table public.suggestion_status_history (
  id               bigint generated always as identity primary key,
  suggestion_id    uuid not null references public.suggestions (id) on delete cascade,
  actor_id         uuid references public.profiles (id),
  previous_status  text,
  new_status       text not null,
  reason           text,
  created_at       timestamptz not null default now()
);

create index suggestion_status_history_idx on public.suggestion_status_history (suggestion_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Auditoria administrativa (somente administradores leem)
-- -----------------------------------------------------------------------------

create table public.audit_log (
  id              bigint generated always as identity primary key,
  actor_id        uuid references public.profiles (id),
  entity_type     text not null check (entity_type in ('project', 'suggestion', 'comment', 'user')),
  entity_id       uuid,
  action          text not null,
  previous_value  jsonb,
  new_value       jsonb,
  created_at      timestamptz not null default now()
);

create index audit_log_created_idx on public.audit_log (created_at desc);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id);

-- -----------------------------------------------------------------------------
-- Limite de requisições (fora do schema exposto pela API)
-- -----------------------------------------------------------------------------

create table private.rate_limit_events (
  id          bigint generated always as identity primary key,
  user_id     uuid not null,
  action      text not null,
  created_at  timestamptz not null default now()
);

create index rate_limit_events_idx on private.rate_limit_events (user_id, action, created_at desc);

-- -----------------------------------------------------------------------------
-- Helpers de autorização
-- -----------------------------------------------------------------------------

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and status = 'active'
  );
$$;

-- Retorna o perfil do usuário autenticado ou interrompe a operação.
create or replace function private.current_profile()
returns public.profiles
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
begin
  if v_uid is null then
    raise exception 'Faça login para continuar.' using errcode = 'HV401';
  end if;

  select * into v_profile from public.profiles where id = v_uid;
  if not found then
    raise exception 'Perfil de usuário não encontrado.' using errcode = 'HV401';
  end if;
  if v_profile.status <> 'active' then
    raise exception 'Sua conta está desativada. Procure um administrador.' using errcode = 'HV403';
  end if;

  return v_profile;
end;
$$;

create or replace function private.require_admin()
returns public.profiles
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles := private.current_profile();
begin
  if v_profile.role <> 'admin' then
    raise exception 'Apenas administradores podem realizar esta ação.' using errcode = 'HV403';
  end if;
  return v_profile;
end;
$$;

create or replace function private.rate_limit(p_user_id uuid, p_action text, p_max integer, p_window interval)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- Serializa por usuário+ação para que requisições simultâneas não escapem do limite.
  perform pg_advisory_xact_lock(hashtext(p_user_id::text || ':' || p_action));

  select count(*) into v_count
  from private.rate_limit_events
  where user_id = p_user_id and action = p_action and created_at > now() - p_window;

  if v_count >= p_max then
    raise exception 'Muitas ações em pouco tempo. Aguarde alguns instantes e tente novamente.' using errcode = 'HV429';
  end if;

  insert into private.rate_limit_events (user_id, action) values (p_user_id, p_action);

  delete from private.rate_limit_events
  where user_id = p_user_id and created_at < now() - interval '1 day';
end;
$$;

create or replace function private.audit(
  p_actor_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_action text,
  p_previous jsonb default null,
  p_new jsonb default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (actor_id, entity_type, entity_id, action, previous_value, new_value)
  values (p_actor_id, p_entity_type, p_entity_id, p_action, p_previous, p_new);
$$;

-- -----------------------------------------------------------------------------
-- Pontuação: fonte única da regra
-- -----------------------------------------------------------------------------

-- Cada voto positivo válido recebido vale 0,5 ponto para o autor da sugestão.
create or replace function private.points_per_vote()
returns numeric
language sql
immutable
as $$ select 0.5::numeric $$;

-- Sugestões elegíveis: não excluídas e de projetos não excluídos.
create view private.eligible_suggestions as
select s.*
from public.suggestions s
join public.projects p on p.id = s.project_id
where s.deleted_at is null
  and p.deleted_at is null;

-- Pontuação por usuário ativo que tenha ao menos uma sugestão elegível.
-- Votos do próprio autor são ignorados (além de proibidos por trigger).
create view private.user_scores as
select
  pr.id                                              as user_id,
  pr.name                                            as user_name,
  count(distinct s.id)                               as suggestion_count,
  count(v.id)                                        as votes_received,
  (count(v.id) * private.points_per_vote())::numeric(12, 1) as score,
  min(s.created_at)                                  as first_participation_at
from public.profiles pr
join private.eligible_suggestions s on s.author_id = pr.id
left join public.votes v on v.suggestion_id = s.id and v.user_id <> s.author_id
where pr.status = 'active'
group by pr.id, pr.name;

-- -----------------------------------------------------------------------------
-- RLS (somente leitura) e privilégios
-- -----------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.suggestion_types enable row level security;
alter table public.suggestions enable row level security;
alter table public.votes enable row level security;
alter table public.comments enable row level security;
alter table public.suggestion_status_history enable row level security;
alter table public.audit_log enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select on public.projects, public.suggestion_types to authenticated;
grant select (id, name, role, created_at) on public.profiles to authenticated;
grant select on public.suggestions, public.votes, public.comments,
                public.suggestion_status_history, public.audit_log to authenticated;

create policy "Perfis visíveis a usuários autenticados"
  on public.profiles for select to authenticated using (true);

create policy "Projetos não excluídos visíveis a usuários autenticados"
  on public.projects for select to authenticated using (deleted_at is null);

create policy "Tipos de sugestão visíveis a usuários autenticados"
  on public.suggestion_types for select to authenticated using (true);

create policy "Sugestões visíveis a usuários autenticados"
  on public.suggestions for select to authenticated
  using (
    deleted_at is null
    and exists (select 1 from public.projects p where p.id = project_id and p.deleted_at is null)
  );

create policy "Cada usuário vê apenas os próprios votos"
  on public.votes for select to authenticated using (user_id = auth.uid());

create policy "Comentários ativos visíveis a usuários autenticados"
  on public.comments for select to authenticated using (deleted_at is null);

create policy "Histórico de status visível a usuários autenticados"
  on public.suggestion_status_history for select to authenticated
  using (exists (select 1 from public.suggestions s where s.id = suggestion_id and s.deleted_at is null));

create policy "Auditoria visível a administradores"
  on public.audit_log for select to authenticated using (private.is_admin());

grant usage on schema private to authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_admin() to authenticated;
