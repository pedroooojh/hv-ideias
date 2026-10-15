-- =============================================================================
-- Hubvision Ideias — API (funções RPC)
--
-- Todas as funções são SECURITY DEFINER com search_path vazio e validam,
-- nesta ordem: autenticação/conta ativa, permissão, limite de requisições,
-- existência dos registros e dados de entrada. O cliente nunca informa autor,
-- perfil, contagem de votos ou pontuação.
--
-- Códigos de erro próprios (SQLSTATE), traduzidos pelo frontend:
--   HV401 não autenticado        HV403 sem permissão / conta desativada
--   HV404 registro inexistente   HV409 conflito com regra de negócio
--   HV422 dados inválidos        HV429 limite de requisições excedido
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Validação de entrada
-- -----------------------------------------------------------------------------

create or replace function private.clean_text(
  p_value text,
  p_field text,
  p_min integer,
  p_max integer
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_value text := btrim(coalesce(p_value, ''));
begin
  if char_length(v_value) = 0 then
    raise exception '% é obrigatório.', p_field using errcode = 'HV422';
  end if;
  if char_length(v_value) < p_min then
    raise exception '% deve ter pelo menos % caracteres.', p_field, p_min using errcode = 'HV422';
  end if;
  if char_length(v_value) > p_max then
    raise exception '% deve ter no máximo % caracteres.', p_field, p_max using errcode = 'HV422';
  end if;
  return v_value;
end;
$$;

create or replace function private.check_page(p_limit integer, p_offset integer, p_max integer default 50)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > p_max then
    raise exception 'Tamanho de página inválido (1 a %).', p_max using errcode = 'HV422';
  end if;
  if p_offset is null or p_offset < 0 then
    raise exception 'Deslocamento de página inválido.' using errcode = 'HV422';
  end if;
end;
$$;

create or replace function private.voting_open(p_suggestion_status text, p_project_status text)
returns boolean
language sql
immutable
as $$
  select p_suggestion_status in ('em_analise', 'planejado', 'em_desenvolvimento')
     and p_project_status <> 'arquivado';
$$;

-- Carrega uma sugestão visível (não excluída, de projeto não excluído) com
-- bloqueio de linha, ou interrompe com HV404.
create or replace function private.lock_visible_suggestion(p_id uuid)
returns public.suggestions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_suggestion public.suggestions;
begin
  select s.* into v_suggestion
  from public.suggestions s
  join public.projects p on p.id = s.project_id
  where s.id = p_id and s.deleted_at is null and p.deleted_at is null
  for update of s;

  if not found then
    raise exception 'Sugestão não encontrada ou removida.' using errcode = 'HV404';
  end if;
  return v_suggestion;
end;
$$;

-- =============================================================================
-- Leitura geral (exige login: nenhuma função é executável por anon)
-- =============================================================================

create or replace function public.list_suggestion_types()
returns table (slug text, label text, sort_order integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.current_profile();
  return query
  select t.slug, t.label, t.sort_order
  from public.suggestion_types t
  where t.is_active
  order by t.sort_order, t.label;
end;
$$;

-- Indicadores da página inicial. Definições:
--   active_projects     projetos não excluídos e não arquivados
--   total_suggestions   sugestões elegíveis (não excluídas, de projeto não excluído)
--   total_votes         votos válidos em sugestões elegíveis
--   in_development      sugestões elegíveis com status 'em_desenvolvimento'
--   votes_last_24h      votos válidos registrados nas últimas 24 horas
--   votes_last_7d       votos válidos registrados nos últimos 7 dias
--   top_projects        3 projetos com mais votos e sua fatia do total
--   highlight           última sugestão que avançou de status
create or replace function public.get_platform_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_total_votes bigint;
  v_highlight jsonb;
begin
  perform private.current_profile();

  select count(*) into v_total_votes
  from public.votes v
  join private.eligible_suggestions s on s.id = v.suggestion_id;

  select jsonb_build_object(
      'suggestion_id', s.id,
      'title', s.title,
      'status', s.status,
      'project_name', p.name,
      'vote_count', (select count(*) from public.votes v where v.suggestion_id = s.id),
      'changed_at', s.status_changed_at
    )
    into v_highlight
    from private.eligible_suggestions s
    join public.projects p on p.id = s.project_id
    where s.status in ('planejado', 'em_desenvolvimento', 'implementado')
      and s.status_changed_at is not null
    order by s.status_changed_at desc
    limit 1;

  select jsonb_build_object(
    'active_projects', (
      select count(*) from public.projects
      where deleted_at is null and status <> 'arquivado'
    ),
    'total_suggestions', (select count(*) from private.eligible_suggestions),
    'total_votes', v_total_votes,
    'in_development', (
      select count(*) from private.eligible_suggestions where status = 'em_desenvolvimento'
    ),
    'votes_last_24h', (
      select count(*) from public.votes v
      join private.eligible_suggestions s on s.id = v.suggestion_id
      where v.created_at > now() - interval '24 hours'
    ),
    'votes_last_7d', (
      select count(*) from public.votes v
      join private.eligible_suggestions s on s.id = v.suggestion_id
      where v.created_at > now() - interval '7 days'
    ),
    'top_projects', coalesce((
      select jsonb_agg(t order by t.vote_count desc, t.name)
      from (
        select p.id, p.name, p.category, count(v.id) as vote_count,
               case when v_total_votes = 0 then 0
                    else round(count(v.id) * 100.0 / v_total_votes) end as share
        from public.projects p
        join private.eligible_suggestions s on s.project_id = p.id
        join public.votes v on v.suggestion_id = s.id
        where p.deleted_at is null
        group by p.id, p.name, p.category
        order by count(v.id) desc, p.name
        limit 3
      ) t
    ), '[]'::jsonb),
    'highlight', v_highlight
  )
  into v_result;

  return v_result;
end;
$$;

create or replace function public.list_projects(p_limit integer default 12, p_offset integer default 0)
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
begin
  perform private.current_profile();
  perform private.check_page(p_limit, p_offset);

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
  order by (p.status = 'arquivado'), 8 desc, p.name, p.id
  limit p_limit offset p_offset;
end;
$$;

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
  type_counts jsonb
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
         ), '{}'::jsonb)
  from public.projects p
  where p.id = p_id and p.deleted_at is null;

  if not found then
    raise exception 'Projeto não encontrado.' using errcode = 'HV404';
  end if;
end;
$$;

-- =============================================================================
-- Usuário autenticado
-- =============================================================================

create or replace function public.get_my_profile()
returns table (id uuid, name text, role text, status text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  -- Não usa current_profile(): uma conta desativada precisa conseguir ler o
  -- próprio status para que a interface explique o bloqueio.
  if auth.uid() is null then
    raise exception 'Faça login para continuar.' using errcode = 'HV401';
  end if;
  return query
  select p.id, p.name, p.role, p.status, p.created_at
  from public.profiles p
  where p.id = auth.uid();
end;
$$;

create or replace function public.update_my_profile(p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles := private.current_profile();
begin
  update public.profiles
  set name = private.clean_text(p_name, 'Nome', 2, 80)
  where id = v_profile.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Sugestões: leitura
-- -----------------------------------------------------------------------------

create or replace function public.list_suggestions(
  p_project_id uuid,
  p_type text default null,
  p_sort text default 'ranking',
  p_limit integer default 20,
  p_offset integer default 0
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
begin
  perform private.check_page(p_limit, p_offset);

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

create or replace function public.get_suggestion(p_id uuid)
returns table (
  id uuid,
  project_id uuid,
  project_name text,
  project_category text,
  type text,
  type_label text,
  title text,
  description text,
  status text,
  status_reason text,
  status_changed_at timestamptz,
  author_name text,
  is_author boolean,
  created_at timestamptz,
  updated_at timestamptz,
  vote_count bigint,
  comment_count bigint,
  has_voted boolean,
  voting_open boolean,
  can_edit boolean,
  can_delete boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_profile public.profiles := private.current_profile();
  v_is_admin boolean := v_profile.role = 'admin';
begin
  return query
  select s.id, s.project_id, p.name, p.category, s.type, t.label, s.title, s.description,
         s.status, s.status_reason, s.status_changed_at, a.name, s.author_id = v_profile.id,
         s.created_at, s.updated_at,
         (select count(*) from public.votes v where v.suggestion_id = s.id)::bigint,
         (select count(*) from public.comments c
           where c.suggestion_id = s.id and c.deleted_at is null)::bigint,
         exists (select 1 from public.votes v where v.suggestion_id = s.id and v.user_id = v_profile.id),
         private.voting_open(s.status, p.status),
         v_is_admin or (s.author_id = v_profile.id and s.status = 'em_analise'),
         v_is_admin or (s.author_id = v_profile.id and s.status = 'em_analise')
  from private.eligible_suggestions s
  join public.projects p on p.id = s.project_id
  join public.suggestion_types t on t.slug = s.type
  join public.profiles a on a.id = s.author_id
  where s.id = p_id;

  if not found then
    raise exception 'Sugestão não encontrada ou removida.' using errcode = 'HV404';
  end if;
end;
$$;

create or replace function public.list_status_history(p_suggestion_id uuid)
returns table (
  id bigint,
  previous_status text,
  new_status text,
  reason text,
  actor_name text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.current_profile();
  if not exists (select 1 from private.eligible_suggestions s where s.id = p_suggestion_id) then
    raise exception 'Sugestão não encontrada ou removida.' using errcode = 'HV404';
  end if;

  return query
  select h.id, h.previous_status, h.new_status, h.reason, a.name, h.created_at
  from public.suggestion_status_history h
  left join public.profiles a on a.id = h.actor_id
  where h.suggestion_id = p_suggestion_id
  order by h.created_at desc, h.id desc;
end;
$$;

create or replace function public.list_my_suggestions(p_limit integer default 20, p_offset integer default 0)
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
  order by s.created_at desc, s.id
  limit p_limit offset p_offset;
end;
$$;

-- -----------------------------------------------------------------------------
-- Sugestões: escrita
-- -----------------------------------------------------------------------------

create or replace function public.create_suggestion(
  p_project_id uuid,
  p_type text,
  p_title text,
  p_description text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles := private.current_profile();
  v_project public.projects;
  v_title text;
  v_description text;
  v_id uuid;
begin
  perform private.rate_limit(v_profile.id, 'create_suggestion', 10, interval '1 hour');

  select * into v_project from public.projects where id = p_project_id and deleted_at is null;
  if not found then
    raise exception 'Projeto não encontrado.' using errcode = 'HV404';
  end if;
  if v_project.status = 'arquivado' then
    raise exception 'Este projeto está arquivado e não recebe novas sugestões.' using errcode = 'HV409';
  end if;
  if p_type is null or not exists (
    select 1 from public.suggestion_types where slug = p_type and is_active
  ) then
    raise exception 'Selecione um tipo de sugestão válido.' using errcode = 'HV422';
  end if;

  v_title := private.clean_text(p_title, 'Título', 5, 150);
  v_description := private.clean_text(p_description, 'Descrição', 10, 5000);

  insert into public.suggestions (project_id, author_id, type, title, description)
  values (v_project.id, v_profile.id, p_type, v_title, v_description)
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.update_suggestion(
  p_id uuid,
  p_type text,
  p_title text,
  p_description text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles := private.current_profile();
  v_suggestion public.suggestions := private.lock_visible_suggestion(p_id);
  v_is_admin boolean := v_profile.role = 'admin';
  v_title text;
  v_description text;
begin
  if not v_is_admin then
    if v_suggestion.author_id <> v_profile.id then
      raise exception 'Você só pode editar as suas próprias sugestões.' using errcode = 'HV403';
    end if;
    if v_suggestion.status <> 'em_analise' then
      raise exception 'Esta sugestão já saiu da análise e só pode ser ajustada pela administração.' using errcode = 'HV409';
    end if;
  end if;

  if p_type is null or not exists (select 1 from public.suggestion_types where slug = p_type) then
    raise exception 'Selecione um tipo de sugestão válido.' using errcode = 'HV422';
  end if;
  v_title := private.clean_text(p_title, 'Título', 5, 150);
  v_description := private.clean_text(p_description, 'Descrição', 10, 5000);

  update public.suggestions
  set title = v_title, description = v_description, type = p_type
  where id = v_suggestion.id;

  if v_is_admin then
    perform private.audit(
      v_profile.id, 'suggestion', v_suggestion.id, 'suggestion.update',
      jsonb_build_object('title', v_suggestion.title, 'type', v_suggestion.type,
                         'description', v_suggestion.description),
      jsonb_build_object('title', v_title, 'type', p_type, 'description', v_description)
    );
  end if;
end;
$$;

create or replace function public.delete_suggestion(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles := private.current_profile();
  v_suggestion public.suggestions := private.lock_visible_suggestion(p_id);
  v_is_admin boolean := v_profile.role = 'admin';
begin
  if not v_is_admin then
    if v_suggestion.author_id <> v_profile.id then
      raise exception 'Você só pode excluir as suas próprias sugestões.' using errcode = 'HV403';
    end if;
    if v_suggestion.status <> 'em_analise' then
      raise exception 'Esta sugestão já saiu da análise e só pode ser removida pela administração.' using errcode = 'HV409';
    end if;
  end if;

  -- Exclusão lógica: votos e comentários são preservados para o histórico, mas a
  -- sugestão some das listagens e deixa de gerar pontos (ver eligible_suggestions).
  update public.suggestions
  set deleted_at = now(), deleted_by = v_profile.id
  where id = v_suggestion.id;

  if v_is_admin then
    perform private.audit(
      v_profile.id, 'suggestion', v_suggestion.id, 'suggestion.delete',
      jsonb_build_object('title', v_suggestion.title, 'status', v_suggestion.status,
                         'author_id', v_suggestion.author_id),
      null
    );
  end if;
end;
$$;

create or replace function public.set_suggestion_status(
  p_id uuid,
  p_status text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles := private.require_admin();
  v_suggestion public.suggestions := private.lock_visible_suggestion(p_id);
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if p_status is null or p_status not in ('em_analise', 'planejado', 'em_desenvolvimento', 'implementado', 'nao_aprovado') then
    raise exception 'Status inválido.' using errcode = 'HV422';
  end if;
  if p_status = 'nao_aprovado' and (v_reason is null or char_length(v_reason) < 5) then
    raise exception 'Informe uma justificativa (mínimo de 5 caracteres) para a não aprovação.' using errcode = 'HV422';
  end if;
  if v_reason is not null and char_length(v_reason) > 1000 then
    raise exception 'A justificativa deve ter no máximo 1000 caracteres.' using errcode = 'HV422';
  end if;
  if p_status = v_suggestion.status and v_reason is not distinct from v_suggestion.status_reason then
    return;
  end if;

  update public.suggestions
  set status = p_status,
      status_reason = case when p_status = 'nao_aprovado' then v_reason else null end,
      status_changed_at = now()
  where id = v_suggestion.id;

  insert into public.suggestion_status_history (suggestion_id, actor_id, previous_status, new_status, reason)
  values (v_suggestion.id, v_profile.id, v_suggestion.status, p_status, v_reason);

  perform private.audit(
    v_profile.id, 'suggestion', v_suggestion.id, 'suggestion.status_change',
    jsonb_build_object('status', v_suggestion.status),
    jsonb_build_object('status', p_status, 'reason', v_reason)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Votos
-- -----------------------------------------------------------------------------

-- Define o voto do usuário (idempotente): p_vote = true registra, false retira.
-- Retorna a contagem real armazenada após a operação.
create or replace function public.set_vote(p_suggestion_id uuid, p_vote boolean)
returns table (vote_count bigint, has_voted boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_profile public.profiles := private.current_profile();
  v_suggestion public.suggestions;
  v_project_status text;
begin
  if p_vote is null then
    raise exception 'Informe se deseja votar ou retirar o voto.' using errcode = 'HV422';
  end if;

  perform private.rate_limit(v_profile.id, 'vote', 60, interval '1 minute');
  v_suggestion := private.lock_visible_suggestion(p_suggestion_id);

  if p_vote then
    if v_suggestion.author_id = v_profile.id then
      raise exception 'Você não pode votar na sua própria sugestão.' using errcode = 'HV403';
    end if;
    select p.status into v_project_status from public.projects p where p.id = v_suggestion.project_id;
    if not private.voting_open(v_suggestion.status, v_project_status) then
      raise exception 'A votação desta sugestão está encerrada.' using errcode = 'HV409';
    end if;

    insert into public.votes (user_id, suggestion_id)
    values (v_profile.id, v_suggestion.id)
    on conflict (user_id, suggestion_id) do nothing;
  else
    delete from public.votes
    where user_id = v_profile.id and suggestion_id = v_suggestion.id;
  end if;

  return query
  select (select count(*) from public.votes v where v.suggestion_id = v_suggestion.id)::bigint,
         exists (select 1 from public.votes v
                 where v.suggestion_id = v_suggestion.id and v.user_id = v_profile.id);
end;
$$;

-- -----------------------------------------------------------------------------
-- Comentários
-- -----------------------------------------------------------------------------

create or replace function public.list_comments(
  p_suggestion_id uuid,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  content text,
  author_name text,
  is_author boolean,
  created_at timestamptz,
  edited_at timestamptz,
  is_deleted boolean,
  deletion_reason text,
  can_edit boolean,
  can_delete boolean,
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
  v_is_admin boolean := v_profile.role = 'admin';
begin
  perform private.check_page(p_limit, p_offset, 100);
  if not exists (select 1 from private.eligible_suggestions s where s.id = p_suggestion_id) then
    raise exception 'Sugestão não encontrada ou removida.' using errcode = 'HV404';
  end if;

  -- Comentários removidos continuam na thread como marcador (sem conteúdo),
  -- para que respostas posteriores não percam o contexto.
  return query
  select c.id,
         case when c.deleted_at is null then c.content end,
         case when c.deleted_at is null then a.name end,
         c.author_id = v_profile.id,
         c.created_at,
         c.edited_at,
         c.deleted_at is not null,
         c.deletion_reason,
         c.deleted_at is null and c.author_id = v_profile.id,
         c.deleted_at is null and (c.author_id = v_profile.id or v_is_admin),
         count(*) over ()::bigint
  from public.comments c
  join public.profiles a on a.id = c.author_id
  where c.suggestion_id = p_suggestion_id
  order by c.created_at, c.id
  limit p_limit offset p_offset;
end;
$$;

create or replace function public.create_comment(p_suggestion_id uuid, p_content text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles := private.current_profile();
  v_suggestion public.suggestions;
  v_content text;
  v_id uuid;
begin
  perform private.rate_limit(v_profile.id, 'comment', 10, interval '5 minutes');
  v_suggestion := private.lock_visible_suggestion(p_suggestion_id);
  if exists (select 1 from public.projects where id = v_suggestion.project_id and status = 'arquivado') then
    raise exception 'Este projeto está arquivado e não recebe novos comentários.' using errcode = 'HV409';
  end if;

  v_content := private.clean_text(p_content, 'Comentário', 1, 2000);

  insert into public.comments (suggestion_id, author_id, content)
  values (v_suggestion.id, v_profile.id, v_content)
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.update_comment(p_id uuid, p_content text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles := private.current_profile();
  v_comment public.comments;
begin
  select * into v_comment from public.comments where id = p_id and deleted_at is null for update;
  if not found then
    raise exception 'Comentário não encontrado ou removido.' using errcode = 'HV404';
  end if;
  -- Nem administradores reescrevem palavras de outra pessoa: moderação é por remoção.
  if v_comment.author_id <> v_profile.id then
    raise exception 'Você só pode editar os seus próprios comentários.' using errcode = 'HV403';
  end if;

  update public.comments
  set content = private.clean_text(p_content, 'Comentário', 1, 2000),
      edited_at = now()
  where id = v_comment.id;
end;
$$;

create or replace function public.delete_comment(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles := private.current_profile();
  v_comment public.comments;
  v_is_author boolean;
begin
  select * into v_comment from public.comments where id = p_id and deleted_at is null for update;
  if not found then
    raise exception 'Comentário não encontrado ou removido.' using errcode = 'HV404';
  end if;

  v_is_author := v_comment.author_id = v_profile.id;
  if not v_is_author and v_profile.role <> 'admin' then
    raise exception 'Você só pode excluir os seus próprios comentários.' using errcode = 'HV403';
  end if;

  update public.comments
  set deleted_at = now(),
      deleted_by = v_profile.id,
      deletion_reason = case when v_is_author then 'author' else 'moderation' end
  where id = v_comment.id;

  if not v_is_author then
    perform private.audit(
      v_profile.id, 'comment', v_comment.id, 'comment.moderate',
      jsonb_build_object('suggestion_id', v_comment.suggestion_id, 'author_id', v_comment.author_id),
      null
    );
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Ranking
-- -----------------------------------------------------------------------------

-- Ordem: pontuação desc, votos recebidos desc, participação mais antiga,
-- nome e, por fim, id (apenas para tornar o resultado determinístico).
create or replace function private.ranked_scores()
returns table (
  user_id uuid,
  user_name text,
  score numeric,
  suggestion_count bigint,
  votes_received bigint,
  rank_position bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select us.user_id, us.user_name, us.score, us.suggestion_count, us.votes_received,
         row_number() over (
           order by us.score desc, us.votes_received desc, us.first_participation_at asc,
                    us.user_name, us.user_id
         )
  from private.user_scores us;
$$;

create or replace function public.get_ranking(p_limit integer default 50, p_offset integer default 0)
returns table (
  rank_position bigint,
  user_name text,
  score numeric,
  suggestion_count bigint,
  votes_received bigint,
  is_me boolean,
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
  perform private.check_page(p_limit, p_offset, 100);

  return query
  select r.rank_position, r.user_name, r.score, r.suggestion_count, r.votes_received,
         r.user_id = v_profile.id, count(*) over ()::bigint
  from private.ranked_scores() r
  order by r.rank_position
  limit p_limit offset p_offset;
end;
$$;

create or replace function public.get_my_score()
returns table (
  rank_position bigint,
  score numeric,
  suggestion_count bigint,
  votes_received bigint
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
  return query
  select r.rank_position, r.score, r.suggestion_count, r.votes_received
  from private.ranked_scores() r
  where r.user_id = v_profile.id;

  if not found then
    return query select null::bigint, 0::numeric, 0::bigint, 0::bigint;
  end if;
end;
$$;

-- =============================================================================
-- Administração
-- =============================================================================

create or replace function private.check_project_status(p_status text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_status is null or p_status not in ('em_avaliacao', 'planejado', 'em_desenvolvimento', 'concluido', 'arquivado') then
    raise exception 'Status de projeto inválido.' using errcode = 'HV422';
  end if;
  return p_status;
end;
$$;

create or replace function public.create_project(
  p_name text,
  p_description text,
  p_category text,
  p_status text default 'em_avaliacao'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles := private.require_admin();
  v_id uuid;
  v_row public.projects;
begin
  insert into public.projects (name, description, category, status, created_by)
  values (
    private.clean_text(p_name, 'Nome', 3, 120),
    private.clean_text(p_description, 'Descrição', 10, 4000),
    private.clean_text(p_category, 'Categoria', 2, 60),
    private.check_project_status(p_status),
    v_profile.id
  )
  returning * into v_row;
  v_id := v_row.id;

  perform private.audit(
    v_profile.id, 'project', v_id, 'project.create', null,
    jsonb_build_object('name', v_row.name, 'category', v_row.category, 'status', v_row.status)
  );
  return v_id;
end;
$$;

create or replace function public.update_project(
  p_id uuid,
  p_name text,
  p_description text,
  p_category text,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles := private.require_admin();
  v_old public.projects;
  v_new public.projects;
begin
  select * into v_old from public.projects where id = p_id and deleted_at is null for update;
  if not found then
    raise exception 'Projeto não encontrado.' using errcode = 'HV404';
  end if;

  update public.projects
  set name = private.clean_text(p_name, 'Nome', 3, 120),
      description = private.clean_text(p_description, 'Descrição', 10, 4000),
      category = private.clean_text(p_category, 'Categoria', 2, 60),
      status = private.check_project_status(p_status)
  where id = p_id
  returning * into v_new;

  perform private.audit(
    v_profile.id, 'project', p_id, 'project.update',
    jsonb_build_object('name', v_old.name, 'category', v_old.category, 'status', v_old.status,
                       'description', v_old.description),
    jsonb_build_object('name', v_new.name, 'category', v_new.category, 'status', v_new.status,
                       'description', v_new.description)
  );
end;
$$;

-- Exclusão lógica do projeto. Se houver sugestões ativas, exige confirmação
-- explícita (p_confirm_with_suggestions = true). As sugestões não são apagadas:
-- deixam de aparecer e de pontuar enquanto o projeto estiver excluído.
create or replace function public.delete_project(p_id uuid, p_confirm_with_suggestions boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles := private.require_admin();
  v_project public.projects;
  v_suggestions bigint;
begin
  select * into v_project from public.projects where id = p_id and deleted_at is null for update;
  if not found then
    raise exception 'Projeto não encontrado.' using errcode = 'HV404';
  end if;

  select count(*) into v_suggestions
  from public.suggestions where project_id = p_id and deleted_at is null;

  if v_suggestions > 0 and not coalesce(p_confirm_with_suggestions, false) then
    raise exception 'Este projeto possui % sugestão(ões) ativa(s). Confirme a exclusão para continuar.', v_suggestions
      using errcode = 'HV409';
  end if;

  update public.projects set deleted_at = now(), deleted_by = v_profile.id where id = p_id;

  perform private.audit(
    v_profile.id, 'project', p_id, 'project.delete',
    jsonb_build_object('name', v_project.name, 'status', v_project.status, 'active_suggestions', v_suggestions),
    null
  );
end;
$$;

create or replace function public.admin_list_users(
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
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
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform private.require_admin();
  perform private.check_page(p_limit, p_offset, 100);

  return query
  select p.id, p.name, u.email::text, p.role, p.status, p.created_at,
         (select count(*) from public.suggestions s where s.author_id = p.id and s.deleted_at is null)::bigint,
         count(*) over ()::bigint
  from public.profiles p
  join auth.users u on u.id = p.id
  where v_search is null
     or p.name ilike '%' || v_search || '%'
     or u.email ilike '%' || v_search || '%'
  order by p.created_at desc, p.id
  limit p_limit offset p_offset;
end;
$$;

create or replace function public.admin_update_user(p_user_id uuid, p_role text, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles := private.require_admin();
  v_target public.profiles;
begin
  if p_role is null or p_role not in ('user', 'admin') then
    raise exception 'Perfil inválido.' using errcode = 'HV422';
  end if;
  if p_status is null or p_status not in ('active', 'disabled') then
    raise exception 'Situação de conta inválida.' using errcode = 'HV422';
  end if;

  select * into v_target from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'Usuário não encontrado.' using errcode = 'HV404';
  end if;
  if v_target.id = v_profile.id and (p_role <> v_target.role or p_status <> v_target.status) then
    raise exception 'Você não pode alterar o seu próprio perfil ou situação.' using errcode = 'HV409';
  end if;
  if v_target.role = p_role and v_target.status = p_status then
    return;
  end if;

  update public.profiles set role = p_role, status = p_status where id = p_user_id;

  perform private.audit(
    v_profile.id, 'user', p_user_id, 'user.update',
    jsonb_build_object('role', v_target.role, 'status', v_target.status),
    jsonb_build_object('role', p_role, 'status', p_status)
  );
end;
$$;

create or replace function public.admin_list_audit_log(
  p_entity_type text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id bigint,
  actor_name text,
  entity_type text,
  entity_id uuid,
  entity_label text,
  action text,
  previous_value jsonb,
  new_value jsonb,
  created_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.require_admin();
  perform private.check_page(p_limit, p_offset, 100);

  return query
  select l.id, a.name, l.entity_type, l.entity_id,
         case l.entity_type
           when 'project' then (select p.name from public.projects p where p.id = l.entity_id)
           when 'suggestion' then (select s.title from public.suggestions s where s.id = l.entity_id)
           when 'user' then (select u.name from public.profiles u where u.id = l.entity_id)
           when 'comment' then (
             select s.title from public.comments c
             join public.suggestions s on s.id = c.suggestion_id
             where c.id = l.entity_id
           )
         end,
         l.action, l.previous_value, l.new_value, l.created_at,
         count(*) over ()::bigint
  from public.audit_log l
  left join public.profiles a on a.id = l.actor_id
  where p_entity_type is null or l.entity_type = p_entity_type
  order by l.created_at desc, l.id desc
  limit p_limit offset p_offset;
end;
$$;

-- Fila de sugestões do administrador: todas as sugestões ativas, de todos os
-- projetos, filtráveis por status (ex.: as que aguardam análise).
create or replace function public.admin_list_suggestions(
  p_status text default null,
  p_limit integer default 20,
  p_offset integer default 0
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
begin
  perform private.require_admin();
  perform private.check_page(p_limit, p_offset, 50);
  if p_status is not null
     and p_status not in ('em_analise', 'planejado', 'em_desenvolvimento', 'implementado', 'nao_aprovado') then
    raise exception 'Status inválido.' using errcode = 'HV422';
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
  where p_status is null or s.status = p_status
  order by vc.n desc, s.created_at desc, s.id
  limit p_limit offset p_offset;
end;
$$;

-- =============================================================================
-- Privilégios de execução
-- =============================================================================

revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;

-- O Supabase concede acesso a anon/authenticated em objetos novos por padrão.
-- Desliga isso para que migrações futuras precisem conceder acesso explicitamente.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
grant execute on function private.is_admin() to authenticated;

-- Somente usuários autenticados. Cada função ainda verifica conta ativa e,
-- quando for o caso, o perfil de administrador.
grant execute on function
  public.list_suggestion_types(),
  public.get_platform_stats(),
  public.list_projects(integer, integer),
  public.get_project(uuid),
  public.get_my_profile(),
  public.update_my_profile(text),
  public.list_suggestions(uuid, text, text, integer, integer),
  public.get_suggestion(uuid),
  public.list_status_history(uuid),
  public.list_my_suggestions(integer, integer),
  public.create_suggestion(uuid, text, text, text),
  public.update_suggestion(uuid, text, text, text),
  public.delete_suggestion(uuid),
  public.set_suggestion_status(uuid, text, text),
  public.set_vote(uuid, boolean),
  public.list_comments(uuid, integer, integer),
  public.create_comment(uuid, text),
  public.update_comment(uuid, text),
  public.delete_comment(uuid),
  public.get_ranking(integer, integer),
  public.get_my_score(),
  public.create_project(text, text, text, text),
  public.update_project(uuid, text, text, text, text),
  public.delete_project(uuid, boolean),
  public.admin_list_users(text, integer, integer),
  public.admin_update_user(uuid, text, text),
  public.admin_list_audit_log(text, integer, integer),
  public.admin_list_suggestions(text, integer, integer)
to authenticated;
