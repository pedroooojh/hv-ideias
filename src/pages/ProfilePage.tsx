import { useEffect, useId, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lightbulb, Loader2, LogOut } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { api, qk } from '@/lib/api';
import { LIMITS, SUGGESTION_STATUS, SUGGESTION_STATUS_ORDER, lengthError } from '@/lib/domain';
import { errorMessage } from '@/lib/errors';
import { formatDate, formatNumber, formatPoints } from '@/lib/format';
import { usePageTitle } from '@/lib/navigation';
import { FilterMenu, FilterSummary, pick, useUrlFilters } from '@/components/Filters';
import { Dot } from '@/components/Select';
import { useToast } from '@/components/Toast';
import { EmptyState, ErrorState, LoadMore, PageContainer, Skeleton, SuggestionStatusChip } from '@/components/ui';

const FILTER_KEYS = ['status'] as const;

export function ProfilePage() {
  usePageTitle('Meu perfil');
  const { profile, user, signOut, isAdmin } = useAuth();
  const navigate = useNavigate();
  const filters = useUrlFilters(FILTER_KEYS);
  const status = pick(filters.get('status'), SUGGESTION_STATUS_ORDER);
  const score = useQuery({ queryKey: qk.myScore, queryFn: api.getMyScore });
  const mine = useInfiniteQuery({
    queryKey: [...qk.mySuggestions, status],
    queryFn: ({ pageParam }) => api.listMySuggestions({ status }, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset,
  });
  const items = mine.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <PageContainer narrow back={{ to: '/', label: 'Início' }}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">Meu perfil</h1>
          <p className="mt-1 text-muted">
            {user?.email}
            {isAdmin && <span className="chip ml-2 bg-brand-soft text-brand">Administrador</span>}
          </p>
          {isAdmin && (
            <Link to="/admin" className="mt-2 inline-block text-sm font-semibold text-brand hover:underline">
              Abrir gestão da plataforma
            </Link>
          )}
        </div>
        <button
          type="button"
          className="btn-secondary"
          onClick={async () => {
            // Sai da rota protegida antes de encerrar a sessão, para não cair na tela de login.
            navigate('/', { replace: true });
            await signOut();
          }}
        >
          <LogOut className="h-4 w-4" aria-hidden /> Sair
        </button>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <div className="space-y-6">
          {profile && <NameForm currentName={profile.name} />}
          <section className="card p-6" aria-labelledby="pontuacao-titulo">
            <h2 id="pontuacao-titulo" className="text-lg font-bold text-ink">
              Minha pontuação
            </h2>
            {score.isPending ? (
              <Skeleton className="mt-4 h-20" />
            ) : score.isError && !score.data ? (
              <p className="mt-3 text-sm text-danger">{errorMessage(score.error)}</p>
            ) : (
              <dl className="mt-4 grid animate-fade-in grid-cols-3 gap-3 text-center">
                <div className="rounded-lg bg-brand-soft p-3">
                  <dt className="text-xs text-muted">Pontos</dt>
                  <dd className="font-display text-2xl font-bold text-brand">{formatPoints(score.data.score)}</dd>
                </div>
                <div className="rounded-lg bg-subtle p-3">
                  <dt className="text-xs text-muted">Votos</dt>
                  <dd className="font-display text-2xl font-bold text-ink">{formatNumber(score.data.votes_received)}</dd>
                </div>
                <div className="rounded-lg bg-subtle p-3">
                  <dt className="text-xs text-muted">Posição</dt>
                  <dd className="font-display text-2xl font-bold text-ink">{score.data.rank_position ? `${score.data.rank_position}º` : '—'}</dd>
                </div>
              </dl>
            )}
            <Link to="/ranking" className="mt-4 inline-block text-sm font-semibold text-brand hover:underline">
              Ver ranking completo
            </Link>
          </section>
        </div>

        <section className="card p-6" aria-labelledby="minhas-titulo">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="minhas-titulo" className="text-lg font-bold text-ink">
              Minhas sugestões
            </h2>
            <FilterMenu
              label="Status"
              value={status}
              onChange={(v) => filters.set('status', v)}
              allLabel="Todas"
              options={SUGGESTION_STATUS_ORDER.map((s) => ({ value: s, label: SUGGESTION_STATUS[s].label, marker: <Dot className={SUGGESTION_STATUS[s].dot} /> }))}
            />
          </div>
          <FilterSummary active={Boolean(status)} total={mine.data?.pages[0]?.total} onClear={() => filters.clear()} />
          <div className="mt-4">
            {mine.isPending ? (
              <div className="space-y-3">
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
              </div>
            ) : mine.isError && !mine.data ? (
              <ErrorState error={mine.error} onRetry={() => mine.refetch()} />
            ) : items.length === 0 ? (
              <EmptyState
                icon={<Lightbulb className="h-6 w-6" />}
                title={status ? 'Nenhuma sugestão sua com este status' : 'Você ainda não publicou sugestões'}
              >
                {/* Com status escolhido, o resumo acima já oferece "Limpar filtros". */}
                {status ? null : (
                  <>
                    Abra um <Link to="/projetos" className="font-semibold text-brand hover:underline">projeto</Link> e compartilhe sua ideia.
                  </>
                )}
              </EmptyState>
            ) : (
              <ul className="animate-fade-in divide-y divide-line">
                {items.map((s) => (
                  <li key={s.id} className="flex items-start justify-between gap-4 py-3">
                    <div className="min-w-0">
                      <Link to={`/sugestoes/${s.id}`} className="font-semibold text-ink hover:text-brand">
                        {s.title}
                      </Link>
                      <p className="mt-0.5 text-xs text-muted">{s.project_name}</p>
                      <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                        <span>{formatDate(s.created_at)}</span>
                        <SuggestionStatusChip status={s.status} />
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-bold text-navy">{formatPoints(s.points)} pts</p>
                      <p className="text-xs text-muted">{formatNumber(s.vote_count)} votos</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <LoadMore hasMore={mine.hasNextPage} loading={mine.isFetchingNextPage} onClick={() => mine.fetchNextPage()} />
          </div>
        </section>
      </div>
    </PageContainer>
  );
}

function NameForm({ currentName }: { currentName: string }) {
  const id = useId();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [name, setName] = useState(currentName);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setName(currentName), [currentName]);

  const mutation = useMutation({
    mutationFn: (value: string) => api.updateMyProfile(value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.profile(user?.id) });
      queryClient.invalidateQueries({ queryKey: qk.ranking });
      toast.success('Nome atualizado.');
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const problem = lengthError(name, 'Nome', LIMITS.profileName);
    setError(problem);
    if (!problem) mutation.mutate(name.trim());
  };

  return (
    <form onSubmit={submit} noValidate className="card p-6">
      <label htmlFor={`${id}-name`} className="field-label">
        Nome exibido
      </label>
      <p className="mb-3 text-xs text-muted">Aparece nas suas sugestões, comentários e no ranking. Seu e-mail nunca é exibido.</p>
      <div className="flex gap-2">
        <input
          id={`${id}-name`}
          className="field-input"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-name-error` : undefined}
          autoComplete="name"
        />
        <button type="submit" className="btn-primary" disabled={mutation.isPending || name.trim() === currentName}>
          {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Salvar
        </button>
      </div>
      {error && (
        <p id={`${id}-name-error`} className="field-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
