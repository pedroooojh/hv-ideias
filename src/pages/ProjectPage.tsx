import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Lightbulb, Pencil, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { api, qk } from '@/lib/api';
import { toApiError } from '@/lib/errors';
import { usePageTitle } from '@/lib/navigation';
import { PROJECT_STATUS, SUGGESTION_STATUS, SUGGESTION_STATUS_ORDER, type SortOrder } from '@/lib/domain';
import { plural } from '@/lib/format';
import {
  ClearFilters,
  FilterBar,
  FilterMenu,
  FilterSummary,
  FilterTabs,
  SearchField,
  SortMenu,
  pick,
  useUrlFilters,
} from '@/components/Filters';
import { Dot } from '@/components/Select';
import { DeleteProjectDialog } from '@/components/ProjectCard';
import { ProjectFormDialog } from '@/components/ProjectFormDialog';
import { SuggestionCard } from '@/components/SuggestionCard';
import { SuggestionFormDialog } from '@/components/SuggestionFormDialog';
import { EmptyState, ErrorState, LoadMore, PageContainer, Skeleton } from '@/components/ui';

const FILTER_KEYS = ['tipo', 'status', 'busca', 'ordem'] as const;
const BACK = { to: '/projetos', label: 'Todos os projetos' };

export function ProjectPage() {
  const { projectId = '' } = useParams();
  const { canParticipate, isAdmin } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Filtros e ordenação na URL: sobrevivem a recarregar e a voltar da sugestão.
  const filters = useUrlFilters(FILTER_KEYS);
  const type = filters.get('tipo');
  const status = pick(filters.get('status'), SUGGESTION_STATUS_ORDER);
  const search = filters.get('busca');
  const sort: SortOrder = filters.get('ordem') === 'recentes' ? 'recentes' : 'ranking';
  const filtered = filters.active(['tipo', 'status', 'busca']);

  const project = useQuery({ queryKey: qk.project(projectId), queryFn: () => api.getProject(projectId) });
  const types = useQuery({ queryKey: qk.types, queryFn: api.listSuggestionTypes, staleTime: 10 * 60_000 });
  const suggestions = useInfiniteQuery({
    queryKey: [...qk.suggestions(projectId), type, status, search, sort],
    queryFn: ({ pageParam }) => api.listSuggestions({ projectId, type, status, search, sort, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset,
    enabled: project.isSuccess,
  });
  usePageTitle(project.data?.name ?? 'Projeto');

  if (project.isPending) {
    return (
      <PageContainer narrow back={BACK}>
        <Skeleton className="h-6 w-56" />
        <Skeleton className="mt-8 h-16 w-3/4" />
        <Skeleton className="mt-4 h-24 w-full" />
      </PageContainer>
    );
  }
  // Com dados em cache, só a falha de rede mantém a versão salva; registro excluído ou
  // sem permissão mostra o erro.
  if (project.isError && (!project.data || toApiError(project.error).kind !== 'network')) {
    return (
      <PageContainer narrow back={BACK}>
        <ErrorState error={project.error} onRetry={() => project.refetch()} />
      </PageContainer>
    );
  }

  const p = project.data;
  const archived = p.status === 'arquivado';
  const typeCounts = p.type_counts ?? {};
  const statusCounts = p.status_counts ?? {};
  const items = suggestions.data?.pages.flatMap((pg) => pg.items) ?? [];

  return (
    <PageContainer narrow back={BACK}>
      <header>
        <div className="flex flex-wrap items-center gap-3">
          <span className="chip bg-subtle text-navy">
            <span className="h-1.5 w-1.5 rounded-full bg-teal" aria-hidden />
            {p.category}
          </span>
          <span className="chip bg-subtle font-medium text-teal">
            {plural(p.suggestion_count, 'sugestão ativa', 'sugestões ativas')}
            <span aria-hidden>•</span>
            <span className="font-bold text-navy">{PROJECT_STATUS[p.status].label}</span>
          </span>
          {isAdmin && (
            <span className="ml-auto flex gap-2">
              <button type="button" className="btn-ghost px-3 py-1.5" onClick={() => setEditOpen(true)}>
                <Pencil className="h-4 w-4" aria-hidden /> Editar projeto
              </button>
              <button
                type="button"
                className="btn-ghost px-3 py-1.5 text-danger hover:bg-danger/10 hover:text-danger"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="h-4 w-4" aria-hidden /> Excluir
              </button>
            </span>
          )}
        </div>
        <h1 className="mt-5 text-3xl font-bold leading-[1.08] tracking-[-0.02em] text-ink sm:text-[2.75rem]">{p.name}</h1>
        <p className="mt-5 max-w-4xl whitespace-pre-line text-base leading-relaxed text-muted sm:text-lg">{p.description}</p>
        {archived && (
          <p className="mt-6 rounded-lg border border-line bg-subtle px-4 py-3 text-sm text-muted">
            Este projeto está arquivado: as sugestões continuam visíveis, mas não recebem novas ideias, votos ou comentários.
          </p>
        )}
      </header>

      <div className="mt-10">
        <FilterBar
          tabs={
            <FilterTabs
              label="Filtrar por tipo"
              value={type}
              onChange={(v) => filters.set('tipo', v)}
              options={[
                { value: null, label: 'Todos', count: Number(p.suggestion_count) },
                ...(types.data ?? []).map((t) => ({ value: t.slug, label: t.label, count: Number(typeCounts[t.slug] ?? 0) })),
              ]}
            />
          }
          controls={
            <>
              <SearchField
                label="Buscar sugestões"
                placeholder="Buscar sugestões"
                value={search}
                onChange={(v) => filters.set('busca', v)}
              />
              <FilterMenu
                label="Status"
                value={status}
                onChange={(v) => filters.set('status', v)}
                options={SUGGESTION_STATUS_ORDER.map((s) => ({
                  value: s,
                  label: SUGGESTION_STATUS[s].label,
                  marker: <Dot className={SUGGESTION_STATUS[s].dot} />,
                  count: Number(statusCounts[s] ?? 0),
                }))}
              />
              <SortMenu<SortOrder>
                value={sort}
                onChange={(v) => filters.set('ordem', v === 'ranking' ? null : v)}
                options={[
                  { value: 'ranking', label: 'Mais votadas' },
                  { value: 'recentes', label: 'Mais recentes' },
                ]}
              />
              <button
                type="button"
                className="btn-primary h-9 px-4 py-0"
                onClick={() => setCreateOpen(true)}
                disabled={!canParticipate || archived}
                title={archived ? 'Projeto arquivado' : undefined}
              >
                <Plus className="h-4 w-4" aria-hidden /> Nova sugestão
              </button>
            </>
          }
        />
        <FilterSummary
          active={filters.active(['status', 'busca'])}
          total={suggestions.data?.pages[0]?.total}
          onClear={() => filters.clear(['tipo', 'status', 'busca'])}
        />
      </div>

      <section className="mt-6 space-y-6" aria-label="Sugestões" aria-busy={suggestions.isFetching}>
        {suggestions.isPending ? (
          [0, 1, 2].map((i) => <Skeleton key={i} className="h-56 rounded-xl" />)
        ) : suggestions.isError && !suggestions.data ? (
          <ErrorState error={suggestions.error} onRetry={() => suggestions.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Lightbulb className="h-6 w-6" />}
            title={filtered ? 'Nenhuma sugestão com esses filtros' : 'Nenhuma sugestão ainda'}
          >
            {filtered ? (
              // Com busca/status ativos o resumo acima já oferece "Limpar filtros".
              <ClearFilters visible={!filters.active(['status', 'busca'])} onClear={() => filters.clear(['tipo', 'status', 'busca'])} />
            ) : archived ? (
              'Este projeto está arquivado.'
            ) : (
              'Seja a primeira pessoa a sugerir uma ideia para este projeto.'
            )}
          </EmptyState>
        ) : (
          <>
            {items.map((s) => (
              <SuggestionCard key={s.id} suggestion={s} />
            ))}
            <LoadMore
              hasMore={suggestions.hasNextPage}
              loading={suggestions.isFetchingNextPage}
              onClick={() => suggestions.fetchNextPage()}
              label="Carregar mais sugestões"
            />
          </>
        )}
      </section>

      <SuggestionFormDialog open={createOpen} onOpenChange={setCreateOpen} projectId={p.id} projectName={p.name} />
      {isAdmin && (
        <>
          <ProjectFormDialog
            open={editOpen}
            onOpenChange={setEditOpen}
            editing={{ id: p.id, name: p.name, description: p.description, category: p.category, status: p.status }}
          />
          <DeleteProjectDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            projectId={p.id}
            projectName={p.name}
            suggestionCount={Number(p.suggestion_count)}
            redirectTo="/projetos"
          />
        </>
      )}
    </PageContainer>
  );
}
