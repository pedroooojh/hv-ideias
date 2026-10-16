-- =============================================================================
-- Perfil público.
--
-- Nomes e fotos de autores passam a levar ao perfil da pessoa: posição, pontos,
-- medalhas dos fechamentos semanais e sugestões publicadas. Para isso as funções
-- que mostram pessoas devolvem também o id do usuário (que já aparecia no caminho
-- da foto). E-mails continuam fora de tudo que não é administração.
-- =============================================================================

drop function if exists public.list_suggestions(uuid, text, text, integer, integer, text, text);

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
  author_id uuid,
  author_name text,
  author_avatar text,
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
         b.author_id, a.name, a.avatar_path, b.author_id = v_profile.id, b.created_at, b.updated_at,
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

drop function if exists public.get_suggestion(uuid);

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
  author_id uuid,
  author_name text,
  author_avatar text,
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
         s.status, s.status_reason, s.status_changed_at, s.author_id, a.name, a.avatar_path, s.author_id = v_profile.id,
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

drop function if exists public.list_comments(uuid, integer, integer);

create or replace function public.list_comments(
  p_suggestion_id uuid,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  content text,
  author_id uuid,
  author_name text,
  author_avatar text,
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

  -- Comentários removidos continuam na thread como marcador (sem conteúdo nem autor),
  -- para que respostas posteriores não percam o contexto.
  return query
  select c.id,
         case when c.deleted_at is null then c.content end,
         case when c.deleted_at is null then c.author_id end,
         case when c.deleted_at is null then a.name end,
         case when c.deleted_at is null then a.avatar_path end,
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

drop function if exists public.get_ranking(integer, integer);

create or replace function public.get_ranking(p_limit integer default 50, p_offset integer default 0)
returns table (
  rank_position bigint,
  user_id uuid,
  user_name text,
  user_avatar text,
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
  select r.rank_position, r.user_id, r.user_name, pr.avatar_path, r.score, r.suggestion_count, r.votes_received,
         r.user_id = v_profile.id, count(*) over ()::bigint
  from private.ranked_scores() r
  join public.profiles pr on pr.id = r.user_id
  order by r.rank_position
  limit p_limit offset p_offset;
end;
$$;

-- -----------------------------------------------------------------------------
-- Perfil público e sugestões de uma pessoa
-- -----------------------------------------------------------------------------

create or replace function public.get_public_profile(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles := private.current_profile();
  v_target public.profiles;
  v_score record;
  v_weekly record;
  v_start timestamptz;
  v_end timestamptz;
begin
  select * into v_target from public.profiles where id = p_user_id;
  -- Contas desativadas não têm perfil público (como no ranking).
  if not found or v_target.status <> 'active' then
    raise exception 'Perfil não encontrado.' using errcode = 'HV404';
  end if;

  select r.rank_position, r.score, r.votes_received into v_score
  from private.ranked_scores() r where r.user_id = p_user_id;

  select w.week_start, w.week_end into v_start, v_end from private.ranking_week(0) w;
  select m.rank_position, m.score into v_weekly
  from private.weekly_ranked_scores(v_start, v_end) m where m.user_id = p_user_id;

  return jsonb_build_object(
    'id', v_target.id,
    'name', v_target.name,
    'avatar_path', v_target.avatar_path,
    'member_since', v_target.created_at,
    'is_me', v_target.id = v_profile.id,
    'rank_position', v_score.rank_position,
    'score', coalesce(v_score.score, 0),
    'votes_received', coalesce(v_score.votes_received, 0),
    'weekly_rank_position', v_weekly.rank_position,
    'weekly_score', coalesce(v_weekly.score, 0),
    'suggestion_count', (select count(*) from private.eligible_suggestions s where s.author_id = p_user_id),
    'medals', private.user_medals(p_user_id)
  );
end;
$$;

create or replace function public.list_user_suggestions(
  p_user_id uuid,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  id uuid,
  project_id uuid,
  project_name text,
  title text,
  status text,
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
  perform private.current_profile();
  perform private.check_page(p_limit, p_offset);
  if not exists (select 1 from public.profiles p where p.id = p_user_id and p.status = 'active') then
    raise exception 'Perfil não encontrado.' using errcode = 'HV404';
  end if;

  return query
  select s.id, s.project_id, p.name, s.title, s.status, s.created_at,
         (select count(*) from public.votes v where v.suggestion_id = s.id)::bigint,
         (select count(*) from public.comments c where c.suggestion_id = s.id and c.deleted_at is null)::bigint,
         count(*) over ()::bigint
  from private.eligible_suggestions s
  join public.projects p on p.id = s.project_id
  where s.author_id = p_user_id
  order by s.created_at desc, s.id
  limit p_limit offset p_offset;
end;
$$;

-- -----------------------------------------------------------------------------
-- Privilégios
-- -----------------------------------------------------------------------------

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_admin(), private.can_participate() to authenticated;

revoke execute on function
  public.list_suggestions(uuid, text, text, integer, integer, text, text),
  public.get_suggestion(uuid),
  public.list_comments(uuid, integer, integer),
  public.get_ranking(integer, integer),
  public.get_public_profile(uuid),
  public.list_user_suggestions(uuid, integer, integer)
from public, anon;

grant execute on function
  public.list_suggestions(uuid, text, text, integer, integer, text, text),
  public.get_suggestion(uuid),
  public.list_comments(uuid, integer, integer),
  public.get_ranking(integer, integer),
  public.get_public_profile(uuid),
  public.list_user_suggestions(uuid, integer, integer)
to authenticated;
