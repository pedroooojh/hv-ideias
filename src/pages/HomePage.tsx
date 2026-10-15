import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BarChart3, Check, ChevronRight, FolderPlus, Lightbulb, Star, ThumbsUp } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { api, qk, type PlatformStats } from '@/lib/api';
import { usePageTitle } from '@/lib/navigation';
import { SUGGESTION_STATUS } from '@/lib/domain';
import { formatNumber, initials, plural } from '@/lib/format';
import { ProjectCard } from '@/components/ProjectCard';
import { ProjectFormDialog } from '@/components/ProjectFormDialog';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui';

export function HomePage() {
  usePageTitle('Início');
  const { isAdmin } = useAuth();
  const stats = useQuery({ queryKey: qk.stats, queryFn: api.getPlatformStats, staleTime: 30_000 });

  return (
    <div className="page-wide">
      <Hero stats={stats.data} loading={stats.isPending} failed={stats.isError} />
      {/* Em telas estreitas o painel fica logo abaixo do hero, para o hero caber em uma tela. */}
      <div className="pb-6 pt-4 lg:hidden">
        <ActivityCard stats={stats.data} loading={stats.isPending} failed={stats.isError} />
      </div>
      {/* Administrador: cartões de gestão. Usuário comum: só hero e projetos (como no design). */}
      {isAdmin && <AdminCards stats={stats.data} />}
      <ProjectsSection />
    </div>
  );
}

function Hero({ stats, loading, failed }: { stats?: PlatformStats; loading: boolean; failed: boolean }) {
  return (
    <section className="hero-viewport grid content-center items-center gap-12 py-10 lg:grid-cols-[1.05fr_1fr] lg:gap-10 [&>*]:min-w-0">
      <div>
        <h1 className="hero-title text-[44px] font-extrabold leading-[0.98] tracking-[-0.03em] text-ink min-[400px]:text-[52px] sm:text-6xl lg:text-[4.5rem]">
          Ideias boas merecem <span className="text-navy">ser ouvidas</span>
        </h1>
        <p className="hero-gap hero-text mt-7 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
          Explore os projetos da Hubvision, sugira melhorias e novas funcionalidades, relate problemas e vote nas ideias
          que você gostaria de ver realizadas.{' '}
          Cada voto que suas ideias recebem vale pontos no ranking.
        </p>
        <div className="hero-gap mt-10 max-w-xl border-t border-line pt-8">
          {loading ? (
            <Skeleton className="h-10 w-80" />
          ) : failed || !stats ? (
            <p className="text-sm text-muted">Indicadores indisponíveis no momento.</p>
          ) : (
            <div className="flex animate-fade-in flex-wrap items-center gap-4">
              <div className="flex -space-x-2.5" aria-hidden>
                {(stats.top_projects.length > 0 ? stats.top_projects : [{ id: 'hv', name: 'Hubvision' }]).map((p, i) => (
                  <span
                    key={p.id}
                    className={`inline-flex h-10 w-10 items-center justify-center rounded-full border-2 border-page text-xs font-bold text-white ${
                      ['bg-navy', 'bg-brand', 'bg-teal'][i % 3]
                    }`}
                  >
                    {initials(p.name)}
                  </span>
                ))}
              </div>
              <p className="text-[0.9375rem] text-muted">
                <strong className="font-bold text-ink">{plural(stats.active_projects, 'projeto ativo', 'projetos ativos')}</strong>
                {' • '}
                {plural(stats.total_suggestions, 'sugestão', 'sugestões')}
                {' • '}
                {plural(stats.total_votes, 'voto computado', 'votos computados')}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="hidden lg:block">
        <ActivityCard stats={stats} loading={loading} failed={failed} />
      </div>
    </section>
  );
}

/**
 * Deriva aleatória de um painel: sorteia, uma vez por montagem, período, amplitude e
 * defasagem das ondas em X e Y (cada painel recebe valores próprios). Sem suporte a
 * @property no navegador, o painel fica parado em vez de pular.
 */
function useDrift(): { className: string; style: CSSProperties } {
  return useMemo(() => {
    const supported = typeof CSS !== 'undefined' && 'registerProperty' in CSS;
    if (!supported) return { className: '', style: {} };
    const r = (min: number, max: number) => min + Math.random() * (max - min);
    const dy = r(4.2, 7.2);
    // Período em X bem diferente do de Y, para o trajeto não virar um vai e vem.
    const dx = dy * r(1.35, 1.85);
    return {
      className: 'hv-drift',
      style: {
        '--hv-ax': `${r(4, 9).toFixed(1)}px`,
        '--hv-ay': `${r(5, 10).toFixed(1)}px`,
        '--hv-dx': `${dx.toFixed(2)}s`,
        '--hv-dy': `${dy.toFixed(2)}s`,
        '--hv-ox': `-${r(0, dx).toFixed(2)}s`,
        '--hv-oy': `-${r(0, dy).toFixed(2)}s`,
      } as CSSProperties,
    };
  }, []);
}

const BAR_COLORS = ['bg-navy', 'bg-teal', 'bg-brand'];
const SHARE_COLORS = ['text-navy', 'text-teal', 'text-brand'];

function ActivityCard({ stats, loading, failed }: { stats?: PlatformStats; loading: boolean; failed: boolean }) {
  const cardDrift = useDrift();
  const badgeDrift = useDrift();
  const highlightDrift = useDrift();
  return (
    <div className="relative mx-auto w-full max-w-[34rem]">
      <div className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full bg-brand/25 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -bottom-20 -left-16 h-72 w-72 rounded-full bg-teal/20 blur-3xl" aria-hidden />

      {stats && (
        <div style={badgeDrift.style} className={`${badgeDrift.className} absolute -top-5 right-2 z-10 inline-flex max-w-[90%] items-center gap-2 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-ink shadow-float sm:-right-5`}>
          <Star className="h-4 w-4 fill-warning text-warning" aria-hidden />
          {Number(stats.votes_last_24h) > 0
            ? `+${formatNumber(stats.votes_last_24h)} ${Number(stats.votes_last_24h) === 1 ? 'novo voto' : 'novos votos'} hoje`
            : 'Nenhum voto novo hoje'}
        </div>
      )}

      <div style={cardDrift.style} className={`${cardDrift.className} card relative p-6 sm:p-8`}>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-5">
          <div className="flex min-w-0 items-center gap-4">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-soft text-brand">
              <BarChart3 className="h-6 w-6" aria-hidden />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Métricas em tempo real</p>
              <h2 className="text-lg font-bold text-ink">Atividade da Comunidade</h2>
            </div>
          </div>
          {stats && (
            <span
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-success/10 px-3 py-1 text-xs font-bold text-success"
              title="Votos válidos registrados nos últimos 7 dias"
            >
              {formatNumber(stats.votes_last_7d)} em 7 dias
            </span>
          )}
        </div>

        <div className="space-y-5 py-6">
          {loading ? (
            [0, 1, 2].map((i) => <Skeleton key={i} className="h-9" />)
          ) : failed || !stats ? (
            <p className="text-sm text-muted">Não foi possível carregar a atividade agora.</p>
          ) : stats.top_projects.length === 0 ? (
            <p className="text-sm text-muted">Ainda não há votos registrados. Os projetos mais apoiados aparecerão aqui.</p>
          ) : (
            stats.top_projects.map((p, i) => (
              <Link key={p.id} to={`/projetos/${p.id}`} className="group block animate-fade-in rounded-lg">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate font-medium text-ink group-hover:text-brand">{p.name}</span>
                  <span className={`shrink-0 font-semibold ${SHARE_COLORS[i]}`}>{p.share}% dos votos</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-subtle" role="presentation">
                  <div className={`h-full rounded-full ${BAR_COLORS[i]}`} style={{ width: `${Math.max(Number(p.share), 3)}%` }} />
                </div>
              </Link>
            ))
          )}
        </div>

        <div className="border-t border-line pt-5 text-sm text-muted">
          {stats ? (
            <>
              <strong className="font-semibold text-ink">{formatNumber(stats.in_development)}</strong>{' '}
              {Number(stats.in_development) === 1 ? 'sugestão em desenvolvimento' : 'sugestões em desenvolvimento'}
            </>
          ) : (
            ' '
          )}
        </div>
      </div>

      {stats?.highlight && (
        <Link
          to={`/sugestoes/${stats.highlight.suggestion_id}`}
          style={highlightDrift.style}
          className={`${highlightDrift.className} relative z-10 -mt-6 ml-auto flex w-[92%] items-start gap-4 rounded-lg border border-line bg-surface p-4 shadow-float transition-[border-color] duration-200 hover:border-brand/40 sm:-mr-6 sm:w-[78%]`}
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-success/10 text-success">
            <Check className="h-5 w-5" strokeWidth={2.5} aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-x-2 text-[0.6875rem] font-bold uppercase tracking-wide">
              <span className="text-success">Sugestão em destaque</span>
              <span className={`inline-flex items-center gap-1 normal-case ${SUGGESTION_STATUS[stats.highlight.status].chip.split(' ')[1]}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${SUGGESTION_STATUS[stats.highlight.status].dot}`} aria-hidden />
                {SUGGESTION_STATUS[stats.highlight.status].label}
              </span>
            </span>
            <span className="mt-1 block truncate font-display text-sm font-semibold text-ink">{stats.highlight.title}</span>
            <span className="block truncate text-xs text-muted">
              {stats.highlight.project_name} · apoiada por {plural(stats.highlight.vote_count, 'voto', 'votos')}
            </span>
          </span>
        </Link>
      )}
    </div>
  );
}

/** Para o administrador, os três cartões viram os atalhos de gestão da plataforma. */
function AdminCards({ stats }: { stats?: PlatformStats }) {
  const [createOpen, setCreateOpen] = useState(false);
  const projects = useQuery({ queryKey: [...qk.projects, 'home'], queryFn: () => api.listProjects({}, 0, 6) });
  const pending = useQuery({
    queryKey: [...qk.adminSuggestions, 'em_analise', 'count'],
    queryFn: () => api.adminListSuggestions({ status: 'em_analise', type: null, search: null }, 0, 1),
  });
  const categories = [...new Set((projects.data?.items ?? []).map((p) => p.category))];
  const pendingCount = pending.data?.total;

  const cardClass =
    'card group flex h-full flex-col p-8 text-left transition-[border-color,box-shadow] duration-200 hover:border-brand/30 hover:shadow-float';
  const body = (icon: ReactNode, title: string, text: string, cta: string, badge?: string | null) => (
    <>
      <span className="flex items-start justify-between gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-soft text-brand" aria-hidden>
          {icon}
        </span>
        {badge && <span className="chip bg-teal-soft text-teal">{badge}</span>}
      </span>
      <span className="mt-7 block font-display text-2xl font-semibold text-ink">{title}</span>
      <span className="mt-3 block leading-relaxed text-muted">{text}</span>
      <span className="mt-auto inline-flex items-center gap-1.5 pt-6 text-sm font-semibold text-brand">
        {cta} <ArrowRight className="h-4 w-4" aria-hidden />
      </span>
    </>
  );

  return (
    <section className="grid gap-6 pb-10 md:grid-cols-3" aria-label="Gestão da plataforma">
      <button type="button" className={cardClass} onClick={() => setCreateOpen(true)}>
        {body(
          <FolderPlus className="h-5 w-5" />,
          'Projetos',
          'Cadastre novos projetos e gerencie os existentes pela engrenagem de cada cartão.',
          'Novo projeto',
        )}
      </button>
      <Link to="/admin?aba=sugestoes&status=em_analise" className={cardClass}>
        {body(
          <Lightbulb className="h-5 w-5" />,
          'Sugestões',
          'Analise as ideias, altere status, modere comentários e gerencie as contas.',
          'Abrir painel de gestão',
          pendingCount === undefined ? null : `${formatNumber(pendingCount)} em análise`,
        )}
      </Link>
      <Link to="/ranking" className={cardClass}>
        {body(
          <ThumbsUp className="h-5 w-5" />,
          'Votos',
          'A votação da comunidade destaca as ideias mais desejadas e pontua seus autores.',
          'Ver ranking',
          stats ? plural(stats.total_votes, 'voto', 'votos') : null,
        )}
      </Link>
      <ProjectFormDialog open={createOpen} onOpenChange={setCreateOpen} knownCategories={categories} />
    </section>
  );
}

function ProjectsSection() {
  const { isAdmin } = useAuth();
  const projects = useQuery({ queryKey: [...qk.projects, 'home'], queryFn: () => api.listProjects({}, 0, 6) });
  const categories = [...new Set((projects.data?.items ?? []).map((p) => p.category))];

  return (
    <section className="pt-12" aria-labelledby="projetos-titulo">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <h2 id="projetos-titulo" className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          Projetos cadastrados
        </h2>
        {projects.data && projects.data.total > 0 && (
          <Link to="/projetos" className="inline-flex items-center gap-1 text-lg font-semibold text-brand hover:underline">
            Ver todos <ChevronRight className="h-5 w-5" aria-hidden />
          </Link>
        )}
      </div>

      {projects.isPending ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-72 rounded-xl" />
          ))}
        </div>
      ) : projects.isError && !projects.data ? (
        <ErrorState error={projects.error} onRetry={() => projects.refetch()} />
      ) : projects.data.items.length === 0 ? (
        <EmptyState icon={<FolderPlus className="h-6 w-6" />} title="Nenhum projeto cadastrado ainda">
          {isAdmin ? 'Use o cartão “Projetos” acima para criar o primeiro projeto.' : 'Assim que a equipe cadastrar projetos, eles aparecerão aqui.'}
        </EmptyState>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {projects.data.items.map((p) => (
            <ProjectCard key={p.id} project={p} knownCategories={categories} />
          ))}
        </div>
      )}
    </section>
  );
}
