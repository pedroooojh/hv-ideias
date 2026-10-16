-- =============================================================================
-- Busca em todos os projetos e sugestões parecidas.
--
-- A busca quebra o texto em palavras (3+ letras) e procura no título e na
-- descrição, sem diferenciar maiúsculas. No modo "todas" a sugestão precisa ter
-- todas as palavras (busca do cabeçalho); no modo "qualquer" basta uma no título
-- (aviso de ideias parecidas ao escrever uma sugestão nova). Resultados com mais
-- palavras no título vêm primeiro, depois os mais votados.
-- =============================================================================

create or replace function private.search_terms(p_search text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(distinct w), '{}')
  from unnest(regexp_split_to_array(lower(coalesce(p_search, '')), '[^[:alnum:]]+')) w
  where char_length(w) >= 3;
$$;

create or replace function public.search_suggestions(
  p_search text,
  p_project_id uuid default null,
  p_match_any boolean default false,
  p_limit integer default 10,
  p_offset integer default 0
)
returns table (
  id uuid,
  project_id uuid,
  project_name text,
  title text,
  status text,
  author_id uuid,
  author_name text,
  author_avatar text,
  vote_count bigint,
  created_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_terms text[] := private.search_terms(private.clean_search(p_search));
begin
  perform private.current_profile();
  perform private.check_page(p_limit, p_offset, 50);
  if cardinality(v_terms) = 0 then
    return;
  end if;

  return query
  with base as (
    select s.*, p.name as project_name, lower(s.title) as t, lower(s.title || ' ' || s.description) as body,
           (select count(*) from public.votes v where v.suggestion_id = s.id) as votes
    from private.eligible_suggestions s
    join public.projects p on p.id = s.project_id
    where p_project_id is null or s.project_id = p_project_id
  ), scored as (
    select b.*,
           (select count(*) from unnest(v_terms) w where position(w in b.t) > 0) as title_hits,
           (select count(*) from unnest(v_terms) w where position(w in b.body) > 0) as body_hits
    from base b
  )
  select x.id, x.project_id, x.project_name, x.title, x.status, x.author_id, a.name, a.avatar_path,
         x.votes::bigint, x.created_at, count(*) over ()::bigint
  from scored x
  join public.profiles a on a.id = x.author_id
  where case when p_match_any then x.title_hits > 0 else x.body_hits = cardinality(v_terms) end
  order by x.title_hits desc, x.votes desc, x.created_at desc, x.id
  limit p_limit offset p_offset;
end;
$$;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_admin(), private.can_participate() to authenticated;

revoke execute on function public.search_suggestions(text, uuid, boolean, integer, integer) from public, anon;
grant execute on function public.search_suggestions(text, uuid, boolean, integer, integer) to authenticated;
