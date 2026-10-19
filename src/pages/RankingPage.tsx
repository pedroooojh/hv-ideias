import { Link } from 'react-router-dom';
import { usePageTitle } from '@/lib/navigation';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Crown, Trophy } from 'lucide-react';
import { api, qk } from '@/lib/api';
import { formatMonth, formatNumber, formatPoints, plural } from '@/lib/format';
import { PersonLink } from '@/components/PersonLink';
import { Avatar, EmptyState, ErrorState, LoadMore, PageContainer, Skeleton, medalTilt, toneFor } from '@/components/ui';

const CROWN = 'fill-[#ffd54a] text-[#d4a017]';

export function RankingPage() {
  usePageTitle('Ranking');
  const month = formatMonth(new Date());
  const me = useQuery({ queryKey: qk.myScore, queryFn: api.getMyScore });
  const ranking = useInfiniteQuery({
    queryKey: qk.ranking,
    queryFn: ({ pageParam }) => api.getRanking(pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset,
  });
  const champions = useQuery({ queryKey: qk.monthlyChampions, queryFn: () => api.listMonthlyChampions() });
  const rows = ranking.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <PageContainer narrow back={{ to: '/', label: 'Início' }}>
      <header className="max-w-3xl">
        <span className="inline-flex items-center gap-2 rounded-lg bg-brand-soft px-4 py-2 text-xs font-bold uppercase tracking-[0.08em] text-brand">
          <Trophy className="h-4 w-4" aria-hidden /> Ranking do mês
        </span>
        <h1 className="mt-5 text-4xl font-bold tracking-[-0.02em] text-ink sm:text-5xl">Quem mais inspira a comunidade</h1>
        <p className="mt-4 text-lg text-muted">
          Cada sugestão publicada vale <strong className="text-ink">0,5 ponto</strong> e cada voto recebido vale{' '}
          <strong className="text-ink">1 ponto</strong>. Quando a equipe seleciona a ideia, os pontos dela{' '}
          <strong className="text-ink">dobram</strong>. No último dia do mês, quem estiver em 1º lugar é o campeão e leva o
          prêmio.{' '}
          <Link to="/diretrizes" className="font-semibold text-brand hover:underline">
            Ver regras
          </Link>
        </p>
      </header>

      <section className="mt-8 grid gap-4 sm:grid-cols-4" aria-label="Minha pontuação no mês">
        {me.isPending ? (
          [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)
        ) : me.isError && !me.data ? (
          <div className="sm:col-span-4">
            <ErrorState error={me.error} onRetry={() => me.refetch()} title="Não foi possível carregar sua pontuação" />
          </div>
        ) : (
          <>
            <ScoreTile label="Minha posição no mês" value={me.data.rank_position ? `${me.data.rank_position}º` : '—'} highlight />
            <ScoreTile label="Meus pontos no mês" value={formatPoints(me.data.score)} />
            <ScoreTile label="Votos no mês" value={formatNumber(me.data.votes_received)} />
            <ScoreTile label="Sugestões no mês" value={formatNumber(me.data.suggestion_count)} />
          </>
        )}
      </section>

      <section className="mt-10" aria-labelledby="classificacao-titulo">
        <h2 id="classificacao-titulo" className="mb-1 text-2xl font-bold text-ink">
          Classificação parcial
        </h2>
        <p className="mb-4 text-sm text-muted">Mês de {month} · o campeão é definido no último dia, às 23h59</p>
        {ranking.isPending ? (
          <div className="space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </div>
        ) : ranking.isError && !ranking.data ? (
          <ErrorState error={ranking.error} onRetry={() => ranking.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState icon={<Trophy className="h-6 w-6" />} title="Ninguém pontuou neste mês ainda">
            Publique ideias e receba votos para disputar o título de campeão do mês.
          </EmptyState>
        ) : (
          <div className="card animate-fade-in overflow-hidden">
            <table className="w-full text-left">
              <caption className="sr-only">Classificação parcial do mês por pontuação</caption>
              <thead className="hidden border-b border-line bg-subtle/60 text-xs font-semibold uppercase tracking-wide text-muted sm:table-header-group">
                <tr>
                  <th scope="col" className="w-20 px-6 py-3">
                    Posição
                  </th>
                  <th scope="col" className="px-6 py-3">
                    Participante
                  </th>
                  <th scope="col" className="px-6 py-3 text-right">
                    Sugestões
                  </th>
                  <th scope="col" className="px-6 py-3 text-right">
                    Votos recebidos
                  </th>
                  <th scope="col" className="px-6 py-3 text-right">
                    Pontos
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.rank_position} className={`grid grid-cols-[3rem_1fr_auto] items-center gap-x-3 px-4 py-4 sm:table-row sm:px-0 ${r.is_me ? 'bg-brand-soft/50' : ''}`}>
                    <td className="sm:px-6 sm:py-4">
                      <span className="inline-flex items-center gap-1 font-bold text-ink">
                        {r.rank_position === 1 && (
                          <span
                            role="img"
                            aria-label="Líder do mês"
                            title="Líder do mês"
                            className="inline-block text-lg leading-none"
                            style={medalTilt(`${r.user_id}-1`)}
                          >
                            🥇
                          </span>
                        )}
                        <span className={r.rank_position === 1 ? 'sr-only sm:not-sr-only' : ''}>{r.rank_position}º</span>
                      </span>
                    </td>
                    <td className="min-w-0 sm:px-6 sm:py-4">
                      <PersonLink id={r.user_id} className="flex items-center gap-3">
                        <Avatar name={r.user_name} photo={r.user_avatar} size="md" tone={toneFor(r.user_name)} />
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-ink">
                            {r.user_name}
                            {r.is_me && <span className="chip ml-2 bg-brand py-0.5 text-[0.6875rem] text-white dark:text-page">você</span>}
                          </span>
                          <span className="block text-xs text-muted sm:hidden">
                            {plural(r.suggestion_count, 'sugestão', 'sugestões')} · {plural(r.votes_received, 'voto', 'votos')}
                          </span>
                        </span>
                      </PersonLink>
                    </td>
                    <td className="hidden px-6 py-4 text-right text-muted sm:table-cell">{formatNumber(r.suggestion_count)}</td>
                    <td className="hidden px-6 py-4 text-right text-muted sm:table-cell">{formatNumber(r.votes_received)}</td>
                    <td className="text-right sm:px-6 sm:py-4">
                      <span className="font-display text-lg font-bold text-navy">{formatPoints(r.score)}</span>
                      <span className="ml-1 text-xs text-muted">pts</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <LoadMore hasMore={ranking.hasNextPage} loading={ranking.isFetchingNextPage} onClick={() => ranking.fetchNextPage()} />
        <p className="mt-6 text-xs text-muted">
          Contam os pontos ganhos dentro do mês (horário de Brasília). Desempate: mais votos recebidos no mês e, depois, quem
          chegou primeiro à pontuação. Contas desativadas e sugestões excluídas não entram no ranking.
        </p>
      </section>

      <section className="mt-12" aria-labelledby="campeoes-titulo">
        <h2 id="campeoes-titulo" className="mb-4 flex items-center gap-2 text-2xl font-bold text-ink">
          <Crown className={`h-6 w-6 ${CROWN}`} aria-hidden /> Campeões do mês
        </h2>
        {champions.isPending ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
        ) : champions.isError && !champions.data ? (
          <ErrorState error={champions.error} onRetry={() => champions.refetch()} />
        ) : champions.data.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
            O primeiro campeão será conhecido no fim de {month}.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {champions.data.map((c) => (
              <li key={c.month_start} className={`card flex animate-fade-in items-center gap-3 p-4 ${c.is_me ? 'border-brand/40 bg-brand-soft/40' : ''}`}>
                <span className="relative shrink-0">
                  <Avatar name={c.user_name} photo={c.user_avatar} size="lg" tone={toneFor(c.user_name)} />
                  <Crown className={`absolute -right-1.5 -top-2 h-5 w-5 rotate-12 ${CROWN}`} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-bold uppercase tracking-[0.08em] text-brand">{formatMonth(c.month_start)}</span>
                  <PersonLink id={c.user_id} className="block truncate font-semibold text-ink">
                    {c.user_name}
                  </PersonLink>
                  <span className="block text-xs text-muted">{plural(c.votes_received, 'voto recebido', 'votos recebidos')}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="font-display text-lg font-bold text-navy">{formatPoints(c.score)}</span>
                  <span className="ml-1 text-xs text-muted">pts</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageContainer>
  );
}

function ScoreTile({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`animate-fade-in rounded-xl border p-5 ${highlight ? 'border-brand/30 bg-brand text-white dark:text-page' : 'card'}`}>
      <p className={`text-sm ${highlight ? 'text-white/80 dark:text-page/80' : 'text-muted'}`}>{label}</p>
      <p className={`mt-1 font-display text-3xl font-bold tracking-tight ${highlight ? '' : 'text-ink'}`}>{value}</p>
    </div>
  );
}
