-- =============================================================================
-- Privacidade (LGPD): exportar os próprios dados, excluir a própria conta e
-- fotos de perfil visíveis só para quem está logado.
--
-- Excluir a conta apaga o login (e-mail e senha), os votos dados, as
-- notificações e a foto; os comentários viram "removido pelo autor". As
-- sugestões continuam (outras pessoas votaram e comentaram nelas), mas sem
-- nome: o perfil vira "Participante removido" e sai do ranking. Por isso o
-- perfil deixa de ser apagado junto com o login (antes era em cascata).
-- =============================================================================

-- Remove a chave estrangeira profiles → auth.users pelo que estiver no catálogo
-- (o nome gerado pode variar entre ambientes).
do $$
declare
  v_name text;
begin
  for v_name in
    select conname from pg_constraint
    where conrelid = 'public.profiles'::regclass and contype = 'f' and confrelid = 'auth.users'::regclass
  loop
    execute format('alter table public.profiles drop constraint %I', v_name);
  end loop;
end;
$$;

alter table public.profiles add column deleted_at timestamptz;

-- -----------------------------------------------------------------------------
-- Exportar meus dados
-- -----------------------------------------------------------------------------

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
    'notifications', coalesce((
      select jsonb_agg(jsonb_build_object('kind', n.kind, 'created_at', n.created_at, 'read_at', n.read_at) order by n.created_at)
      from public.notifications n where n.user_id = v_id
    ), '[]'::jsonb)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Excluir minha conta
-- -----------------------------------------------------------------------------

-- Devolve o caminho da foto antiga para o cliente apagar o arquivo do Storage.
create or replace function public.delete_my_account()
returns text
language plpgsql
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
  select * into v_profile from public.profiles where id = v_id for update;
  if not found or v_profile.deleted_at is not null then
    raise exception 'Perfil não encontrado.' using errcode = 'HV404';
  end if;
  if v_profile.role = 'admin' and v_profile.status = 'active' and not exists (
    select 1 from public.profiles p where p.role = 'admin' and p.status = 'active' and p.id <> v_id
  ) then
    raise exception 'Você é o único administrador. Promova outra pessoa antes de excluir sua conta.' using errcode = 'HV409';
  end if;

  delete from public.votes where user_id = v_id;
  delete from public.notifications where user_id = v_id;
  update public.comments
  set deleted_at = now(), deleted_by = v_id, deletion_reason = 'author'
  where author_id = v_id and deleted_at is null;
  update public.weekly_results set user_name = 'Participante removido' where user_id = v_id;
  update public.profiles
  set name = 'Participante removido', avatar_path = null, role = 'user', status = 'disabled', deleted_at = now()
  where id = v_id;

  perform private.audit(v_id, 'user', v_id, 'user.self_delete', null, null);
  -- Apaga o login (e-mail, senha e sessões). O perfil anonimizado permanece.
  delete from auth.users where id = v_id;
  return v_profile.avatar_path;
end;
$$;

-- -----------------------------------------------------------------------------
-- Fotos visíveis só para quem está logado
-- -----------------------------------------------------------------------------

-- Sem leitura pública: a interface pede links assinados (temporários), o que
-- exige permissão de leitura no objeto.
update storage.buckets set public = false where id = 'avatars';

drop policy if exists "Avatares: dono vê os próprios arquivos" on storage.objects;
drop policy if exists "Avatares: administrador vê para moderação" on storage.objects;

create policy "Avatares: contas ativas veem as fotos"
  on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (select private.can_participate()));

-- Quem acabou de excluir a conta ainda apaga a própria foto com o token atual.
create policy "Avatares: dono vê os próprios arquivos"
  on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_admin(), private.can_participate() to authenticated;

revoke execute on function public.export_my_data(), public.delete_my_account() from public, anon;
grant execute on function public.export_my_data(), public.delete_my_account() to authenticated;
