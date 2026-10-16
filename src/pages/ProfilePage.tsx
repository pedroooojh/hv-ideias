import { Link, useNavigate } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ChevronRight, Lightbulb, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { api, qk, type Profile } from '@/lib/api';
import { SUGGESTION_STATUS, SUGGESTION_STATUS_ORDER } from '@/lib/domain';
import { formatDate, formatNumber, formatPoints } from '@/lib/format';
import { usePageTitle } from '@/lib/navigation';
import { FilterMenu, FilterSummary, pick, useUrlFilters } from '@/components/Filters';
import { Dot } from '@/components/Select';
import { ProfileHero } from '@/components/ProfileHero';
import { AccountCard, AvatarButton, useAvatarUpload } from '@/components/ProfileSettings';
import { EmptyState, ErrorState, LoadMore, PageContainer, Skeleton, SuggestionStatusChip } from '@/components/ui';

const FILTER_KEYS = ['status'] as const;

export function ProfilePage() {
  usePageTitle('Meu perfil');
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const upload = useAvatarUpload(profile);

  const leave = async () => {
    // Sai da rota protegida antes de encerrar a sessão, para não cair na tela de login.
    navigate('/', { replace: true });
    await signOut();
  };

  return (
    <PageContainer narrow back={{ to: '/', label: 'Início' }}>
      {upload.input}
      {profile && <MyProfileHero profile={profile} upload={upload} />}

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <MySuggestions />
        {profile && (
          <div className="lg:sticky lg:top-28">
            <AccountCard profile={profile} upload={upload} onSignOut={leave} />
          </div>
        )}
      </div>
    </PageContainer>
  );
}

/** Topo: quem é a pessoa e como ela está indo na comunidade (mesmo topo do perfil público). */
function MyProfileHero({ profile, upload }: { profile: Profile; upload: ReturnType<typeof useAvatarUpload> }) {
  const { user, isAdmin } = useAuth();
  const stats = useQuery({ queryKey: qk.publicProfile(profile.id), queryFn: () => api.getPublicProfile(profile.id) });

  return (
    <ProfileHero
      eyebrow="Meu perfil"
      name={profile.name}
      avatar={<AvatarButton profile={profile} upload={upload} />}
      subtitle={
        <>
          <span className="truncate">{user?.email}</span>
          {isAdmin && (
            <Link to="/admin" className="chip bg-brand-soft text-brand hover:underline">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Administrador · Gestão
            </Link>
          )}
        </>
      }
      data={stats.data}
      action={
        <Link to={`/pessoas/${profile.id}`} className="text-sm font-semibold text-brand hover:underline">
          Ver como os outros me veem
        </Link>
      }
      footer={
        upload.error && (
          <p className="field-error px-6 pb-4 sm:px-8" role="alert">
            {upload.error}
          </p>
        )
      }
    />
  );
}

/** Conteúdo principal: a lista tem altura máxima e rola por dentro; com poucos itens, o cartão encolhe. */
function MySuggestions() {
  const filters = useUrlFilters(FILTER_KEYS);
  const status = pick(filters.get('status'), SUGGESTION_STATUS_ORDER);
  const mine = useInfiniteQuery({
    queryKey: [...qk.mySuggestions, status],
    queryFn: ({ pageParam }) => api.listMySuggestions({ status }, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset,
  });
  const items = mine.data?.pages.flatMap((p) => p.items) ?? [];
  const total = mine.data?.pages[0]?.total;

  return (
    <section className="card flex flex-col p-6" aria-labelledby="minhas-titulo">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="minhas-titulo" className="flex items-center gap-2 text-lg font-bold text-ink">
          Minhas sugestões
          {total !== undefined && !status && <span className="chip bg-subtle py-0.5 text-muted">{formatNumber(total)}</span>}
        </h2>
        <FilterMenu
          label="Status"
          value={status}
          onChange={(v) => filters.set('status', v)}
          allLabel="Todas"
          options={SUGGESTION_STATUS_ORDER.map((s) => ({ value: s, label: SUGGESTION_STATUS[s].label, marker: <Dot className={SUGGESTION_STATUS[s].dot} /> }))}
        />
      </div>
      <FilterSummary active={Boolean(status)} total={total} onClear={() => filters.clear()} />

      <div className="mt-3">
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
          <div className="hv-scroll -mx-6 max-h-[34rem] overflow-y-auto px-6">
            <ul className="animate-fade-in divide-y divide-line">
              {items.map((s) => (
                <li key={s.id}>
                  <Link
                    to={`/sugestoes/${s.id}`}
                    className="group -mx-3 flex items-center justify-between gap-4 rounded-xl px-3 py-3.5 transition-colors duration-200 hover:bg-subtle/70"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-ink group-hover:text-brand">{s.title}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                        <SuggestionStatusChip status={s.status} />
                        <span className="truncate">{s.project_name}</span>
                        <span aria-hidden>·</span>
                        <span>{formatDate(s.created_at)}</span>
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <div className="text-right">
                        <p className="font-display font-bold text-navy">{formatPoints(s.points)} pts</p>
                        <p className="text-xs text-muted">{formatNumber(s.vote_count)} votos</p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <LoadMore hasMore={mine.hasNextPage} loading={mine.isFetchingNextPage} onClick={() => mine.fetchNextPage()} />
          </div>
        )}
      </div>
    </section>
  );
}
