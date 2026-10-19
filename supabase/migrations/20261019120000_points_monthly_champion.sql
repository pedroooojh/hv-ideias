-- =============================================================================
-- Nova pontuação e campeão do mês.
--
-- Pontos (sempre para quem publicou a sugestão):
--   * 0,5 ponto por sugestão publicada, para incentivar novas ideias;
--   * 1 ponto por voto válido recebido (votos do próprio autor nunca contam);
--   * quando a administração seleciona a ideia (status Planejado, Em
--     desenvolvimento ou Implementado), os pontos dela dobram: no momento da
--     seleção o autor recebe de novo o que a sugestão já tinha, e cada voto
--     recebido depois vale 2. Se a ideia voltar para Em análise ou Não
--     aprovado, o dobro sai; se for selecionada outra vez, conta a nova data.
--
-- Cada ponto tem uma data (publicação, voto ou seleção), e é ela que decide em
-- qual semana e em qual mês ele entra. Semanas e meses já fechados não mudam.
--
-- Ranking:
--   * semanal (sábado a sexta) continua com o pódio do top 3 na sexta;
--   * mensal (mês do calendário, horário de Brasília) substitui o ranking geral
--     acumulado: durante o mês mostra a classificação parcial e, no fechamento
--     (dia 1º, 00:05), grava só o campeão — é ele quem é premiado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Seleção pela administração
-- -----------------------------------------------------------------------------

create or replace function private.is_selected_status(p_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_status in ('planejado', 'em_desenvolvimento', 'implementado');
$$;

-- Momento em que a ideia entrou (pela última vez) num status de seleção.
alter table public.suggestions add column selected_at timestamptz;

-- Sugestões já selecionadas: início da sequência atual de status de seleção no
-- histórico (Planejado → Em desenvolvimento continua sendo a mesma seleção).
update public.suggestions s
set selected_at = coalesce(
  (
    select min(h.created_at)
    from public.suggestion_status_history h
    where h.suggestion_id = s.id
      and private.is_selected_status(h.new_status)
      and not exists (
        select 1 from public.suggestion_status_history h2
        where h2.suggestion_id = s.id and h2.created_at > h.created_at
          and not private.is_selected_status(h2.new_status)
      )
  ),
  s.status_changed_at,
  s.created_at
)
where private.is_selected_status(s.status);

-- Mantido pelo banco: nenhuma função precisa lembrar de preencher.
create or replace function private.track_suggestion_selection()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not private.is_selected_status(new.status) then
    new.selected_at := null;
  elsif tg_op = 'INSERT' or not private.is_selected_status(old.status) then
    new.selected_at := now();
  else
    new.selected_at := old.selected_at;
  end if;
  return new;
end;
$$;

create trigger suggestions_track_selection
  before insert or update on public.suggestions
  for each row execute function private.track_suggestion_selection();

-- A view foi criada com "s.*" antes da coluna nova; recriá-la inclui selected_at.
create or replace view private.eligible_suggestions as
select s.*
from public.suggestions s
join public.projects p on p.id = s.project_id
where s.deleted_at is null
  and p.deleted_at is null;

-- -----------------------------------------------------------------------------
-- Pontuação: fonte única da regra
-- -----------------------------------------------------------------------------

create or replace function private.points_per_vote()
returns numeric
language sql
immutable
as $$ select 1::numeric $$;

create or replace function private.points_per_suggestion()
returns numeric
language sql
immutable
as $$ select 0.5::numeric $$;

-- Cada linha é um ganho de pontos com a sua data. O dobro da seleção repete a
-- publicação e cada voto, datados da seleção (ou do voto, se veio depois).
create or replace view private.score_events as
select s.author_id as user_id, s.id as suggestion_id, 'suggestion'::text as kind,
       private.points_per_suggestion() as points, s.created_at as occurred_at
from private.eligible_suggestions s
union all
select s.author_id, s.id, 'vote', private.points_per_vote(), v.created_at
from private.eligible_suggestions s
join public.votes v on v.suggestion_id = s.id and v.user_id <> s.author_id
union all
select s.author_id, s.id, 'selection', private.points_per_suggestion(), s.selected_at
from private.eligible_suggestions s
where s.selected_at is not null
union all
select s.author_id, s.id, 'selection', private.points_per_vote(), greatest(v.created_at, s.selected_at)
from private.eligible_suggestions s
join public.votes v on v.suggestion_id = s.id and v.user_id <> s.author_id
where s.selected_at is not null;

-- Classificação de um período [p_start, p_end) entre usuários ativos com pontos nele.
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
           sum(e.points) as score,
           count(*) filter (where e.kind = 'suggestion') as suggestion_count,
           count(*) filter (where e.kind = 'vote') as votes_received,
           max(e.occurred_at) as last_point_at
    from private.score_events e
    join public.profiles pr on pr.id = e.user_id
    where pr.status = 'active'
      and e.occurred_at >= p_start
      and e.occurred_at < p_end
    group by pr.id, pr.name
  )
  select w.user_id, w.user_name, w.score::numeric(12, 1), w.suggestion_count, w.votes_received,
         row_number() over (order by w.score desc, w.votes_received desc, w.last_point_at asc, w.user_name, w.user_id)
  from w;
$$;

-- Semana: mesma assinatura de antes (usada pelo fechamento e pelo perfil).
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
  select * from private.ranked_scores_between(p_start, p_end);
$$;

-- -----------------------------------------------------------------------------
-- Mês do ranking
-- -----------------------------------------------------------------------------

-- Início e fim (exclusivo) do mês, contando p_months_ago meses para trás.
create or replace function private.ranking_month(p_months_ago integer default 0)
returns table (month_start timestamptz, month_end timestamptz)
language sql
stable
set search_path = ''
as $$
  with m as (
    select date_trunc('month', now() at time zone private.ranking_tz()) - make_interval(months => p_months_ago) as d
  )
  select m.d at time zone private.ranking_tz(),
         (m.d + interval '1 month') at time zone private.ranking_tz()
  from m;
$$;

-- O ranking "geral" passa a ser o do mês atual: get_ranking, get_my_score e o
-- perfil público usam esta função.
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
  select r.*
  from private.ranking_month(0) m
  cross join lateral private.ranked_scores_between(m.month_start, m.month_end) r;
$$;

-- Acumulado de sempre não é mais usado (e seguia a regra antiga).
drop view if exists private.user_scores;

-- Campeão de cada mês encerrado. Sem pódio: só o 1º lugar é gravado.
create table public.monthly_results (
  month_start       timestamptz primary key,
  month_end         timestamptz not null,
  user_id           uuid not null references public.profiles (id) on delete cascade,
  -- Nome na data do fechamento (o perfil pode mudar de nome depois).
  user_name         text not null,
  score             numeric(12, 1) not null,
  suggestion_count  integer not null,
  votes_received    integer not null,
  closed_at         timestamptz not null default now()
);

create index monthly_results_user_idx on public.monthly_results (user_id);

alter table public.monthly_results enable row level security;
revoke all on public.monthly_results from anon, authenticated;

-- Grava o campeão de um mês já encerrado. Idempotente: mês já gravado não muda.
create or replace function private.close_ranking_month(p_months_ago integer default 1)
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
  if p_months_ago is null or p_months_ago < 1 then
    raise exception 'Só é possível fechar meses já encerrados.' using errcode = 'HV422';
  end if;
  select m.month_start, m.month_end into v_start, v_end from private.ranking_month(p_months_ago) m;
  if exists (select 1 from public.monthly_results r where r.month_start = v_start) then
    return 0;
  end if;

  insert into public.monthly_results
    (month_start, month_end, user_id, user_name, score, suggestion_count, votes_received)
  select v_start, v_end, s.user_id, s.user_name, s.score, s.suggestion_count, s.votes_received
  from private.ranked_scores_between(v_start, v_end) s
  where s.rank_position = 1;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Medalhas semanais (1º, 2º e 3º) e títulos de campeão do mês.
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
    'bronze', count(*) filter (where r.rank_position = 3),
    'champion', (select count(*) from public.monthly_results m where m.user_id = p_user_id)
  )
  from public.weekly_results r
  where r.user_id = p_user_id;
$$;

-- -----------------------------------------------------------------------------
-- Notificação do campeão
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
  check (kind in ('vote', 'comment', 'status', 'podium', 'champion'));

create or replace function private.on_monthly_result_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (user_id, kind, data)
  values (new.user_id, 'champion', jsonb_build_object(
    'score', new.score, 'month_start', new.month_start, 'month_end', new.month_end));
  return new;
end;
$$;

create trigger monthly_results_notify
  after insert on public.monthly_results
  for each row execute function private.on_monthly_result_notify();

-- -----------------------------------------------------------------------------
-- API
-- -----------------------------------------------------------------------------

-- Mês atual (p_months_ago = 0): classificação parcial. Meses encerrados: só o
-- campeão, do fechamento gravado (is_final) ou calculado se ainda não gravado.
create or replace function public.get_monthly_ranking(p_months_ago integer default 0, p_limit integer default 10)
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
  v_today date := (now() at time zone private.ranking_tz())::date;
  v_final boolean;
  v_entries jsonb := '[]'::jsonb;
  v_total bigint;
  v_champion jsonb;
  v_me jsonb;
begin
  if p_months_ago is null or p_months_ago < 0 or p_months_ago > 24 then
    raise exception 'Mês inválido (0 a 24 meses atrás).' using errcode = 'HV422';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'Tamanho de página inválido (1 a 50).' using errcode = 'HV422';
  end if;

  select m.month_start, m.month_end into v_start, v_end from private.ranking_month(p_months_ago) m;
  v_final := p_months_ago > 0 and exists (select 1 from public.monthly_results r where r.month_start = v_start);

  if v_final then
    select jsonb_build_object(
             'user_id', r.user_id, 'user_name', r.user_name, 'user_avatar', pr.avatar_path,
             'score', r.score, 'suggestion_count', r.suggestion_count, 'votes_received', r.votes_received,
             'is_me', r.user_id = v_profile.id)
      into v_champion
    from public.monthly_results r
    join public.profiles pr on pr.id = r.user_id
    where r.month_start = v_start;
  end if;

  with r as (select * from private.ranked_scores_between(v_start, v_end))
  select
    case when p_months_ago = 0 then coalesce((
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
    ), '[]'::jsonb) else '[]'::jsonb end,
    (select count(*) from r),
    case when p_months_ago > 0 and not v_final then (
      select jsonb_build_object(
               'user_id', t.user_id, 'user_name', t.user_name, 'user_avatar', pr.avatar_path,
               'score', t.score, 'suggestion_count', t.suggestion_count, 'votes_received', t.votes_received,
               'is_me', t.user_id = v_profile.id)
      from r t join public.profiles pr on pr.id = t.user_id
      where t.rank_position = 1
    ) else v_champion end,
    (select jsonb_build_object('rank_position', m.rank_position, 'score', m.score, 'votes_received', m.votes_received)
       from r m where m.user_id = v_profile.id)
  into v_entries, v_total, v_champion, v_me;

  return jsonb_build_object(
    'month_start', v_start,
    'month_end', v_end,
    -- Último dia do mês: dia do fechamento do mês atual.
    'is_closing_day', p_months_ago = 0 and extract(day from v_today + 1) = 1,
    'is_final', v_final,
    'total_count', v_total,
    'entries', v_entries,
    'champion', v_champion,
    'me', coalesce(v_me, jsonb_build_object('rank_position', null, 'score', 0, 'votes_received', 0))
  );
end;
$$;

-- Galeria de campeões (meses encerrados e gravados), do mais recente ao mais antigo.
create or replace function public.list_monthly_champions(p_limit integer default 12)
returns table (
  month_start timestamptz,
  month_end timestamptz,
  user_id uuid,
  user_name text,
  user_avatar text,
  score numeric,
  votes_received integer,
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
begin
  if p_limit is null or p_limit < 1 or p_limit > 36 then
    raise exception 'Tamanho de página inválido (1 a 36).' using errcode = 'HV422';
  end if;

  return query
  select r.month_start, r.month_end, r.user_id, r.user_name, pr.avatar_path, r.score, r.votes_received,
         r.user_id = v_profile.id
  from public.monthly_results r
  join public.profiles pr on pr.id = r.user_id
  order by r.month_start desc
  limit p_limit;
end;
$$;

-- Perfil público: os números do ranking passam a ser do mês e da semana.
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
  v_start timestamptz;
  v_end timestamptz;
begin
  select * into v_target from public.profiles where id = p_user_id;
  -- Contas desativadas não têm perfil público (como no ranking).
  if not found or v_target.status <> 'active' then
    raise exception 'Perfil não encontrado.' using errcode = 'HV404';
  end if;

  select r.rank_position, r.score into v_monthly
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
    'monthly_rank_position', v_monthly.rank_position,
    'monthly_score', coalesce(v_monthly.score, 0),
    'weekly_rank_position', v_weekly.rank_position,
    'weekly_score', coalesce(v_weekly.score, 0),
    -- Total de sempre (só para informação; o ranking é por mês).
    'votes_received', (select count(*) from private.score_events e where e.user_id = p_user_id and e.kind = 'vote'),
    'suggestion_count', (select count(*) from private.eligible_suggestions s where s.author_id = p_user_id),
    'medals', private.user_medals(p_user_id)
  );
end;
$$;

-- Pontos de cada sugestão minha, com a regra nova (inclui o dobro da seleção).
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
         ((private.points_per_suggestion() + vc.n * private.points_per_vote())
           * case when s.selected_at is not null then 2 else 1 end)::numeric(12, 1),
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
-- Privacidade: o campeão do mês também entra na exportação e na anonimização
-- -----------------------------------------------------------------------------

create or replace function private.erase_account(p_user_id uuid, p_comment_reason text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_avatar text;
begin
  select avatar_path into v_avatar from public.profiles where id = p_user_id;

  delete from public.votes where user_id = p_user_id;
  delete from public.notifications where user_id = p_user_id;
  update public.comments
  set deleted_at = now(), deleted_by = p_user_id, deletion_reason = p_comment_reason
  where author_id = p_user_id and deleted_at is null;
  update public.weekly_results set user_name = 'Participante removido' where user_id = p_user_id;
  update public.monthly_results set user_name = 'Participante removido' where user_id = p_user_id;
  update public.profiles
  set name = 'Participante removido', avatar_path = null, role = 'user', status = 'disabled', deleted_at = now()
  where id = p_user_id;
  -- Apaga o login (e-mail, senha e sessões). O perfil anonimizado permanece.
  delete from auth.users where id = p_user_id;
  return v_avatar;
end;
$$;

create or replace function public.export_my_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid := auth.uid();
  v_profile public.profiles;
begin
  if v_id is null then
    raise exception 'Faça login para continuar.' using errcode = 'HV401';
  end if;
  select * into v_profile from public.profiles where id = v_id;
  if not found then
    raise exception 'Perfil não encontrado.' using errcode = 'HV404';
  end if;

  return jsonb_build_object(
    'exported_at', now(),
    'profile', jsonb_build_object(
      'id', v_profile.id,
      'name', v_profile.name,
      'email', (select u.email from auth.users u where u.id = v_id),
      'role', v_profile.role,
      'status', v_profile.status,
      'created_at', v_profile.created_at,
      'avatar_path', v_profile.avatar_path
    ),
    'suggestions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'project', p.name, 'type', s.type, 'title', s.title, 'description', s.description,
        'status', s.status, 'created_at', s.created_at, 'deleted_at', s.deleted_at,
        'votes_received', (select count(*) from public.votes v where v.suggestion_id = s.id)
      ) order by s.created_at)
      from public.suggestions s join public.projects p on p.id = s.project_id
      where s.author_id = v_id
    ), '[]'::jsonb),
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'suggestion', s.title, 'content', c.content,
        'created_at', c.created_at, 'edited_at', c.edited_at, 'deleted_at', c.deleted_at
      ) order by c.created_at)
      from public.comments c join public.suggestions s on s.id = c.suggestion_id
      where c.author_id = v_id
    ), '[]'::jsonb),
    'votes_given', coalesce((
      select jsonb_agg(jsonb_build_object('suggestion', s.title, 'created_at', v.created_at) order by v.created_at)
      from public.votes v join public.suggestions s on s.id = v.suggestion_id
      where v.user_id = v_id
    ), '[]'::jsonb),
    'weekly_podiums', coalesce((
      select jsonb_agg(jsonb_build_object('week_start', r.week_start, 'rank_position', r.rank_position, 'score', r.score)
                       order by r.week_start)
      from public.weekly_results r where r.user_id = v_id
    ), '[]'::jsonb),
    'monthly_titles', coalesce((
      select jsonb_agg(jsonb_build_object('month_start', r.month_start, 'score', r.score) order by r.month_start)
      from public.monthly_results r where r.user_id = v_id
    ), '[]'::jsonb),
    'notifications', coalesce((
      select jsonb_agg(jsonb_build_object('kind', n.kind, 'created_at', n.created_at, 'read_at', n.read_at) order by n.created_at)
      from public.notifications n where n.user_id = v_id
    ), '[]'::jsonb)
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
    -- Dia 1º 03:05 UTC = dia 1º 00:05 em Brasília: fecha o mês que terminou.
    perform cron.schedule('hv-fechamento-ranking-mensal', '5 3 1 * *', 'select private.close_ranking_month(1)');
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Privilégios
-- -----------------------------------------------------------------------------

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_admin(), private.can_participate() to authenticated;

revoke execute on function
  public.get_monthly_ranking(integer, integer),
  public.list_monthly_champions(integer)
from public, anon;

grant execute on function
  public.get_monthly_ranking(integer, integer),
  public.list_monthly_champions(integer)
to authenticated;
