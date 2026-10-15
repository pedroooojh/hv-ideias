import { useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { FolderPlus, Plus } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { api, qk } from '@/lib/api';
import { PROJECT_STATUS, PROJECT_STATUS_ORDER } from '@/lib/domain';
import { usePageTitle } from '@/lib/navigation';
import { ClearFilters, FilterBar, FilterSummary, FilterTabs, SearchField, pick, useUrlFilters } from '@/components/Filters';
import { ProjectCard } from '@/components/ProjectCard';
import { ProjectFormDialog } from '@/components/ProjectFormDialog';
import { EmptyState, ErrorState, LoadMore, PageContainer, Skeleton } from '@/components/ui';

const FILTER_KEYS = ['status', 'busca'] as const;

export function ProjectsPage() {
  usePageTitle('Todos os projetos');
  const { isAdmin } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);

  const filters = useUrlFilters(FILTER_KEYS);
  const status = pick(filters.get('status'), PROJECT_STATUS_ORDER);
  const search = filters.get('busca');
  const filtered = filters.active();

  const query = useInfiniteQuery({
    queryKey: [...qk.projects, 'all', status, search],
    queryFn: ({ pageParam }) => api.listProjects({ status, search }, pageParam, 12),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset,
  });
  const counts = useQuery({ queryKey: [...qk.projects, 'status-counts', search], queryFn: () => api.projectStatusCounts(search) });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const categories = [...new Set(items.map((p) => p.category))];
  const countOf = (s: string) => Number(counts.data?.[s] ?? 0);
  const totalAll = Object.values(counts.data ?? {}).reduce((a, n) => a + Number(n), 0);

  return (
    <PageContainer back={{ to: '/', label: 'Início' }}>
      <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">Todos os projetos</h1>

      <div className="mt-6">
        <FilterBar
          tabs={
            <FilterTabs
              label="Filtrar por status"
              value={status}
              onChange={(v) => filters.set('status', v)}
              options={[
                { value: null, label: 'Todos', count: counts.data ? totalAll : undefined },
                ...PROJECT_STATUS_ORDER.map((s) => ({
                  value: s,
                  label: PROJECT_STATUS[s].label,
                  count: counts.data ? countOf(s) : undefined,
                })),
              ]}
            />
          }
          controls={
            <>
              <SearchField
                label="Buscar projetos"
                placeholder="Buscar projetos"
                value={search}
                onChange={(v) => filters.set('busca', v)}
              />
              {isAdmin && (
                <button type="button" className="btn-primary h-9 px-4 py-0" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-4 w-4" aria-hidden /> Novo projeto
                </button>
              )}
            </>
          }
        />
        <FilterSummary active={filters.active(['busca'])} total={query.data?.pages[0]?.total} onClear={() => filters.clear()} />
      </div>

      <div className="mt-6">
        {query.isPending ? (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-72 rounded-xl" />
            ))}
          </div>
        ) : query.isError && !query.data ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<FolderPlus className="h-6 w-6" />}
            title={filtered ? 'Nenhum projeto com esses filtros' : 'Nenhum projeto cadastrado ainda'}
          >
            {/* Com busca ativa o resumo acima já oferece "Limpar filtros". */}
            <ClearFilters visible={filtered && !filters.active(['busca'])} onClear={() => filters.clear()} />
          </EmptyState>
        ) : (
          <>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {items.map((p) => (
                <ProjectCard key={p.id} project={p} knownCategories={categories} />
              ))}
            </div>
            <LoadMore
              hasMore={query.hasNextPage}
              loading={query.isFetchingNextPage}
              onClick={() => query.fetchNextPage()}
              label="Carregar mais projetos"
            />
          </>
        )}
      </div>
      <ProjectFormDialog open={createOpen} onOpenChange={setCreateOpen} knownCategories={categories} />
    </PageContainer>
  );
}
