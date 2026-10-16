-- =============================================================================
-- Notificações dentro do app.
--
-- Quem publica uma ideia fica sabendo quando ela recebe votos ou comentários e
-- quando o status muda; quem entra no pódio da semana também é avisado. Votos e
-- comentários se agrupam: enquanto a notificação não é lida, novos eventos na
-- mesma sugestão só aumentam a contagem ("3 novos votos"), sem lotar a lista.
-- As notificações nascem de triggers, então nenhuma função esquece de avisar.
-- =============================================================================

create table public.notifications (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  kind           text not null check (kind in ('vote', 'comment', 'status', 'podium')),
  suggestion_id  uuid references public.suggestions (id) on delete cascade,
  -- Último a agir (votou, comentou, mudou o status).
  actor_id       uuid references public.profiles (id) on delete set null,
  event_count    integer not null default 1 check (event_count > 0),
  data           jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  read_at        timestamptz
);

create index notifications_user_idx on public.notifications (user_id, updated_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;

-- Soma um evento à notificação não lida da mesma sugestão, ou cria uma nova.
create or replace function private.notify_grouped(p_user_id uuid, p_kind text, p_suggestion_id uuid, p_actor_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_user_id = p_actor_id then
    return;
  end if;
  -- A mesma pessoa repetindo (tirar e repor o voto) não infla a contagem.
  update public.notifications
  set event_count = event_count + case when actor_id = p_actor_id then 0 else 1 end,
      actor_id = p_actor_id, updated_at = now()
  where user_id = p_user_id and kind = p_kind and suggestion_id = p_suggestion_id and read_at is null;
  if not found then
    insert into public.notifications (user_id, kind, suggestion_id, actor_id)
    values (p_user_id, p_kind, p_suggestion_id, p_actor_id);
  end if;
end;
$$;

create or replace function private.on_vote_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.notify_grouped(
    (select s.author_id from public.suggestions s where s.id = new.suggestion_id),
    'vote', new.suggestion_id, new.user_id
  );
  return new;
end;
$$;

create trigger votes_notify
  after insert on public.votes
  for each row execute function private.on_vote_notify();

create or replace function private.on_comment_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.notify_grouped(
    (select s.author_id from public.suggestions s where s.id = new.suggestion_id),
    'comment', new.suggestion_id, new.author_id
  );
  return new;
end;
$$;

create trigger comments_notify
  after insert on public.comments
  for each row execute function private.on_comment_notify();

-- Mudança de status feita por outra pessoa (normalmente a administração).
create or replace function private.on_status_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_author uuid;
begin
  if new.previous_status is null or new.previous_status = new.new_status then
    return new;
  end if;
  select s.author_id into v_author from public.suggestions s where s.id = new.suggestion_id;
  if v_author is null or v_author = new.actor_id then
    return new;
  end if;
  insert into public.notifications (user_id, kind, suggestion_id, actor_id, data)
  values (v_author, 'status', new.suggestion_id, new.actor_id,
          jsonb_build_object('previous_status', new.previous_status, 'new_status', new.new_status, 'reason', new.reason));
  return new;
end;
$$;

create trigger suggestion_status_history_notify
  after insert on public.suggestion_status_history
  for each row execute function private.on_status_notify();

-- Pódio gravado no fechamento semanal.
create or replace function private.on_weekly_result_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.rank_position <= 3 then
    insert into public.notifications (user_id, kind, data)
    values (new.user_id, 'podium', jsonb_build_object(
      'rank_position', new.rank_position, 'score', new.score,
      'week_start', new.week_start, 'week_end', new.week_end));
  end if;
  return new;
end;
$$;

create trigger weekly_results_notify
  after insert on public.weekly_results
  for each row execute function private.on_weekly_result_notify();

-- -----------------------------------------------------------------------------
-- API
-- -----------------------------------------------------------------------------

create or replace function public.list_my_notifications(p_limit integer default 20, p_offset integer default 0)
returns table (
  id uuid,
  kind text,
  suggestion_id uuid,
  suggestion_title text,
  actor_name text,
  actor_avatar text,
  event_count integer,
  data jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  is_read boolean,
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
  perform private.check_page(p_limit, p_offset, 50);
  return query
  select n.id, n.kind, n.suggestion_id, s.title, a.name, a.avatar_path, n.event_count, n.data,
         n.created_at, n.updated_at, n.read_at is not null, count(*) over ()::bigint
  from public.notifications n
  left join public.suggestions s on s.id = n.suggestion_id
  left join public.profiles a on a.id = n.actor_id
  where n.user_id = v_profile.id
    -- Sugestão excluída depois do aviso: o aviso some junto.
    and (n.suggestion_id is null or s.deleted_at is null)
  order by n.updated_at desc, n.id
  limit p_limit offset p_offset;
end;
$$;

create or replace function public.count_unread_notifications()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles := private.current_profile();
begin
  return (
    select count(*)::integer
    from public.notifications n
    left join public.suggestions s on s.id = n.suggestion_id
    where n.user_id = v_profile.id and n.read_at is null
      and (n.suggestion_id is null or s.deleted_at is null)
  );
end;
$$;

-- Marca como lidas as notificações indicadas, ou todas (p_ids nulo).
create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles := private.current_profile();
begin
  update public.notifications
  set read_at = now()
  where user_id = v_profile.id and read_at is null
    and (p_ids is null or id = any(p_ids));
end;
$$;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_admin(), private.can_participate() to authenticated;

revoke execute on function
  public.list_my_notifications(integer, integer),
  public.count_unread_notifications(),
  public.mark_notifications_read(uuid[])
from public, anon;

grant execute on function
  public.list_my_notifications(integer, integer),
  public.count_unread_notifications(),
  public.mark_notifications_read(uuid[])
to authenticated;
