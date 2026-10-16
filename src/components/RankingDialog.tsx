import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Link } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, Crown, History, RotateCcw, Trophy, X, Zap } from 'lucide-react';
import { api, qk } from '@/lib/api';
import { formatNumber, formatPoints, formatWeekRange, plural } from '@/lib/format';
import { Avatar, ErrorState, Skeleton, toneFor } from './ui';

type Tab = 'semana' | 'geral';

interface Row {
  rank_position: number;
  user_id: string;
  user_name: string;
  user_avatar: string | null;
  score: number;
  detail: string;
  is_me: boolean;
}

/** Ouro, prata e bronze (mesmas cores das medalhas da página de ranking). */
const MEDAL = ['#d4a017', '#9aa4b2', '#c07a3f'];
const CROWN = 'fill-[#ffd54a] text-[#d4a017]';

/** Pontos sem ",0" quando inteiros: "3 pts", "1,5 pts". */
const pts = (value: number | string) => (Number.isInteger(Number(value)) ? formatNumber(value) : formatPoints(value));
const delay = (seconds: number) => ({ '--d': `${seconds}s` }) as CSSProperties;

interface RankingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Ranking da comunidade em modal: semana atual (com o pódio do fechamento às sextas) e geral. */
export function RankingDialog({ open, onOpenChange }: RankingDialogProps) {
  const [tab, setTab] = useState<Tab>('semana');

  useEffect(() => {
    if (open) setTab('semana');
  }, [open]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/40 animate-presence backdrop-blur-[2px] dark:bg-black/60" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[92vh] animate-presence flex-col overflow-hidden rounded-t-xl border border-line bg-surface shadow-float sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl">
          <div className="flex items-start gap-3 px-5 pt-5 sm:px-6 sm:pt-6">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand" aria-hidden>
              <Trophy className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="font-display text-xl font-bold tracking-tight text-ink">Ranking da Comunidade</Dialog.Title>
              <Dialog.Description className="mt-0.5 text-sm text-muted">
                Os maiores inovadores com ideias votadas
              </Dialog.Description>
            </div>
            <Dialog.Close className="rounded-lg p-1.5 text-muted hover:bg-subtle hover:text-ink" aria-label="Fechar">
              <X className="h-5 w-5" />
            </Dialog.Close>
          </div>

          <div role="tablist" aria-label="Período do ranking" className="mx-5 mt-4 grid grid-cols-2 gap-1 rounded-lg bg-subtle p-1 sm:mx-6">
            {(
              [
                ['semana', 'Esta semana'],
                ['geral', 'Geral'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold transition-colors duration-200 ${
                  tab === value ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'semana' ? <WeeklyPanel /> : <OverallPanel />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function WeeklyPanel() {
  const [past, setPast] = useState(false);
  const [replay, setReplay] = useState(0);
  const current = useQuery({ queryKey: qk.weeklyRanking(0), queryFn: () => api.getWeeklyRanking(0) });
  const last = useQuery({ queryKey: qk.weeklyRanking(1), queryFn: () => api.getWeeklyRanking(1), enabled: past });
  const q = past ? last : current;
  const data = q.data;
  const podium = past || Boolean(data?.is_closing_day);

  const rows: Row[] = (data?.entries ?? []).map((e) => ({
    rank_position: Number(e.rank_position),
    user_id: e.user_id,
    user_name: e.user_name,
    user_avatar: e.user_avatar,
    score: Number(e.score),
    detail: `${plural(e.votes_received, 'voto recebido', 'votos recebidos')} na semana`,
    is_me: e.is_me,
  }));

  let body: ReactNode;
  if (q.isPending) body = <ListSkeleton />;
  else if (q.isError && !data) body = <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  else if (data) {
    const range = formatWeekRange(data.week_start, data.week_end);
    body = (
      <>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {past ? (
            <>
              <span className="chip bg-subtle text-muted">
                Último fechamento · {range}
                {data.is_final && <span className="font-bold text-success">· resultado gravado</span>}
              </span>
              <button type="button" onClick={() => setPast(false)} className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline">
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Semana atual
              </button>
            </>
          ) : podium ? (
            <>
              <span className="chip bg-brand text-white dark:text-page">
                <Trophy className="h-3.5 w-3.5" aria-hidden /> Fechamento da semana
              </span>
              <span className="text-xs text-muted">{range} · encerra hoje às 23h59</span>
            </>
          ) : (
            <>
              <span className="text-xs text-muted">
                Semana de {range} · <strong className="font-semibold text-ink">fecha na sexta</strong>
              </span>
              <button type="button" onClick={() => setPast(true)} className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline">
                <History className="h-3.5 w-3.5" aria-hidden /> Último fechamento
              </button>
            </>
          )}
        </div>
        {rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
            {past
              ? 'Ninguém pontuou na semana passada.'
              : 'Ninguém pontuou nesta semana ainda. Os votos recebidos até sexta valem para o fechamento.'}
          </p>
        ) : podium ? (
          <>
            <Podium key={`${past}-${replay}`} rows={rows} />
            <button type="button" onClick={() => setReplay((n) => n + 1)} className="mx-auto mt-4 flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-ink">
              <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Repetir animação
            </button>
          </>
        ) : (
          <RankList rows={rows} />
        )}
      </>
    );
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">{body}</div>
      <ScoreFooter
        loading={current.isPending}
        score={current.data?.me.score ?? 0}
        position={current.data?.me.rank_position ?? null}
        label="Seus pontos na semana"
      />
    </>
  );
}

function OverallPanel() {
  // Mesma chave e formato da página /ranking: as duas telas compartilham o cache.
  const ranking = useInfiniteQuery({
    queryKey: qk.ranking,
    queryFn: ({ pageParam }) => api.getRanking(pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset,
  });
  const me = useQuery({ queryKey: qk.myScore, queryFn: api.getMyScore });
  const rows: Row[] = (ranking.data?.pages[0]?.items ?? []).slice(0, 10).map((r) => ({
    rank_position: Number(r.rank_position),
    user_id: r.user_id,
    user_name: r.user_name,
    user_avatar: r.user_avatar,
    score: Number(r.score),
    detail: `${plural(r.suggestion_count, 'sugestão', 'sugestões')} · ${plural(r.votes_received, 'voto', 'votos')}`,
    is_me: r.is_me,
  }));

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
        {ranking.isPending ? (
          <ListSkeleton />
        ) : ranking.isError && !ranking.data ? (
          <ErrorState error={ranking.error} onRetry={() => ranking.refetch()} />
        ) : rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
            O ranking aparece quando as primeiras sugestões forem publicadas.
          </p>
        ) : (
          <>
            <RankList rows={rows} />
            <Dialog.Close asChild>
              <Link to="/ranking" className="mx-auto mt-4 flex w-fit items-center gap-1 text-sm font-semibold text-brand hover:underline">
                Ver ranking completo <ChevronRight className="h-4 w-4" aria-hidden />
              </Link>
            </Dialog.Close>
          </>
        )}
      </div>
      <ScoreFooter
        loading={me.isPending}
        score={me.data?.score ?? 0}
        position={me.data?.rank_position ?? null}
        label="Sua pontuação"
      />
    </>
  );
}

function ScoreFooter({ loading, score, position, label }: { loading: boolean; score: number; position: number | null; label: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line bg-subtle/60 px-5 py-3.5 sm:px-6">
      <span className="text-sm text-muted">{label}:</span>
      {loading ? (
        <Skeleton className="h-7 w-20 rounded-lg" />
      ) : (
        <>
          <span className="rounded-lg border border-line bg-surface px-3 py-1 font-display text-sm font-bold text-ink">
            {pts(score)} pts
          </span>
          <span className="text-xs font-semibold text-brand">{position ? `#${position}` : 'sem posição'}</span>
        </>
      )}
      <span className="text-xs text-muted sm:ml-auto">Receba votos para subir! 🚀</span>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2, 3, 4].map((i) => (
        <Skeleton key={i} className="h-14 rounded-xl" />
      ))}
    </div>
  );
}

function RankList({ rows, startDelay }: { rows: Row[]; startDelay?: number }) {
  return (
    <ol className="space-y-1.5">
      {rows.map((r, i) => {
        const leader = r.rank_position === 1;
        return (
          <li
            key={r.rank_position}
            style={startDelay === undefined ? undefined : delay(startDelay + i * 0.06)}
            className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${startDelay === undefined ? 'animate-fade-in' : 'hv-podium-pop'} ${
              leader ? 'border-brand/50 bg-brand-soft/70' : r.is_me ? 'border-brand/25 bg-brand-soft/40' : 'border-transparent'
            }`}
          >
            <span
              className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold ${
                r.rank_position <= 3 ? 'bg-brand text-white dark:text-page' : 'text-muted'
              }`}
            >
              {r.rank_position}
              <span className="sr-only">º lugar</span>
            </span>
            <Dialog.Close asChild>
              <Link to={`/pessoas/${r.user_id}`} className="group flex min-w-0 flex-1 items-center gap-3" title={`Ver perfil de ${r.user_name}`}>
                <span className="relative">
                  <Avatar name={r.user_name} photo={r.user_avatar} size="md" tone={toneFor(r.user_name)} />
                  {leader && <Crown className={`absolute -right-1.5 -top-2 h-4 w-4 rotate-12 ${CROWN}`} aria-hidden />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-bold text-ink group-hover:text-brand">{r.user_name}</span>
                    {r.is_me && <YouChip />}
                  </span>
                  <span className="block truncate text-xs text-muted">{r.detail}</span>
                </span>
              </Link>
            </Dialog.Close>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line bg-subtle px-2.5 py-1 text-xs font-bold text-teal">
              <Zap className="h-3.5 w-3.5 fill-current" aria-hidden />
              {pts(r.score)} pts
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function YouChip() {
  return <span className="chip shrink-0 bg-brand py-0.5 text-[0.6875rem] text-white dark:text-page">você</span>;
}

// Ordem de entrada: o 3º degrau sobe primeiro e o 1º por último, com a coroa e o confete.
const STEP_DELAY: Record<number, number> = { 3: 0.1, 2: 0.35, 1: 0.6 };
const STEP_HEIGHT: Record<number, string> = { 1: 'h-32 sm:h-36', 2: 'h-24 sm:h-28', 3: 'h-16 sm:h-20' };
// Azul fixo nos dois temas (no escuro o brand clareia e o degrau ficaria desbotado).
const STEP_BG: Record<number, string> = {
  1: 'bg-gradient-to-b from-[#3b6cf0] to-[#1e3a9a]',
  2: 'bg-gradient-to-b from-[#3b6cf0]/60 to-[#1e3a9a]/60',
  3: 'bg-gradient-to-b from-subtle to-line',
};

function Podium({ rows }: { rows: Row[] }) {
  const byPlace = (place: number) => rows.find((r) => r.rank_position === place);
  const rest = rows.filter((r) => r.rank_position > 3);
  return (
    <div>
      <div className="relative overflow-hidden pt-8">
        <Confetti />
        <div className="grid grid-cols-3 items-end gap-2 sm:gap-3">
          {[2, 1, 3].map((place) => (
            <PodiumColumn key={place} place={place} row={byPlace(place)} />
          ))}
        </div>
        <div className="h-px bg-line" />
      </div>
      {rest.length > 0 && (
        <div className="mt-4">
          <RankList rows={rest} startDelay={1.6} />
        </div>
      )}
    </div>
  );
}

function PodiumColumn({ place, row }: { place: number; row: Row | undefined }) {
  const step = STEP_DELAY[place];
  const champion = place === 1;
  return (
    <div className="flex min-w-0 flex-col items-center">
      <div className="hv-podium-pop flex w-full min-w-0 flex-col items-center px-1 text-center" style={delay(step + 0.5)}>
        <span className="relative">
          {champion && row && <Crown className={`hv-crown absolute -top-6 left-1/2 h-6 w-6 ${CROWN}`} style={delay(1.45)} aria-hidden />}
          <span
            className={`block rounded-full border-2 p-0.5 ${champion ? 'hv-champion border-brand' : 'border-line'}`}
            style={champion ? delay(1.8) : undefined}
          >
            {row ? (
              <Avatar name={row.user_name} photo={row.user_avatar} size={champion ? 'lg' : 'md'} tone={toneFor(row.user_name)} />
            ) : (
              <span className={`grid place-items-center rounded-full border border-dashed border-line text-muted ${champion ? 'h-14 w-14' : 'h-10 w-10'}`} aria-hidden>
                ?
              </span>
            )}
          </span>
        </span>
        {row ? (
          <Dialog.Close asChild>
            <Link
              to={`/pessoas/${row.user_id}`}
              className={`mt-2 block w-full truncate font-bold text-ink transition-colors hover:text-brand ${champion ? 'text-sm sm:text-base' : 'text-xs sm:text-sm'}`}
            >
              {row.user_name}
            </Link>
          </Dialog.Close>
        ) : (
          <span className="mt-2 block w-full truncate text-xs font-bold text-muted sm:text-sm">Vago</span>
        )}
        {row?.is_me && (
          <span className="mt-1">
            <YouChip />
          </span>
        )}
        {row && (
          <span className="mt-0.5 inline-flex items-center gap-1 text-xs font-bold text-teal">
            <Zap className="h-3.5 w-3.5 fill-current" aria-hidden />
            <CountUp value={row.score} delaySeconds={step + 0.6} /> pts
          </span>
        )}
      </div>
      <div
        className={`hv-podium-step relative mt-3 w-full overflow-hidden rounded-t-xl ${STEP_HEIGHT[place]} ${STEP_BG[place]} ${champion ? 'hv-podium-shine' : ''} ${row ? '' : 'opacity-50'}`}
        style={delay(step)}
      >
        <span
          className="absolute left-1/2 top-3 grid h-8 w-8 -translate-x-1/2 place-items-center rounded-full font-display text-sm font-bold text-white shadow-card ring-2 ring-white/30"
          style={{ background: MEDAL[place - 1] }}
        >
          {place}
          <span className="sr-only">º lugar</span>
        </span>
      </div>
    </div>
  );
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/** Conta de 0 até o valor (em passos de 0,5 ponto) depois do atraso. */
function CountUp({ value, delaySeconds, duration = 900 }: { value: number; delaySeconds: number; duration?: number }) {
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? value : 0));

  useEffect(() => {
    if (prefersReducedMotion()) {
      setShown(value);
      return;
    }
    const start = performance.now() + delaySeconds * 1000;
    let frame = 0;
    const tick = (now: number) => {
      const p = Math.min(1, Math.max(0, (now - start) / duration));
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(p >= 1 ? value : Math.round(value * eased * 2) / 2);
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, delaySeconds, duration]);

  return (
    <>
      <span aria-hidden>{pts(shown)}</span>
      <span className="sr-only">{pts(value)}</span>
    </>
  );
}

const CONFETTI_COLORS = ['rgb(var(--brand))', 'rgb(var(--teal))', '#ffd54a', MEDAL[0], MEDAL[1], MEDAL[2]];

function Confetti() {
  // Pseudoaleatório fixo por peça: o confete cai igual a cada renderização.
  const pieces = useMemo(
    () =>
      Array.from({ length: 36 }, (_, i) => {
        const rand = (k: number) => {
          const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
          return x - Math.floor(x);
        };
        return {
          left: `${rand(1) * 100}%`,
          background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
          borderRadius: rand(6) > 0.7 ? '9999px' : undefined,
          '--x': `${(rand(2) - 0.5) * 120}px`,
          '--r': `${360 + rand(3) * 540}deg`,
          '--d': `${1.3 + rand(4) * 0.6}s`,
          '--t': `${1.8 + rand(5) * 1.4}s`,
        } as CSSProperties;
      }),
    [],
  );
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-10">
      {pieces.map((style, i) => (
        <span key={i} className="hv-confetti" style={style} />
      ))}
    </div>
  );
}
