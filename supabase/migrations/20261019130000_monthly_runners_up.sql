-- =============================================================================
-- "Quase lá" do campeão do mês: quem ficou logo atrás do campeão num mês
-- encerrado, para a revelação do campeão mostrar a disputa.
--
-- Só o campeão é gravado no fechamento; os seguintes são calculados com a
-- mesma regra (pontos datados dentro do mês). O campeão gravado nunca aparece
-- na lista, e as posições começam em 2.
-- =============================================================================

create or replace function public.get_monthly_runners_up(p_months_ago integer default 1, p_limit integer default 4)
returns table (
  rank_position bigint,
  user_id uuid,
  user_name text,
  user_avatar text,
  score numeric,
  suggestion_count bigint,
  votes_received bigint,
  is_me boolean
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
  v_champion uuid;
begin
  if p_months_ago is null or p_months_ago < 1 or p_months_ago > 24 then
    raise exception 'Só meses encerrados (1 a 24 meses atrás).' using errcode = 'HV422';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 10 then
    raise exception 'Tamanho de página inválido (1 a 10).' using errcode = 'HV422';
  end if;

  select m.month_start, m.month_end into v_start, v_end from private.ranking_month(p_months_ago) m;
  select r.user_id into v_champion from public.monthly_results r where r.month_start = v_start;

  return query
  with r as (
    select s.*
    from private.ranked_scores_between(v_start, v_end) s
    -- Sem fechamento gravado, o campeão é o 1º calculado.
    where s.user_id is distinct from coalesce(v_champion, (
      select c.user_id from private.ranked_scores_between(v_start, v_end) c where c.rank_position = 1
    ))
  )
  select row_number() over (order by r.rank_position) + 1, r.user_id, r.user_name, pr.avatar_path,
         r.score, r.suggestion_count, r.votes_received, r.user_id = v_profile.id
  from r
  join public.profiles pr on pr.id = r.user_id
  order by r.rank_position
  limit p_limit;
end;
$$;

revoke execute on function public.get_monthly_runners_up(integer, integer) from public, anon;
grant execute on function public.get_monthly_runners_up(integer, integer) to authenticated;
