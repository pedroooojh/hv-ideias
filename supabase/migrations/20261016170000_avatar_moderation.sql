-- =============================================================================
-- Moderação de fotos de perfil: o administrador remove a foto de qualquer
-- pessoa (fica registrado na auditoria) e apaga o arquivo do Storage.
-- =============================================================================

create policy "Avatares: administrador vê para moderação"
  on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (select private.is_admin()));

create policy "Avatares: administrador apaga para moderação"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (select private.is_admin()));

-- Remove a foto do perfil e devolve o caminho antigo, para o cliente apagar o arquivo.
create or replace function public.admin_remove_avatar(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles := private.require_admin();
  v_target public.profiles;
begin
  select * into v_target from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'Usuário não encontrado.' using errcode = 'HV404';
  end if;
  if v_target.avatar_path is null then
    return null;
  end if;

  update public.profiles set avatar_path = null where id = p_user_id;
  perform private.audit(
    v_profile.id, 'user', p_user_id, 'user.avatar_remove',
    jsonb_build_object('avatar_path', v_target.avatar_path), null
  );
  return v_target.avatar_path;
end;
$$;

drop function if exists public.admin_list_users(text, integer, integer, text, text);

create or replace function public.admin_list_users(
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0,
  p_role text default null,
  p_status text default null
)
returns table (
  id uuid,
  name text,
  email text,
  role text,
  status text,
  created_at timestamptz,
  suggestion_count bigint,
  avatar_path text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_search text := private.clean_search(p_search);
begin
  perform private.require_admin();
  perform private.check_page(p_limit, p_offset, 100);
  if p_role is not null and p_role not in ('user', 'admin') then
    raise exception 'Perfil inválido.' using errcode = 'HV422';
  end if;
  if p_status is not null and p_status not in ('active', 'disabled') then
    raise exception 'Situação de conta inválida.' using errcode = 'HV422';
  end if;

  return query
  select p.id, p.name, u.email::text, p.role, p.status, p.created_at,
         (select count(*) from public.suggestions s where s.author_id = p.id and s.deleted_at is null)::bigint,
         p.avatar_path,
         count(*) over ()::bigint
  from public.profiles p
  join auth.users u on u.id = p.id
  where (private.text_matches(p.name, v_search) or private.text_matches(u.email::text, v_search))
    and (p_role is null or p.role = p_role)
    and (p_status is null or p.status = p_status)
  order by p.created_at desc, p.id
  limit p_limit offset p_offset;
end;
$$;

revoke execute on function
  public.admin_remove_avatar(uuid),
  public.admin_list_users(text, integer, integer, text, text)
from public, anon;

grant execute on function
  public.admin_remove_avatar(uuid),
  public.admin_list_users(text, integer, integer, text, text)
to authenticated;
