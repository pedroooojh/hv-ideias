-- =============================================================================
-- Exclusão de contas pela Gestão da plataforma.
--
-- A regra é a mesma da exclusão feita pela própria pessoa (LGPD): apaga o login,
-- os votos dados, as notificações e a foto; os comentários passam a aparecer
-- como removidos; sugestões continuam, sem nome ("Participante removido"). A
-- lógica comum fica em private.erase_account. Para um convite pendente, isso
-- equivale a cancelar o convite: o link para de valer e a pessoa sai da lista.
-- =============================================================================

-- Anonimiza o perfil e apaga o login. Devolve o caminho da foto antiga para o
-- cliente apagar o arquivo do Storage.
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
  update public.profiles
  set name = 'Participante removido', avatar_path = null, role = 'user', status = 'disabled', deleted_at = now()
  where id = p_user_id;
  -- Apaga o login (e-mail, senha e sessões). O perfil anonimizado permanece.
  delete from auth.users where id = p_user_id;
  return v_avatar;
end;
$$;

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

  perform private.audit(v_id, 'user', v_id, 'user.self_delete', null, null);
  return private.erase_account(v_id, 'author');
end;
$$;

create or replace function public.admin_delete_user(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
  v_target public.profiles;
  v_email text;
  v_pending boolean;
begin
  if p_user_id = v_admin.id then
    raise exception 'Para excluir a sua própria conta, use Meu perfil → Excluir conta.' using errcode = 'HV409';
  end if;
  select * into v_target from public.profiles where id = p_user_id for update;
  select u.email, u.invited_at is not null and u.email_confirmed_at is null
    into v_email, v_pending
  from auth.users u where u.id = p_user_id;
  if v_target.id is null or v_target.deleted_at is not null or v_email is null then
    raise exception 'Usuário não encontrado.' using errcode = 'HV404';
  end if;

  perform private.audit(
    v_admin.id, 'user', p_user_id,
    case when v_pending then 'user.invite_cancel' else 'user.admin_delete' end,
    jsonb_build_object('name', v_target.name, 'email', v_email, 'role', v_target.role),
    null
  );
  return private.erase_account(p_user_id, 'moderation');
end;
$$;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_admin(), private.can_participate() to authenticated;

revoke execute on function public.admin_delete_user(uuid), public.delete_my_account() from public, anon;
grant execute on function public.admin_delete_user(uuid), public.delete_my_account() to authenticated;
