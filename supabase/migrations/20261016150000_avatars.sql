-- =============================================================================
-- Foto de perfil.
--
-- A imagem fica no Supabase Storage (bucket público "avatars"), na pasta do
-- próprio usuário: <id do usuário>/<arquivo>. O perfil guarda só o caminho, e
-- as funções que mostram autores (sugestões, comentários e rankings) passam a
-- devolvê-lo para a interface montar a URL pública. O cliente envia a foto já
-- recortada e reduzida; o bucket limita tamanho e tipos aceitos.
-- =============================================================================

alter table public.profiles
  add column avatar_path text
  constraint profiles_avatar_path_format
  check (avatar_path is null or avatar_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]{1,64}\.(webp|jpg|png)$');

-- Conta autenticada e ativa (usada nas políticas do Storage, que rodam como o usuário).
create or replace function private.can_participate()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'active'
  );
$$;

-- -----------------------------------------------------------------------------
-- Storage
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 524288, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Leitura pública pela URL do bucket; enviar, ver a listagem e apagar só na própria pasta.
create policy "Avatares: dono vê os próprios arquivos"
  on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Avatares: conta ativa envia na própria pasta"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select private.can_participate())
  );

create policy "Avatares: dono apaga os próprios arquivos"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- -----------------------------------------------------------------------------
-- Perfil
-- -----------------------------------------------------------------------------

drop function if exists public.get_my_profile();

create or replace function public.get_my_profile()
returns table (id uuid, name text, role text, status text, created_at timestamptz, avatar_path text)
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
  select p.id, p.name, p.role, p.status, p.created_at, p.avatar_path
  from public.profiles p
  where p.id = auth.uid();
end;
$$;

-- Define (ou remove, com null) a foto. O arquivo precisa estar na pasta do próprio usuário.
create or replace function public.set_my_avatar(p_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles := private.current_profile();
begin
  if p_path is not null
     and (split_part(p_path, '/', 1) <> v_profile.id::text
          or p_path !~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]{1,64}\.(webp|jpg|png)$') then
    raise exception 'Arquivo de foto inválido.' using errcode = 'HV422';
  end if;
  update public.profiles set avatar_path = p_path where id = v_profile.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Autores com foto: sugestões, comentários e ranking
-- -----------------------------------------------------------------------------

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
         a.name, a.avatar_path, b.author_id = v_profile.id, b.created_at, b.updated_at,
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
         s.status, s.status_reason, s.status_changed_at, a.name, a.avatar_path, s.author_id = v_profile.id,
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
  select r.rank_position, r.user_name, pr.avatar_path, r.score, r.suggestion_count, r.votes_received,
         r.user_id = v_profile.id, count(*) over ()::bigint
  from private.ranked_scores() r
  join public.profiles pr on pr.id = r.user_id
  order by r.rank_position
  limit p_limit offset p_offset;
end;
$$;

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
               'user_avatar', pr.avatar_path,
               'score', t.score,
               'suggestion_count', t.suggestion_count,
               'votes_received', t.votes_received,
               'is_me', t.user_id = v_profile.id
             ) order by t.rank_position)
      from (select * from r where r.rank_position <= p_limit) t
      join public.profiles pr on pr.id = t.user_id
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
grant execute on function private.is_admin(), private.can_participate() to authenticated;

revoke execute on function
  public.get_my_profile(),
  public.set_my_avatar(text),
  public.list_suggestions(uuid, text, text, integer, integer, text, text),
  public.get_suggestion(uuid),
  public.list_comments(uuid, integer, integer),
  public.get_ranking(integer, integer)
from public, anon;

grant execute on function
  public.get_my_profile(),
  public.set_my_avatar(text),
  public.list_suggestions(uuid, text, text, integer, integer, text, text),
  public.get_suggestion(uuid),
  public.list_comments(uuid, integer, integer),
  public.get_ranking(integer, integer)
to authenticated;
