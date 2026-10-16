-- =============================================================================
-- Fechamento semanal gravado.
--
-- Até aqui o "último fechamento" era recalculado na hora: se uma sugestão fosse
-- excluída ou um voto retirado depois, o pódio da semana passada mudava. Agora
-- o top 10 de cada semana é gravado quando ela termina (sábado 00:05, horário de
-- Brasília, via pg_cron) e passa a ser a fonte das semanas encerradas e das
-- medalhas (1º, 2º e 3º lugares).
-- =============================================================================

create table public.weekly_results (
  week_start        timestamptz not null,
  week_end          timestamptz not null,
  rank_position     smallint not null check (rank_position between 1 and 10),
  user_id           uuid not null references public.profiles (id) on delete cascade,
  -- Nome na data do fechamento (o perfil pode mudar de nome depois).
  user_name         text not null,
  score             numeric(12, 1) not null,
  suggestion_count  integer not null,
  votes_received    integer not null,
  closed_at         timestamptz not null default now(),
  primary key (week_start, rank_position)
);

create index weekly_results_user_idx on public.weekly_results (user_id);

alter table public.weekly_results enable row level security;
revoke all on public.weekly_results from anon, authenticated;

-- Grava o top 10 de uma semana já encerrada. Idempotente: semana já gravada não muda.
create or replace function private.close_ranking_week(p_weeks_ago integer default 1)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_count integer;
begin
  if p_weeks_ago is null or p_weeks_ago < 1 then
    raise exception 'Só é possível fechar semanas já encerradas.' using errcode = 'HV422';
  end if;
  select w.week_start, w.week_end into v_start, v_end from private.ranking_week(p_weeks_ago) w;
  if exists (select 1 from public.weekly_results r where r.week_start = v_start) then
    return 0;
  end if;

  insert into public.weekly_results
    (week_start, week_end, rank_position, user_id, user_name, score, suggestion_count, votes_received)
  select v_start, v_end, s.rank_position, s.user_id, s.user_name, s.score, s.suggestion_count, s.votes_received
  from private.weekly_ranked_scores(v_start, v_end) s
  where s.rank_position <= 10;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Medalhas (vezes em 1º, 2º e 3º) de um usuário nos fechamentos gravados.
create or replace function private.user_medals(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'gold', count(*) filter (where r.rank_position = 1),
    'silver', count(*) filter (where r.rank_position = 2),
    'bronze', count(*) filter (where r.rank_position = 3)
  )
  from public.weekly_results r
  where r.user_id = p_user_id;
$$;

-- Semanas encerradas vêm do fechamento gravado (is_final); a atual, e as antigas
-- ainda sem gravação, são calculadas na hora.
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
  v_final boolean;
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
  v_final := p_weeks_ago > 0 and exists (select 1 from public.weekly_results r where r.week_start = v_start);

  if v_final then
    select
      coalesce(jsonb_agg(jsonb_build_object(
        'rank_position', r.rank_position,
        'user_id', r.user_id,
        'user_name', r.user_name,
        'user_avatar', pr.avatar_path,
        'score', r.score,
        'suggestion_count', r.suggestion_count,
        'votes_received', r.votes_received,
        'is_me', r.user_id = v_profile.id
      ) order by r.rank_position) filter (where r.rank_position <= p_limit), '[]'::jsonb),
      count(*)
    into v_entries, v_total
    from public.weekly_results r
    join public.profiles pr on pr.id = r.user_id
    where r.week_start = v_start;
  else
    with r as (select * from private.weekly_ranked_scores(v_start, v_end))
    select
      coalesce((
        select jsonb_agg(jsonb_build_object(
                 'rank_position', t.rank_position,
                 'user_id', t.user_id,
                 'user_name', t.user_name,
                 'user_avatar', pr.avatar_path,
                 'score', t.score,
                 'suggestion_count', t.suggestion_count,
                 'votes_received', t.votes_received,
                 'is_me', t.user_id = v_profile.id
               ) order by t.rank_position)
        from (select * from r where r.rank_position <= p_limit) t
        join public.profiles pr on pr.id = t.user_id
      ), '[]'::jsonb),
      (select count(*) from r)
    into v_entries, v_total;
  end if;

  -- Posição de quem chama: do fechamento gravado quando estiver nele; senão, calculada.
  select jsonb_build_object('rank_position', r.rank_position, 'score', r.score, 'votes_received', r.votes_received)
    into v_me
  from public.weekly_results r
  where v_final and r.week_start = v_start and r.user_id = v_profile.id;
  if v_me is null then
    select jsonb_build_object('rank_position', m.rank_position, 'score', m.score, 'votes_received', m.votes_received)
      into v_me
    from private.weekly_ranked_scores(v_start, v_end) m
    where m.user_id = v_profile.id;
  end if;

  return jsonb_build_object(
    'week_start', v_start,
    'week_end', v_end,
    'is_closing_day', p_weeks_ago = 0 and extract(dow from now() at time zone private.ranking_tz()) = 5,
    'is_final', v_final,
    'total_count', v_total,
    'entries', v_entries,
    'me', coalesce(v_me, jsonb_build_object('rank_position', null, 'score', 0, 'votes_received', 0))
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Agendamento (só onde existe pg_cron: no Supabase; nos testes e no emulador não)
-- -----------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    -- Sábado 03:05 UTC = sábado 00:05 em Brasília: fecha a semana que terminou na sexta.
    perform cron.schedule('hv-fechamento-ranking-semanal', '5 3 * * 6', 'select private.close_ranking_week(1)');
  end if;
end;
$$;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_admin(), private.can_participate() to authenticated;
