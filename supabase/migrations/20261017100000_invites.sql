-- =============================================================================
-- Convites pela Gestão da plataforma.
--
-- O envio do convite precisa da chave de administrador do Supabase, então
-- acontece na Edge Function `admin-invite` (supabase/functions). Ela usa estas
-- funções com o token de quem pediu, para que a regra fique no banco:
--   1. admin_prepare_invite: só administrador ativo, e-mail válido, sem conta
--      ativa com o mesmo e-mail (convite pendente pode ser reenviado) e limite
--      de convites por hora;
--   2. admin_record_invite: registra o convite enviado na auditoria.
-- =============================================================================

create or replace function public.admin_prepare_invite(p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles := private.require_admin();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_user auth.users;
begin
  if char_length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Informe um e-mail válido.' using errcode = 'HV422';
  end if;

  select * into v_user from auth.users u where lower(u.email) = v_email;
  if found and not (v_user.invited_at is not null and v_user.email_confirmed_at is null) then
    raise exception 'Já existe uma conta com este e-mail.' using errcode = 'HV409';
  end if;

  perform private.rate_limit(v_profile.id, 'invite', 30, interval '1 hour');
  return v_email;
end;
$$;

create or replace function public.admin_record_invite(p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles := private.require_admin();
  v_user auth.users;
begin
  select * into v_user from auth.users u
  where lower(u.email) = lower(btrim(coalesce(p_email, ''))) and u.invited_at is not null;
  if not found then
    raise exception 'Convite não encontrado.' using errcode = 'HV404';
  end if;

  perform private.audit(
    v_profile.id, 'user', v_user.id, 'user.invite', null,
    jsonb_build_object('email', v_user.email, 'name', (select p.name from public.profiles p where p.id = v_user.id))
  );
  return v_user.id;
end;
$$;

-- Lista de contas com a marcação de convite ainda não aceito.
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
  invite_pending boolean,
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
         u.invited_at is not null and u.email_confirmed_at is null,
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

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_admin(), private.can_participate() to authenticated;

revoke execute on function
  public.admin_prepare_invite(text),
  public.admin_record_invite(text),
  public.admin_list_users(text, integer, integer, text, text)
from public, anon;

grant execute on function
  public.admin_prepare_invite(text),
  public.admin_record_invite(text),
  public.admin_list_users(text, integer, integer, text, text)
to authenticated;
