-- =============================================================================
-- Filtros padronizados: busca por texto, status e contagens para as abas.
--
-- Mudar a lista de parâmetros cria outra função no Postgres (sobrecarga), então
-- as versões antigas são removidas antes. Todas continuam exigindo login e as
-- de administração continuam exigindo o perfil de administrador.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helpers de filtro
-- -----------------------------------------------------------------------------

-- Normaliza o termo de busca: vazio vira null; limite de tamanho.
create or replace function private.clean_search(p_search text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if v is not null and char_length(v) > 100 then
    raise exception 'A busca deve ter no máximo 100 caracteres.' using errcode = 'HV422';
  end if;
  return v;
end;
$$;

-- Busca literal e sem diferenciar maiúsculas: % e _ não funcionam como curinga.
create or replace function private.text_matches(p_text text, p_search text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_search is null or position(lower(p_search) in lower(coalesce(p_text, ''))) > 0;
$$;

create or replace function private.check_suggestion_status_filter(p_status text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_status is not null
     and p_status not in ('em_analise', 'planejado', 'em_desenvolvimento', 'implementado', 'nao_aprovado') then
    raise exception 'Status inválido.' using errcode = 'HV422';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Projetos
-- -----------------------------------------------------------------------------

drop function if exists public.list_projects(integer, integer);

create or replace function public.list_projects(
  p_limit integer default 12,
  p_offset integer default 0,
  p_search text default null,
  p_status text default null
)
returns table (
  id uuid,
  name text,
  description text,
  category text,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  last_activity_at timestamptz,
  suggestion_count bigint,
  vote_count bigint,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_search text := private.clean_search(p_search);
begin
  perform private.current_profile();
  perform private.check_page(p_limit, p_offset);
  if p_status is not null then
    perform private.check_project_status(p_status);
  end if;

  return query
  with stats as (
    select s.project_id,
           count(distinct s.id) as suggestion_count,
           count(v.id) as vote_count,
           max(s.updated_at) as last_suggestion_at
    from private.eligible_suggestions s
    left join public.votes v on v.suggestion_id = s.id
    group by s.project_id
  )
  select p.id, p.name, p.description, p.category, p.status, p.created_at, p.updated_at,
         greatest(p.updated_at, coalesce(st.last_suggestion_at, p.updated_at)) as last_activity_at,
         coalesce(st.suggestion_count, 0)::bigint,
         coalesce(st.vote_count, 0)::bigint,
         count(*) over ()::bigint
  from public.projects p
  left join stats st on st.project_id = p.id
  where p.deleted_at is null
    and (p_status is null or p.status = p_status)
    and (private.text_matches(p.name, v_search)
         or private.text_matches(p.category, v_search)
         or private.text_matches(p.description, v_search))
  order by (p.status = 'arquivado'), 8 desc, p.name, p.id
  limit p_limit offset p_offset;
end;
$$;

-- Quantidade de projetos por status (abas da lista de projetos), respeitando a busca.
create or replace function public.project_status_counts(p_search text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_search text := private.clean_search(p_search);
begin
  perform private.current_profile();
  return coalesce((
    select jsonb_object_agg(t.status, t.n)
    from (
      select p.status, count(*) as n
      from public.projects p
      where p.deleted_at is null
        and (private.text_matches(p.name, v_search)
             or private.text_matches(p.category, v_search)
             or private.text_matches(p.description, v_search))
      group by p.status
    ) t
  ), '{}'::jsonb);
end;
$$;

-- get_project passa a trazer também a contagem por status (abas da página do projeto).
drop function if exists public.get_project(uuid);

create or replace function public.get_project(p_id uuid)
returns table (
  id uuid,
  name text,
  description text,
  category text,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  suggestion_count bigint,
  vote_count bigint,
  type_counts jsonb,
  status_counts jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.current_profile();
  return query
  select p.id, p.name, p.description, p.category, p.status, p.created_at, p.updated_at,
         (select count(*) from private.eligible_suggestions s where s.project_id = p.id)::bigint,
         (select count(*) from public.votes v
            join private.eligible_suggestions s on s.id = v.suggestion_id
           where s.project_id = p.id)::bigint,
         coalesce((
           select jsonb_object_agg(t.type, t.n)
           from (
             select s.type, count(*) as n
             from private.eligible_suggestions s
             where s.project_id = p.id
             group by s.type
           ) t
         ), '{}'::jsonb),
         coalesce((
           select jsonb_object_agg(t.status, t.n)
           from (
             select s.status, count(*) as n
             from private.eligible_suggestions s
             where s.project_id = p.id
             group by s.status
           ) t
         ), '{}'::jsonb)
  from public.projects p
  where p.id = p_id and p.deleted_at is null;

  if not found then
    raise exception 'Projeto não encontrado.' using errcode = 'HV404';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Sugestões de um projeto
-- -----------------------------------------------------------------------------

drop function if exists public.list_suggestions(uuid, text, text, integer, integer);

create or replace function public.list_suggestions(
  p_project_id uuid,
  p_type text default null,
  p_sort text default 'ranking',
  p_limit integer default 20,
  p_offset integer default 0,
  p_status text default null,
  p_search text default null
)
returns table (
  id uuid,
  project_id uuid,
  type text,
  type_label text,
  title text,
  description text,
  status text,
  status_reason text,
  author_name text,
  is_author boolean,
  created_at timestamptz,
  updated_at timestamptz,
  vote_count bigint,
  comment_count bigint,
  has_voted boolean,
  voting_open boolean,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_profile public.profiles := private.current_profile();
  v_search text := private.clean_search(p_search);
begin
  perform private.check_page(p_limit, p_offset);
  perform private.check_suggestion_status_filter(p_status);

  if p_sort is null or p_sort not in ('ranking', 'recentes') then
    raise exception 'Ordenação inválida.' using errcode = 'HV422';
  end if;
  if p_type is not null and not exists (select 1 from public.suggestion_types t where t.slug = p_type) then
    raise exception 'Tipo de sugestão inválido.' using errcode = 'HV422';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id and p.deleted_at is null) then
    raise exception 'Projeto não encontrado.' using errcode = 'HV404';
  end if;

  return query
  with base as (
    select s.*,
           p.status as project_status,
           (select count(*) from public.votes v where v.suggestion_id = s.id) as vote_count,
           (select count(*) from public.comments c
             where c.suggestion_id = s.id and c.deleted_at is null) as comment_count
    from private.eligible_suggestions s
    join public.projects p on p.id = s.project_id
    where s.project_id = p_project_id
      and (p_type is null or s.type = p_type)
      and (p_status is null or s.status = p_status)
      and (private.text_matches(s.title, v_search) or private.text_matches(s.description, v_search))
  )
  select b.id, b.project_id, b.type, t.label, b.title, b.description, b.status, b.status_reason,
         a.name, b.author_id = v_profile.id, b.created_at, b.updated_at,
         b.vote_count::bigint, b.comment_count::bigint,
         exists (select 1 from public.votes v where v.suggestion_id = b.id and v.user_id = v_profile.id),
         private.voting_open(b.status, b.project_status),
         count(*) over ()::bigint
  from base b
  join public.suggestion_types t on t.slug = b.type
  join public.profiles a on a.id = b.author_id
  order by
    case when p_sort = 'ranking' then b.vote_count end desc nulls last,
    b.created_at desc,
    b.id
  limit p_limit offset p_offset;
end;
$$;

-- -----------------------------------------------------------------------------
-- Minhas sugestões
-- -----------------------------------------------------------------------------

drop function if exists public.list_my_suggestions(integer, integer);

create or replace function public.list_my_suggestions(
  p_limit integer default 20,
  p_offset integer default 0,
  p_status text default null
)
returns table (
  id uuid,
  project_id uuid,
  project_name text,
  title text,
  status text,
  created_at timestamptz,
  vote_count bigint,
  points numeric,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_profile public.profiles := private.current_profile();
begin
  perform private.check_page(p_limit, p_offset);
  perform private.check_suggestion_status_filter(p_status);

  return query
  select s.id, s.project_id, p.name, s.title, s.status, s.created_at,
         vc.n::bigint,
         (vc.n * private.points_per_vote())::numeric(12, 1),
         count(*) over ()::bigint
  from private.eligible_suggestions s
  join public.projects p on p.id = s.project_id
  cross join lateral (
    select count(*) as n from public.votes v
    where v.suggestion_id = s.id and v.user_id <> s.author_id
  ) vc
  where s.author_id = v_profile.id
    and (p_status is null or s.status = p_status)
  order by s.created_at desc, s.id
  limit p_limit offset p_offset;
end;
$$;

-- -----------------------------------------------------------------------------
-- Administração: usuários
-- -----------------------------------------------------------------------------

drop function if exists public.admin_list_users(text, integer, integer);

create or replace function public.admin_list_users(
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0,
  p_role text default null,
  p_status text default null
)
returns table (
  id uuid,
  name text,
  email text,
  role text,
  status text,
  created_at timestamptz,
  suggestion_count bigint,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_search text := private.clean_search(p_search);
begin
  perform private.require_admin();
  perform private.check_page(p_limit, p_offset, 100);
  if p_role is not null and p_role not in ('user', 'admin') then
    raise exception 'Perfil inválido.' using errcode = 'HV422';
  end if;
  if p_status is not null and p_status not in ('active', 'disabled') then
    raise exception 'Situação de conta inválida.' using errcode = 'HV422';
  end if;

  return query
  select p.id, p.name, u.email::text, p.role, p.status, p.created_at,
         (select count(*) from public.suggestions s where s.author_id = p.id and s.deleted_at is null)::bigint,
         count(*) over ()::bigint
  from public.profiles p
  join auth.users u on u.id = p.id
  where (private.text_matches(p.name, v_search) or private.text_matches(u.email::text, v_search))
    and (p_role is null or p.role = p_role)
    and (p_status is null or p.status = p_status)
  order by p.created_at desc, p.id
  limit p_limit offset p_offset;
end;
$$;

-- Contas por situação (abas da gestão de usuários), respeitando a busca e o perfil.
create or replace function public.admin_user_status_counts(p_search text default null, p_role text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_search text := private.clean_search(p_search);
begin
  perform private.require_admin();
  return coalesce((
    select jsonb_object_agg(t.status, t.n)
    from (
      select p.status, count(*) as n
      from public.profiles p
      join auth.users u on u.id = p.id
      where (private.text_matches(p.name, v_search) or private.text_matches(u.email::text, v_search))
        and (p_role is null or p.role = p_role)
      group by p.status
    ) t
  ), '{}'::jsonb);
end;
$$;

-- -----------------------------------------------------------------------------
-- Administração: fila de sugestões
-- -----------------------------------------------------------------------------

drop function if exists public.admin_list_suggestions(text, integer, integer);

create or replace function public.admin_list_suggestions(
  p_status text default null,
  p_limit integer default 20,
  p_offset integer default 0,
  p_search text default null,
  p_type text default null
)
returns table (
  id uuid,
  project_id uuid,
  project_name text,
  type text,
  type_label text,
  title text,
  status text,
  author_name text,
  created_at timestamptz,
  vote_count bigint,
  comment_count bigint,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_search text := private.clean_search(p_search);
begin
  perform private.require_admin();
  perform private.check_page(p_limit, p_offset, 50);
  perform private.check_suggestion_status_filter(p_status);
  if p_type is not null and not exists (select 1 from public.suggestion_types t where t.slug = p_type) then
    raise exception 'Tipo de sugestão inválido.' using errcode = 'HV422';
  end if;

  -- Sugestões mais apoiadas primeiro: ajuda a priorizar a análise.
  return query
  select s.id, s.project_id, p.name, s.type, t.label, s.title, s.status, a.name, s.created_at,
         vc.n::bigint,
         (select count(*) from public.comments c where c.suggestion_id = s.id and c.deleted_at is null)::bigint,
         count(*) over ()::bigint
  from private.eligible_suggestions s
  join public.projects p on p.id = s.project_id
  join public.suggestion_types t on t.slug = s.type
  join public.profiles a on a.id = s.author_id
  cross join lateral (select count(*) as n from public.votes v where v.suggestion_id = s.id) vc
  where (p_status is null or s.status = p_status)
    and (p_type is null or s.type = p_type)
    and (private.text_matches(s.title, v_search)
         or private.text_matches(p.name, v_search)
         or private.text_matches(a.name, v_search))
  order by vc.n desc, s.created_at desc, s.id
  limit p_limit offset p_offset;
end;
$$;

-- Sugestões por status (abas da fila do administrador), respeitando busca e tipo.
create or replace function public.admin_suggestion_status_counts(p_search text default null, p_type text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_search text := private.clean_search(p_search);
begin
  perform private.require_admin();
  return coalesce((
    select jsonb_object_agg(t.status, t.n)
    from (
      select s.status, count(*) as n
      from private.eligible_suggestions s
      join public.projects p on p.id = s.project_id
      join public.profiles a on a.id = s.author_id
      where (p_type is null or s.type = p_type)
        and (private.text_matches(s.title, v_search)
             or private.text_matches(p.name, v_search)
             or private.text_matches(a.name, v_search))
      group by s.status
    ) t
  ), '{}'::jsonb);
end;
$$;

-- -----------------------------------------------------------------------------
-- Privilégios
-- -----------------------------------------------------------------------------

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_admin() to authenticated;

revoke execute on function
  public.list_projects(integer, integer, text, text),
  public.project_status_counts(text),
  public.get_project(uuid),
  public.list_suggestions(uuid, text, text, integer, integer, text, text),
  public.list_my_suggestions(integer, integer, text),
  public.admin_list_users(text, integer, integer, text, text),
  public.admin_user_status_counts(text, text),
  public.admin_list_suggestions(text, integer, integer, text, text),
  public.admin_suggestion_status_counts(text, text)
from public, anon;

grant execute on function
  public.list_projects(integer, integer, text, text),
  public.project_status_counts(text),
  public.get_project(uuid),
  public.list_suggestions(uuid, text, text, integer, integer, text, text),
  public.list_my_suggestions(integer, integer, text),
  public.admin_list_users(text, integer, integer, text, text),
  public.admin_user_status_counts(text, text),
  public.admin_list_suggestions(text, integer, integer, text, text),
  public.admin_suggestion_status_counts(text, text)
to authenticated;
