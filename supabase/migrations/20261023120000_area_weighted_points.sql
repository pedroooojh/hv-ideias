-- =============================================================================
-- Pontuação por área, votos pela média ajustada e mover sugestão de projeto.
--
-- Pontos de cada ideia num período (sempre para quem publicou):
--   * 1 ponto pela publicação — perdido se a ideia for marcada Não aprovado;
--   * votos pela média ajustada ao público da área:
--       pontos = 10 × votos no período ÷ (público da área + 5)
--     O público são as pessoas que votaram em alguma ideia da área nos 90 dias
--     até o fim do período (quem usa a área com frequência). Os 5 a mais são
--     "pessoas imaginárias que não votaram": com pouca gente, a aprovação é
--     puxada para baixo até haver gente suficiente para confirmar. Assim, 4 de 4
--     votos (4,4 pts) vale mais que 2 de 2 (2,9) e que 20 de 50 (3,6), e uma área
--     grande não ganha só por ter mais gente votando;
--   * +3 pontos quando a administração seleciona a ideia (Planejado, Em
--     desenvolvimento ou Implementado). Se ela sair da seleção, o bônus sai; se
--     voltar, conta a nova data.
--
-- Peso por área (categoria do projeto): quem participa de muitos projetos não
-- deve ter vantagem só por isso. Em cada período (semana ou mês), os pontos da
-- pessoa são somados por área; a área em que ela mais pontuou vale 100%, a 2ª
-- vale 50% e as demais 25%. Dividir ou juntar projetos dentro de uma mesma área
-- não muda nada no ranking (nem o público).
--
-- Mover sugestão de projeto (administração): corrige ideias postadas no projeto
-- errado; os pontos dela passam a contar na área nova (períodos já fechados não
-- mudam), com auditoria e aviso ao autor.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Regras: fonte única dos valores
-- -----------------------------------------------------------------------------

create or replace function private.points_per_suggestion()
returns numeric
language sql
immutable
as $$ select 1::numeric $$;

-- Pontos de uma ideia votada por todo o público de uma área enorme (o teto dos votos).
create or replace function private.vote_scale()
returns numeric
language sql
immutable
as $$ select 10::numeric $$;

-- Pessoas imaginárias que não votaram, somadas ao público de toda área.
create or replace function private.audience_prior()
returns numeric
language sql
immutable
as $$ select 5::numeric $$;

-- Janela que define quem usa a área com frequência.
create or replace function private.audience_window()
returns interval
language sql
immutable
as $$ select interval '90 days' $$;

create or replace function private.selection_bonus()
returns numeric
language sql
immutable
as $$ select 3::numeric $$;

-- Peso da área pela posição dela entre as áreas da pessoa no período (1 = a melhor).
create or replace function private.area_weight(p_area_rank bigint)
returns numeric
language sql
immutable
as $$
  select case p_area_rank when 1 then 1::numeric when 2 then 0.5::numeric else 0.25::numeric end;
$$;

-- -----------------------------------------------------------------------------
-- Pontos de cada ideia num período
-- -----------------------------------------------------------------------------

-- Os pontos dependem do período (o público da área muda), então deixam de ser
-- eventos com valor fixo: tudo sai de suggestion_points_between.
drop view if exists private.score_events;

-- O valor fixo por voto deixa de existir: o voto vale conforme o público da área.
drop function if exists private.points_per_vote();

-- Público de cada área: pessoas que votaram em ideias da área nos 90 dias até p_end.
-- Áreas com o mesmo nome em maiúsculas/minúsculas diferentes são a mesma área.
create or replace function private.area_audience(p_end timestamptz)
returns table (area_key text, people bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select lower(btrim(p.category)), count(distinct v.user_id)
  from public.votes v
  join private.eligible_suggestions s on s.id = v.suggestion_id and v.user_id <> s.author_id
  join public.projects p on p.id = s.project_id
  where v.created_at >= p_end - private.audience_window()
    and v.created_at < p_end
  group by lower(btrim(p.category));
$$;

-- Pontos que cada ideia gerou no período [p_start, p_end), antes do peso da área.
-- Só aparecem ideias que pontuaram no período (publicação, votos ou seleção).
create or replace function private.suggestion_points_between(p_start timestamptz, p_end timestamptz)
returns table (
  suggestion_id uuid,
  user_id uuid,
  area text,
  points numeric,
  published boolean,
  votes_received bigint,
  last_point_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with s as (
    select s.id, s.author_id, s.status, s.created_at, s.selected_at, btrim(p.category) as area
    from private.eligible_suggestions s
    join public.projects p on p.id = s.project_id
  ),
  period_votes as (
    select v.suggestion_id, count(*) as n, max(v.created_at) as last_at
    from public.votes v
    join s on s.id = v.suggestion_id and v.user_id <> s.author_id
    where v.created_at >= p_start
      and v.created_at < p_end
    group by v.suggestion_id
  ),
  x as (
    select s.id, s.author_id, s.area, s.created_at, s.selected_at,
           s.created_at >= p_start and s.created_at < p_end and s.status <> 'nao_aprovado' as published,
           coalesce(s.selected_at >= p_start and s.selected_at < p_end, false) as selected,
           coalesce(pv.n, 0) as n, pv.last_at, coalesce(a.people, 0) as people
    from s
    left join period_votes pv on pv.suggestion_id = s.id
    left join private.area_audience(p_end) a on a.area_key = lower(s.area)
  )
  select x.id, x.author_id, x.area,
         case when x.published then private.points_per_suggestion() else 0 end
           + case when x.selected then private.selection_bonus() else 0 end
           + private.vote_scale() * x.n / (x.people + private.audience_prior()),
         x.published, x.n,
         greatest(case when x.published then x.created_at end, case when x.selected then x.selected_at end, x.last_at)
  from x
  where x.published or x.selected or x.n > 0;
$$;

-- Pontos de cada pessoa por área num período, já com o peso.
create or replace function private.area_scores_between(p_start timestamptz, p_end timestamptz)
returns table (
  user_id uuid,
  area text,
  area_rank bigint,
  points numeric,
  weight numeric,
  score numeric,
  suggestion_count bigint,
  votes_received bigint,
  last_point_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with a as (
    select sp.user_id, lower(sp.area) as area_key, min(sp.area) as area,
           sum(sp.points) as points,
           count(*) filter (where sp.published) as suggestion_count,
           sum(sp.votes_received)::bigint as votes_received,
           max(sp.last_point_at) as last_point_at
    from private.suggestion_points_between(p_start, p_end) sp
    group by sp.user_id, lower(sp.area)
  ),
  r as (
    select a.*, row_number() over (partition by a.user_id order by a.points desc, a.area_key) as area_rank
    from a
  )
  select r.user_id, r.area, r.area_rank, r.points, private.area_weight(r.area_rank),
         r.points * private.area_weight(r.area_rank), r.suggestion_count, r.votes_received, r.last_point_at
  from r;
$$;

-- Classificação de um período entre usuários ativos com pontos nele (mesma
-- assinatura de antes: semana, mês, fechamentos e perfil usam esta função).
-- Desempate: mais votos recebidos e, depois, quem chegou primeiro à pontuação.
create or replace function private.ranked_scores_between(p_start timestamptz, p_end timestamptz)
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
  with w as (
    select pr.id as user_id, pr.name as user_name,
           sum(a.score) as score,
           sum(a.suggestion_count)::bigint as suggestion_count,
           sum(a.votes_received)::bigint as votes_received,
           max(a.last_point_at) as last_point_at
    from private.area_scores_between(p_start, p_end) a
    join public.profiles pr on pr.id = a.user_id
    where pr.status = 'active'
    group by pr.id, pr.name
  )
  select w.user_id, w.user_name, w.score::numeric(12, 2), w.suggestion_count, w.votes_received,
         row_number() over (order by w.score desc, w.votes_received desc, w.last_point_at asc, w.user_name, w.user_id)
  from w;
$$;

-- Composição dos pontos de uma pessoa no período, da área mais forte à mais fraca.
create or replace function private.score_areas(p_user_id uuid, p_start timestamptz, p_end timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'area', a.area, 'points', a.points::numeric(12, 2), 'weight', a.weight, 'score', a.score::numeric(12, 2)
         ) order by a.area_rank), '[]'::jsonb)
  from private.area_scores_between(p_start, p_end) a
  where a.user_id = p_user_id;
$$;

-- Com pesos e média ajustada a pontuação passa a ter centésimos.
alter table public.weekly_results alter column score type numeric(12, 2);
alter table public.monthly_results alter column score type numeric(12, 2);

-- -----------------------------------------------------------------------------
-- API: ranking e pontuação com a composição por área
-- -----------------------------------------------------------------------------

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
  total_count bigint,
  areas jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_profile public.profiles := private.current_profile();
  v_start timestamptz;
  v_end timestamptz;
begin
  perform private.check_page(p_limit, p_offset, 100);
  select m.month_start, m.month_end into v_start, v_end from private.ranking_month(0) m;

  return query
  with a as (select * from private.area_scores_between(v_start, v_end)),
  page as (
    select r.*, count(*) over ()::bigint as total_count
    from private.ranked_scores_between(v_start, v_end) r
    order by r.rank_position
    limit p_limit offset p_offset
  )
  select r.rank_position, r.user_id, r.user_name, pr.avatar_path, r.score, r.suggestion_count, r.votes_received,
         r.user_id = v_profile.id, r.total_count,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'area', a.area, 'points', a.points::numeric(12, 2), 'weight', a.weight, 'score', a.score::numeric(12, 2)
                  ) order by a.area_rank)
           from a where a.user_id = r.user_id
         ), '[]'::jsonb)
  from page r
  join public.profiles pr on pr.id = r.user_id
  order by r.rank_position;
end;
$$;

drop function if exists public.get_my_score();

create or replace function public.get_my_score()
returns table (
  rank_position bigint,
  score numeric,
  suggestion_count bigint,
  votes_received bigint,
  areas jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_profile public.profiles := private.current_profile();
  v_start timestamptz;
  v_end timestamptz;
begin
  select m.month_start, m.month_end into v_start, v_end from private.ranking_month(0) m;

  return query
  select r.rank_position, r.score, r.suggestion_count, r.votes_received,
         private.score_areas(v_profile.id, v_start, v_end)
  from private.ranked_scores_between(v_start, v_end) r
  where r.user_id = v_profile.id;

  if not found then
    return query select null::bigint, 0::numeric, 0::bigint, 0::bigint, '[]'::jsonb;
  end if;
end;
$$;

-- Perfil público: igual ao anterior, mais a composição dos pontos do mês por área.
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
  v_monthly record;
  v_weekly record;
  v_month_start timestamptz;
  v_month_end timestamptz;
  v_start timestamptz;
  v_end timestamptz;
begin
  select * into v_target from public.profiles where id = p_user_id;
  -- Contas desativadas não têm perfil público (como no ranking).
  if not found or v_target.status <> 'active' then
    raise exception 'Perfil não encontrado.' using errcode = 'HV404';
  end if;

  select m.month_start, m.month_end into v_month_start, v_month_end from private.ranking_month(0) m;
  select r.rank_position, r.score into v_monthly
  from private.ranked_scores_between(v_month_start, v_month_end) r where r.user_id = p_user_id;

  select w.week_start, w.week_end into v_start, v_end from private.ranking_week(0) w;
  select m.rank_position, m.score into v_weekly
  from private.weekly_ranked_scores(v_start, v_end) m where m.user_id = p_user_id;

  return jsonb_build_object(
    'id', v_target.id,
    'name', v_target.name,
    'avatar_path', v_target.avatar_path,
    'member_since', v_target.created_at,
    'is_me', v_target.id = v_profile.id,
    'monthly_rank_position', v_monthly.rank_position,
    'monthly_score', coalesce(v_monthly.score, 0),
    'monthly_areas', private.score_areas(p_user_id, v_month_start, v_month_end),
    'weekly_rank_position', v_weekly.rank_position,
    'weekly_score', coalesce(v_weekly.score, 0),
    -- Total de sempre (só para informação; o ranking é por mês).
    'votes_received', (
      select count(*) from private.eligible_suggestions s
      join public.votes v on v.suggestion_id = s.id and v.user_id <> s.author_id
      where s.author_id = p_user_id
    ),
    'suggestion_count', (select count(*) from private.eligible_suggestions s where s.author_id = p_user_id),
    'medals', private.user_medals(p_user_id)
  );
end;
$$;

-- Pontos de cada sugestão minha no mês atual (antes do peso da área): publicação,
-- votos do mês pela média ajustada e bônus de seleção do mês.
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
  v_start timestamptz;
  v_end timestamptz;
begin
  perform private.check_page(p_limit, p_offset);
  perform private.check_suggestion_status_filter(p_status);
  select m.month_start, m.month_end into v_start, v_end from private.ranking_month(0) m;

  return query
  with month_points as (
    select sp.suggestion_id, sp.points
    from private.suggestion_points_between(v_start, v_end) sp
    where sp.user_id = v_profile.id
  )
  select s.id, s.project_id, p.name, s.title, s.status, s.created_at,
         vc.n::bigint,
         coalesce(mp.points, 0)::numeric(12, 2),
         count(*) over ()::bigint
  from private.eligible_suggestions s
  join public.projects p on p.id = s.project_id
  cross join lateral (
    select count(*) as n from public.votes v
    where v.suggestion_id = s.id and v.user_id <> s.author_id
  ) vc
  left join month_points mp on mp.suggestion_id = s.id
  where s.author_id = v_profile.id
    and (p_status is null or s.status = p_status)
  order by s.created_at desc, s.id
  limit p_limit offset p_offset;
end;
$$;

-- -----------------------------------------------------------------------------
-- Mover sugestão de projeto (administração)
-- -----------------------------------------------------------------------------

do $$
declare
  v_name text;
begin
  for v_name in
    select conname from pg_constraint
    where conrelid = 'public.notifications'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%kind%'
  loop
    execute format('alter table public.notifications drop constraint %I', v_name);
  end loop;
end;
$$;

alter table public.notifications add constraint notifications_kind_check
  check (kind in ('vote', 'comment', 'status', 'podium', 'champion', 'moved'));

create or replace function public.move_suggestion(p_id uuid, p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles := private.require_admin();
  v_suggestion public.suggestions := private.lock_visible_suggestion(p_id);
  v_from public.projects;
  v_to public.projects;
begin
  select * into v_to from public.projects where id = p_project_id and deleted_at is null;
  if not found then
    raise exception 'Projeto não encontrado.' using errcode = 'HV404';
  end if;
  if v_to.id = v_suggestion.project_id then
    return;
  end if;
  if v_to.status = 'arquivado' then
    raise exception 'Este projeto está arquivado e não recebe novas sugestões.' using errcode = 'HV409';
  end if;
  select * into v_from from public.projects where id = v_suggestion.project_id;

  update public.suggestions set project_id = v_to.id where id = v_suggestion.id;

  perform private.audit(
    v_profile.id, 'suggestion', v_suggestion.id, 'suggestion.move',
    jsonb_build_object('project_id', v_from.id, 'project', v_from.name, 'area', v_from.category),
    jsonb_build_object('project_id', v_to.id, 'project', v_to.name, 'area', v_to.category)
  );

  if v_suggestion.author_id <> v_profile.id then
    insert into public.notifications (user_id, kind, suggestion_id, actor_id, data)
    values (v_suggestion.author_id, 'moved', v_suggestion.id, v_profile.id,
            jsonb_build_object('previous_project', v_from.name, 'new_project', v_to.name));
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Privilégios
-- -----------------------------------------------------------------------------

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_admin(), private.can_participate() to authenticated;

revoke execute on function
  public.get_ranking(integer, integer),
  public.get_my_score(),
  public.move_suggestion(uuid, uuid)
from public, anon;

grant execute on function
  public.get_ranking(integer, integer),
  public.get_my_score(),
  public.move_suggestion(uuid, uuid)
to authenticated;
