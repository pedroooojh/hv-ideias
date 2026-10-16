-- =============================================================================
-- Ranking semanal e fechamento de sexta-feira.
--
-- A semana do ranking vai de sábado 00:00 a sexta 23:59 (horário de Brasília):
-- a sexta é o dia do fechamento, quando o app mostra o pódio da semana. Os
-- pontos da semana usam a mesma regra do ranking geral (0,5 ponto por voto
-- válido), mas contam só os votos recebidos dentro da semana. O ranking geral
-- acumulado não muda.
-- =============================================================================

create or replace function private.ranking_tz()
returns text
language sql
immutable
set search_path = ''
as $$
  select 'America/Sao_Paulo'::text;
$$;

-- Início e fim (exclusivo) da semana de ranking, contando p_weeks_ago semanas para trás.
create or replace function private.ranking_week(p_weeks_ago integer default 0)
returns table (week_start timestamptz, week_end timestamptz)
language sql
stable
set search_path = ''
as $$
  with today as (
    select (now() at time zone private.ranking_tz())::date as d
  ), start_day as (
    -- dow: 0 = domingo … 6 = sábado; (dow + 1) % 7 = dias desde o último sábado.
    select (t.d - ((extract(dow from t.d)::integer + 1) % 7) - 7 * p_weeks_ago)::timestamp as d
    from today t
  )
  select s.d at time zone private.ranking_tz(),
         (s.d + interval '7 days') at time zone private.ranking_tz()
  from start_day s;
$$;

-- Pontuação de cada usuário ativo com votos válidos recebidos no intervalo.
-- Desempate: mais votos e, depois, quem chegou primeiro à pontuação (último voto mais antigo).
create or replace function private.weekly_ranked_scores(p_start timestamptz, p_end timestamptz)
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
           count(distinct s.id) as suggestion_count,
           count(v.id) as votes_received,
           max(v.created_at) as last_vote_at
    from public.profiles pr
    join private.eligible_suggestions s on s.author_id = pr.id
    join public.votes v on v.suggestion_id = s.id and v.user_id <> s.author_id
    where pr.status = 'active'
      and v.created_at >= p_start
      and v.created_at < p_end
    group by pr.id, pr.name
  )
  select w.user_id, w.user_name,
         (w.votes_received * private.points_per_vote())::numeric(12, 1),
         w.suggestion_count, w.votes_received,
         row_number() over (order by w.votes_received desc, w.last_vote_at asc, w.user_name, w.user_id)
  from w;
$$;

-- Ranking da semana (p_weeks_ago = 0 é a semana atual; 1, a última fechada).
-- Devolve as primeiras posições e, à parte, a posição de quem chama.
create or replace function public.get_weekly_ranking(p_weeks_ago integer default 0, p_limit integer default 10)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles := private.current_profile();
  v_start timestamptz;
  v_end timestamptz;
  v_entries jsonb;
  v_total bigint;
  v_me jsonb;
begin
  if p_weeks_ago is null or p_weeks_ago < 0 or p_weeks_ago > 52 then
    raise exception 'Semana inválida (0 a 52 semanas atrás).' using errcode = 'HV422';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'Tamanho de página inválido (1 a 50).' using errcode = 'HV422';
  end if;

  select w.week_start, w.week_end into v_start, v_end from private.ranking_week(p_weeks_ago) w;

  with r as (select * from private.weekly_ranked_scores(v_start, v_end))
  select
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'rank_position', t.rank_position,
               'user_name', t.user_name,
               'score', t.score,
               'suggestion_count', t.suggestion_count,
               'votes_received', t.votes_received,
               'is_me', t.user_id = v_profile.id
             ) order by t.rank_position)
      from (select * from r where r.rank_position <= p_limit) t
    ), '[]'::jsonb),
    (select count(*) from r),
    (select jsonb_build_object('rank_position', m.rank_position, 'score', m.score, 'votes_received', m.votes_received)
       from r m where m.user_id = v_profile.id)
  into v_entries, v_total, v_me;

  return jsonb_build_object(
    'week_start', v_start,
    'week_end', v_end,
    'is_closing_day', p_weeks_ago = 0 and extract(dow from now() at time zone private.ranking_tz()) = 5,
    'total_count', v_total,
    'entries', v_entries,
    'me', coalesce(v_me, jsonb_build_object('rank_position', null, 'score', 0, 'votes_received', 0))
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Privilégios
-- -----------------------------------------------------------------------------

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_admin() to authenticated;

revoke execute on function public.get_weekly_ranking(integer, integer) from public, anon;
grant execute on function public.get_weekly_ranking(integer, integer) to authenticated;
