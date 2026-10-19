import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, Crown, History, RotateCcw, Trophy, X, Zap } from 'lucide-react';
import { api, qk, type MonthlyChampion, type MonthlyRunnerUp } from '@/lib/api';
import { daysUntilClose, formatMonth, formatNumber, formatPoints, formatWeekRange, plural } from '@/lib/format';
import { Avatar, ErrorState, Skeleton, medalTilt, toneFor } from './ui';

type Tab = 'semana' | 'mes';
/** O que o modal mostra ao abrir: a semana, o mês atual ou o campeão do mês passado. */
export type RankingView = 'semana' | 'mes' | 'campeao';

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
/** Medalhas do 1º ao 3º. A coroa é só do campeão do mês. */
const MEDAL_EMOJI = ['🥇', '🥈', '🥉'];
const CROWN = 'fill-[#ffd54a] text-[#d4a017]';

/** Pontos sem ",0" quando inteiros: "3 pts", "1,5 pts". */
const pts = (value: number | string) => (Number.isInteger(Number(value)) ? formatNumber(value) : formatPoints(value));
const delay = (seconds: number) => ({ '--d': `${seconds}s` }) as CSSProperties;
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const countdown = (endExclusive: string) => {
  const days = daysUntilClose(endExclusive);
  return days === 1 ? 'falta 1 dia' : `faltam ${days} dias`;
};

const TABS = [
  { value: 'semana', label: 'Esta semana', hint: 'Pódio toda sexta' },
  { value: 'mes', label: 'Este mês', hint: 'Campeão leva o prêmio' },
] as const;

interface RankingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  view?: RankingView;
}

/**
 * Ranking da comunidade em modal: a semana (com o pódio do fechamento às sextas)
 * e o mês, que vale o prêmio — parcial durante o mês e só o campeão no fechamento.
 */
export function RankingDialog({ open, onOpenChange, view = 'semana' }: RankingDialogProps) {
  const [tab, setTab] = useState<Tab>('semana');
  const [championView, setChampionView] = useState(false);

  useEffect(() => {
    if (open) {
      setTab(view === 'semana' ? 'semana' : 'mes');
      setChampionView(view === 'campeao');
    }
  }, [open, view]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/40 animate-presence backdrop-blur-[2px] dark:bg-black/60" />
        {/* Altura fixa no desktop: trocar de aba ou de período não faz o modal pular. */}
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[92vh] min-h-[60vh] animate-presence flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-float sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:h-[min(46rem,90vh)] sm:max-h-none sm:w-[calc(100vw-3rem)] sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl">
          <div className="flex items-start gap-4 px-5 pt-5 sm:px-8 sm:pt-7">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand" aria-hidden>
              <Trophy className="h-6 w-6" />
            </span>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="font-display text-xl font-bold tracking-tight text-ink sm:text-2xl">
                Ranking da Comunidade
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-sm text-muted">Os maiores inovadores com ideias votadas</Dialog.Description>
            </div>
            <Dialog.Close className="-mr-1.5 rounded-lg p-1.5 text-muted hover:bg-subtle hover:text-ink" aria-label="Fechar">
              <X className="h-5 w-5" />
            </Dialog.Close>
          </div>

          <div role="tablist" aria-label="Período do ranking" className="mx-5 mt-5 grid grid-cols-2 gap-1 rounded-xl bg-subtle p-1 sm:mx-8">
            {TABS.map((t) => (
              <button
                key={t.value}
                type="button"
                role="tab"
                aria-selected={tab === t.value}
                onClick={() => {
                  setTab(t.value);
                  setChampionView(false);
                }}
                className={`rounded-lg px-3 py-2 text-center transition-colors duration-200 ${
                  tab === t.value ? 'bg-surface shadow-card' : 'hover:bg-surface/50'
                }`}
              >
                <span className={`block text-sm font-semibold ${tab === t.value ? 'text-ink' : 'text-muted'}`}>{t.label}</span>
                <span className={`block text-[0.6875rem] ${tab === t.value ? 'text-brand' : 'text-muted/80'}`}>{t.hint}</span>
              </button>
            ))}
          </div>

          {tab === 'semana' ? <WeeklyPanel /> : <MonthlyPanel past={championView} onPastChange={setChampionView} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Cabeçalho do período: rótulo, título (datas ou mês), prazo e a ação secundária. */
function PeriodHeader({
  eyebrow,
  title,
  note,
  action,
}: {
  eyebrow: ReactNode;
  title: string;
  note: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted">{eyebrow}</div>
        <h3 className="mt-1 font-display text-lg font-bold leading-tight text-ink sm:text-xl">{title}</h3>
        <p className="mt-0.5 text-sm text-muted">{note}</p>
      </div>
      {action}
    </div>
  );
}

function PeriodAction({ onClick, icon, children }: { onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-subtle/70 px-3 py-2 text-xs font-semibold text-ink transition-colors duration-200 hover:border-brand/40 hover:text-brand"
    >
      {icon}
      {children}
    </button>
  );
}

const closingChip = (icon: ReactNode, label: string) => (
  <span className="chip bg-brand normal-case tracking-normal text-white dark:text-page">
    {icon} {label}
  </span>
);

function EmptyRanking({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-line px-6 py-12 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-subtle text-muted" aria-hidden>
        <Trophy className="h-5 w-5" />
      </span>
      <p className="mt-3 font-semibold text-ink">{title}</p>
      {children && <p className="mt-1 max-w-sm text-sm text-muted">{children}</p>}
    </div>
  );
}

function ReplayButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="mx-auto mt-5 flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-ink">
      <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Repetir animação
    </button>
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
        {past ? (
          <PeriodHeader
            eyebrow="Último fechamento"
            title={range}
            note={data.is_final ? <span className="font-semibold text-success">Resultado gravado</span> : 'Resultado calculado'}
            action={
              <PeriodAction onClick={() => setPast(false)} icon={<ArrowLeft className="h-3.5 w-3.5" aria-hidden />}>
                Semana atual
              </PeriodAction>
            }
          />
        ) : podium ? (
          <PeriodHeader
            eyebrow={closingChip(<Trophy className="h-3.5 w-3.5" aria-hidden />, 'Fechamento da semana')}
            title={range}
            note="Encerra hoje às 23h59"
          />
        ) : (
          <PeriodHeader
            eyebrow="Semana atual"
            title={range}
            note={
              <>
                <strong className="font-semibold text-ink">Pódio na sexta</strong> às 23h59 · {countdown(data.week_end)}
              </>
            }
            action={
              <PeriodAction onClick={() => setPast(true)} icon={<History className="h-3.5 w-3.5" aria-hidden />}>
                Último fechamento
              </PeriodAction>
            }
          />
        )}
        {rows.length === 0 ? (
          past ? (
            <EmptyRanking title="Ninguém pontuou na semana passada." />
          ) : (
            <EmptyRanking title="Ninguém pontuou nesta semana ainda.">
              Publique ideias e receba votos: os pontos ganhos até sexta valem para o pódio.
            </EmptyRanking>
          )
        ) : podium ? (
          <>
            <Podium key={`${past}-${replay}`} rows={rows} />
            <ReplayButton onClick={() => setReplay((n) => n + 1)} />
          </>
        ) : (
          <RankList rows={rows} medalPlaces={3} />
        )}
      </>
    );
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-8">{body}</div>
      <ScoreFooter
        loading={current.isPending}
        score={current.data?.me.score ?? 0}
        position={current.data?.me.rank_position ?? null}
        period="na semana"
      />
    </>
  );
}

function MonthlyPanel({ past, onPastChange }: { past: boolean; onPastChange: (past: boolean) => void }) {
  const [replay, setReplay] = useState(0);
  const current = useQuery({ queryKey: qk.monthlyRanking(0), queryFn: () => api.getMonthlyRanking(0) });
  const last = useQuery({ queryKey: qk.monthlyRanking(1), queryFn: () => api.getMonthlyRanking(1), enabled: past });
  // Quem ficou logo atrás do campeão: carrega junto, para entrar na mesma animação.
  const runnersUp = useQuery({ queryKey: qk.monthlyRunnersUp(1), queryFn: () => api.getMonthlyRunnersUp(1), enabled: past });
  const q = past ? last : current;
  const data = q.data;

  const rows: Row[] = (data?.entries ?? []).map((e) => ({
    rank_position: Number(e.rank_position),
    user_id: e.user_id,
    user_name: e.user_name,
    user_avatar: e.user_avatar,
    score: Number(e.score),
    detail: `${plural(e.votes_received, 'voto', 'votos')} · ${plural(e.suggestion_count, 'sugestão', 'sugestões')} no mês`,
    is_me: e.is_me,
  }));

  let body: ReactNode;
  if (q.isPending || (past && runnersUp.isPending)) body = <ListSkeleton />;
  else if (q.isError && !data) body = <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  else if (data) {
    const month = formatMonth(data.month_start);
    body = past ? (
      <>
        <PeriodHeader
          eyebrow="Campeão do mês"
          title={capitalize(month)}
          note={data.is_final ? <span className="font-semibold text-success">Resultado gravado</span> : 'Resultado calculado'}
          action={
            <PeriodAction onClick={() => onPastChange(false)} icon={<ArrowLeft className="h-3.5 w-3.5" aria-hidden />}>
              Mês atual
            </PeriodAction>
          }
        />
        {data.champion ? (
          <>
            {/* Se os "quase lá" falharem, o campeão aparece sozinho. */}
            <ChampionReveal key={replay} champion={data.champion} month={month} runnersUp={runnersUp.data ?? []} />
            <ReplayButton onClick={() => setReplay((n) => n + 1)} />
          </>
        ) : (
          <EmptyRanking title={`Ninguém pontuou em ${month}.`} />
        )}
      </>
    ) : (
      <>
        {data.is_closing_day ? (
          <PeriodHeader
            eyebrow={closingChip(<Crown className="h-3.5 w-3.5" aria-hidden />, 'Fechamento do mês')}
            title={capitalize(month)}
            note="Encerra hoje às 23h59 · o 1º lugar é o campeão"
          />
        ) : (
          <PeriodHeader
            eyebrow="Parcial do mês"
            title={capitalize(month)}
            note={
              <>
                <strong className="font-semibold text-ink">Campeão definido no último dia</strong> às 23h59 ·{' '}
                {countdown(data.month_end)}
              </>
            }
            action={
              <PeriodAction onClick={() => onPastChange(true)} icon={<Crown className="h-3.5 w-3.5" aria-hidden />}>
                Último campeão
              </PeriodAction>
            }
          />
        )}
        {rows.length === 0 ? (
          <EmptyRanking title="Ninguém pontuou neste mês ainda.">
            Publique ideias e receba votos para disputar o título de campeão do mês.
          </EmptyRanking>
        ) : (
          <>
            <RankList rows={rows} medalPlaces={1} />
            <Dialog.Close asChild>
              <Link to="/ranking" className="mx-auto mt-5 flex w-fit items-center gap-1 text-sm font-semibold text-brand hover:underline">
                Ver classificação completa <ChevronRight className="h-4 w-4" aria-hidden />
              </Link>
            </Dialog.Close>
          </>
        )}
      </>
    );
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-8">{body}</div>
      <ScoreFooter
        loading={current.isPending}
        score={current.data?.me.score ?? 0}
        position={current.data?.me.rank_position ?? null}
        period="no mês"
      />
    </>
  );
}

// Linha do tempo da revelação (segundos): palco → avatar → coroa e brilho →
// confete → título e nome → números → "quase lá", um por vez.
const REVEAL = { avatar: 0.45, crown: 1.05, title: 1.35, name: 1.55, stats: 1.85, runnersUp: 2.5 };
// Estrelinhas em volta do avatar: posição no palco, tamanho e atraso do brilho.
const SPARKLES = [
  { left: '24%', top: '16%', size: 'text-lg', d: 1.3 },
  { left: '72%', top: '12%', size: 'text-base', d: 1.7 },
  { left: '16%', top: '42%', size: 'text-sm', d: 2.1 },
  { left: '82%', top: '38%', size: 'text-xl', d: 1.5 },
  { left: '30%', top: '58%', size: 'text-xs', d: 2.4 },
  { left: '68%', top: '60%', size: 'text-sm', d: 1.9 },
];

/** Revelação do campeão do mês: um palco só para quem leva o prêmio e, embaixo, quem quase chegou lá. */
function ChampionReveal({ champion, month, runnersUp }: { champion: MonthlyChampion; month: string; runnersUp: MonthlyRunnerUp[] }) {
  const score = Number(champion.score);
  return (
    <div>
      {/* Palco em azul fixo nos dois temas: o dourado precisa de fundo escuro para brilhar. */}
      <div
        className="hv-stage relative isolate overflow-hidden rounded-2xl border border-[#ffd54a]/30 bg-[radial-gradient(ellipse_at_top,#3361e0_0%,#172e7a_42%,#0a1233_100%)] px-5 pb-6 pt-14 text-center text-white shadow-float"
        style={delay(0)}
      >
        <div aria-hidden className="hv-spotlight pointer-events-none absolute inset-x-0 top-0 -z-10 mx-auto h-full w-80" style={delay(0.15)} />
        <div
          aria-hidden
          className="hv-rays pointer-events-none absolute left-1/2 top-[7.5rem] -z-10 h-[34rem] w-[34rem] -translate-x-1/2 -translate-y-1/2"
          style={delay(0.3)}
        />
        <Confetti />
        <Confetti seed={7} delayOffset={1.3} />
        {SPARKLES.map((s, i) => (
          <span
            key={i}
            aria-hidden
            className={`hv-twinkle pointer-events-none absolute text-[#ffe58a] ${s.size}`}
            style={{ left: s.left, top: s.top, ...delay(s.d) }}
          >
            ✦
          </span>
        ))}

        <div className="flex flex-col items-center">
          <span className="hv-podium-pop relative" style={delay(REVEAL.avatar)}>
            <span aria-hidden className="hv-burst absolute -inset-8 rounded-full" style={delay(REVEAL.crown + 0.15)} />
            <Crown
              className={`hv-crown absolute -top-12 left-1/2 z-10 h-12 w-12 drop-shadow-[0_4px_10px_rgb(0_0_0/0.35)] ${CROWN}`}
              style={delay(REVEAL.crown)}
              aria-hidden
            />
            <span className="hv-gold-ring block rounded-full p-1" style={delay(REVEAL.crown)}>
              <span className="block rounded-full bg-[#0a1233] p-1">
                <Avatar name={champion.user_name} photo={champion.user_avatar} size="2xl" tone={toneFor(champion.user_name)} />
              </span>
            </span>
          </span>

          <p
            className="hv-fade-up mt-5 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.14em] text-[#ffd54a]"
            style={delay(REVEAL.title)}
          >
            <Trophy className="h-3.5 w-3.5" aria-hidden /> Campeão de {month}
          </p>
          <div className="hv-fade-up mt-1 max-w-full" style={delay(REVEAL.name)}>
            <Dialog.Close asChild>
              <Link
                to={`/pessoas/${champion.user_id}`}
                className="hv-gold-text block max-w-full truncate px-2 font-display text-3xl font-bold leading-tight hover:underline sm:text-4xl"
              >
                {champion.user_name}
              </Link>
            </Dialog.Close>
          </div>
          {champion.is_me && (
            <span className="hv-fade-up mt-2" style={delay(REVEAL.name + 0.1)}>
              <YouChip />
            </span>
          )}

          <div className="mt-4 grid w-full max-w-sm grid-cols-3 gap-2">
            <StageStat d={REVEAL.stats} label="pontos" highlight>
              <Zap className="h-4 w-4 fill-current" aria-hidden />
              <CountUp value={score} delaySeconds={REVEAL.stats} />
            </StageStat>
            <StageStat d={REVEAL.stats + 0.12} label={champion.votes_received === 1 ? 'voto' : 'votos'}>
              {formatNumber(champion.votes_received)}
            </StageStat>
            <StageStat d={REVEAL.stats + 0.24} label={champion.suggestion_count === 1 ? 'sugestão' : 'sugestões'}>
              {formatNumber(champion.suggestion_count)}
            </StageStat>
          </div>
        </div>
      </div>

      {runnersUp.length > 0 && <RunnersUp rows={runnersUp} championScore={score} />}
    </div>
  );
}

function StageStat({ d, label, highlight = false, children }: { d: number; label: string; highlight?: boolean; children: ReactNode }) {
  return (
    <div
      className={`hv-podium-pop rounded-xl border px-2 py-2.5 ${highlight ? 'border-[#ffd54a]/50 bg-[#ffd54a]/15' : 'border-white/15 bg-white/10'}`}
      style={delay(d)}
    >
      <p className={`inline-flex items-center gap-1 font-display text-xl font-bold leading-none ${highlight ? 'text-[#ffd54a]' : 'text-white'}`}>
        {children}
      </p>
      <p className="mt-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-white/70">{label}</p>
    </div>
  );
}

/** Quem ficou logo atrás do campeão, com a distância até o 1º lugar. */
function RunnersUp({ rows, championScore }: { rows: MonthlyRunnerUp[]; championScore: number }) {
  // Em telas baixas a lista fica abaixo do palco: a entrada só começa quando ela aparece,
  // no tempo da revelação ou na hora, se a pessoa rolar até ela depois.
  const ref = useRef<HTMLElement>(null);
  const [start, setStart] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined' || prefersReducedMotion()) {
      setStart(REVEAL.runnersUp);
      return;
    }
    const mountedAt = performance.now();
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setStart(Math.max(0.1, REVEAL.runnersUp - (performance.now() - mountedAt) / 1000));
        observer.disconnect();
      },
      { threshold: 0.25 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <section ref={ref} className={`mt-6 ${start === null ? 'opacity-0' : ''}`} aria-labelledby="quase-la">
      <div className="hv-fade-up mb-3 flex items-baseline justify-between gap-3" style={delay(start ?? 0)}>
        <h4 id="quase-la" className="font-display text-base font-bold text-ink">
          Quase lá
        </h4>
        <span className="text-xs text-muted">Por pouco não levaram o título</span>
      </div>
      <ol className="space-y-2">
        {rows.map((r, i) => {
          const place = Number(r.rank_position);
          const score = Number(r.score);
          const gap = Math.max(0, championScore - score);
          const d = (start ?? 0) + 0.2 + i * 0.16;
          const medal = place <= 3 ? MEDAL_EMOJI[place - 1] : null;
          const share = championScore > 0 ? Math.round((score / championScore) * 100) : 0;
          return (
            <li
              key={r.user_id}
              className={`hv-fade-up flex items-center gap-3 rounded-xl border px-3 py-3 sm:gap-4 sm:px-4 ${
                r.is_me ? 'border-brand/30 bg-brand-soft/50' : 'border-line/60 bg-subtle/40'
              }`}
              style={delay(d)}
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center text-sm font-bold text-muted">
                {medal ? (
                  <span role="img" aria-label={`${place}º lugar`} className="text-xl leading-none" style={medalTilt(`${r.user_id}-${place}`)}>
                    {medal}
                  </span>
                ) : (
                  <>
                    {place}
                    <span className="sr-only">º lugar</span>
                  </>
                )}
              </span>
              <Dialog.Close asChild>
                <Link to={`/pessoas/${r.user_id}`} className="group flex min-w-0 flex-1 items-center gap-3" title={`Ver perfil de ${r.user_name}`}>
                  <Avatar name={r.user_name} photo={r.user_avatar} size="md" tone={toneFor(r.user_name)} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[0.9375rem] font-bold text-ink group-hover:text-brand">{r.user_name}</span>
                      {r.is_me && <YouChip />}
                    </span>
                    <span className="mt-1.5 flex items-center gap-2">
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line/70" aria-hidden>
                        <span
                          className="hv-bar block h-full rounded-full bg-gradient-to-r from-brand to-teal"
                          style={{ '--w': `${share}%`, ...delay(d + 0.25) } as CSSProperties}
                        />
                      </span>
                      <span className="shrink-0 text-xs text-muted">a {pts(gap)} pts do 1º</span>
                    </span>
                  </span>
                </Link>
              </Dialog.Close>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line bg-surface px-2 py-1 text-xs font-bold text-teal sm:px-3 sm:py-1.5 sm:text-sm">
                <Zap className="h-3.5 w-3.5 fill-current" aria-hidden />
                {pts(score)} <span className="text-[0.6875rem] font-semibold sm:text-xs">pts</span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Rodapé: a posição e os pontos de quem está vendo, e a regra de pontuação resumida. */
function ScoreFooter({ loading, score, position, period }: { loading: boolean; score: number; position: number | null; period: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-line bg-subtle/60 px-5 py-4 sm:px-8">
      <FooterStat label={`Sua posição ${period}`} loading={loading}>
        {position ? `#${position}` : <span className="text-base text-muted">sem posição</span>}
      </FooterStat>
      <FooterStat label={`Seus pontos ${period}`} loading={loading}>
        {pts(score)} <span className="text-sm font-semibold text-muted">pts</span>
      </FooterStat>
      <p className="w-full text-xs leading-relaxed text-muted sm:ml-auto sm:w-auto sm:text-right">
        <span className="font-semibold text-ink">0,5</span> por ideia · <span className="font-semibold text-ink">1</span> por voto
        <br className="hidden sm:block" />
        <span className="sm:hidden"> · </span>
        <span className="font-semibold text-ink">×2</span> se a ideia for selecionada
      </p>
    </div>
  );
}

function FooterStat({ label, loading, children }: { label: string; loading: boolean; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      {loading ? (
        <Skeleton className="mt-1 h-7 w-16 rounded-lg" />
      ) : (
        <p className="font-display text-2xl font-bold leading-tight text-ink">{children}</p>
      )}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="mb-5 h-14 w-56 rounded-lg" />
      {[0, 1, 2, 3, 4].map((i) => (
        <Skeleton key={i} className="h-16 rounded-xl" />
      ))}
    </div>
  );
}

/**
 * medalPlaces: quantas primeiras posições levam medalha e selo azul — 🥇🥈🥉 na
 * semana, só a 🥇 de líder no mês (a coroa fica para o campeão, depois do fechamento).
 */
function RankList({ rows, startDelay, medalPlaces }: { rows: Row[]; startDelay?: number; medalPlaces: number }) {
  return (
    <ol className="space-y-2">
      {rows.map((r, i) => {
        const leader = r.rank_position === 1;
        const medal = r.rank_position <= medalPlaces ? MEDAL_EMOJI[r.rank_position - 1] : null;
        return (
          <li
            key={r.rank_position}
            style={startDelay === undefined ? undefined : delay(startDelay + i * 0.06)}
            className={`flex items-center gap-2.5 rounded-xl border px-3 py-3 sm:gap-4 sm:px-4 ${startDelay === undefined ? 'animate-fade-in' : 'hv-podium-pop'} ${
              leader ? 'border-brand/50 bg-brand-soft/70' : r.is_me ? 'border-brand/25 bg-brand-soft/40' : 'border-line/60 bg-subtle/30'
            }`}
          >
            <span
              className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold sm:h-8 sm:w-8 sm:text-sm ${
                medal ? 'bg-brand text-white dark:text-page' : 'text-muted'
              }`}
            >
              {r.rank_position}
              <span className="sr-only">º lugar</span>
            </span>
            <Dialog.Close asChild>
              <Link to={`/pessoas/${r.user_id}`} className="group flex min-w-0 flex-1 items-center gap-3" title={`Ver perfil de ${r.user_name}`}>
                <span className="relative shrink-0">
                  <Avatar name={r.user_name} photo={r.user_avatar} size="md" tone={toneFor(r.user_name)} />
                  {medal && (
                    <span
                      role="img"
                      aria-label={medalPlaces === 1 ? 'Líder do mês' : `Medalha de ${r.rank_position}º lugar`}
                      title={medalPlaces === 1 ? 'Líder do mês' : undefined}
                      className="absolute -right-2 -top-2 text-base leading-none"
                      style={medalTilt(`${r.user_id}-${r.rank_position}`)}
                    >
                      {medal}
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[0.9375rem] font-bold text-ink group-hover:text-brand">{r.user_name}</span>
                    {r.is_me && <YouChip />}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted">{r.detail}</span>
                </span>
              </Link>
            </Dialog.Close>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line bg-surface px-2 py-1 text-xs font-bold text-teal sm:px-3 sm:py-1.5 sm:text-sm">
              <Zap className="h-3.5 w-3.5 fill-current" aria-hidden />
              {pts(r.score)} <span className="text-[0.6875rem] font-semibold sm:text-xs">pts</span>
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

// Ordem de entrada: o 3º degrau sobe primeiro e o 1º por último, com a medalha e o confete.
const STEP_DELAY: Record<number, number> = { 3: 0.1, 2: 0.35, 1: 0.6 };
const STEP_HEIGHT: Record<number, string> = { 1: 'h-32 sm:h-40', 2: 'h-24 sm:h-28', 3: 'h-16 sm:h-20' };
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
      <div className="relative overflow-hidden pt-10">
        <Confetti />
        <div className="mx-auto grid max-w-lg grid-cols-3 items-end gap-2 sm:gap-4">
          {[2, 1, 3].map((place) => (
            <PodiumColumn key={place} place={place} row={byPlace(place)} />
          ))}
        </div>
        <div className="h-px bg-line" />
      </div>
      {rest.length > 0 && (
        <div className="mt-5">
          <RankList rows={rest} startDelay={1.6} medalPlaces={3} />
        </div>
      )}
    </div>
  );
}

function PodiumColumn({ place, row }: { place: number; row: Row | undefined }) {
  const step = STEP_DELAY[place];
  const first = place === 1;
  return (
    <div className="flex min-w-0 flex-col items-center">
      <div className="hv-podium-pop flex w-full min-w-0 flex-col items-center px-1 text-center" style={delay(step + 0.5)}>
        <span className="relative">
          {row && (
            <span
              role="img"
              aria-label={`Medalha de ${place}º lugar`}
              className={`hv-crown absolute left-1/2 leading-none ${first ? '-top-8 text-3xl' : '-top-6 text-2xl'}`}
              style={delay(first ? 1.45 : step + 0.7)}
            >
              {/* A animação de entrada usa o transform do pai; a inclinação fica no filho. */}
              <span className="block" style={medalTilt(`${row.user_id}-${place}`)}>
                {MEDAL_EMOJI[place - 1]}
              </span>
            </span>
          )}
          <span
            className={`block rounded-full border-2 p-0.5 ${first ? 'hv-champion border-brand' : 'border-line'}`}
            style={first ? delay(1.8) : undefined}
          >
            {row ? (
              <Avatar name={row.user_name} photo={row.user_avatar} size={first ? 'xl' : 'lg'} tone={toneFor(row.user_name)} />
            ) : (
              <span className={`grid place-items-center rounded-full border border-dashed border-line text-muted ${first ? 'h-20 w-20' : 'h-14 w-14'}`} aria-hidden>
                ?
              </span>
            )}
          </span>
        </span>
        {row ? (
          <Dialog.Close asChild>
            <Link
              to={`/pessoas/${row.user_id}`}
              className={`mt-2 block w-full truncate font-bold text-ink transition-colors hover:text-brand ${first ? 'text-base sm:text-lg' : 'text-sm sm:text-base'}`}
            >
              {row.user_name}
            </Link>
          </Dialog.Close>
        ) : (
          <span className="mt-2 block w-full truncate text-sm font-bold text-muted">Vago</span>
        )}
        {row?.is_me && (
          <span className="mt-1">
            <YouChip />
          </span>
        )}
        {row && (
          <span className="mt-1 inline-flex items-center gap-1 text-sm font-bold text-teal">
            <Zap className="h-3.5 w-3.5 fill-current" aria-hidden />
            <CountUp value={row.score} delaySeconds={step + 0.6} /> pts
          </span>
        )}
      </div>
      <div
        className={`hv-podium-step relative mt-3 w-full overflow-hidden rounded-t-xl ${STEP_HEIGHT[place]} ${STEP_BG[place]} ${first ? 'hv-podium-shine' : ''} ${row ? '' : 'opacity-50'}`}
        style={delay(step)}
      >
        <span
          className="absolute left-1/2 top-3 grid h-9 w-9 -translate-x-1/2 place-items-center rounded-full font-display text-base font-bold text-white shadow-card ring-2 ring-white/30"
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

/** seed muda o desenho das peças e delayOffset atrasa a queda (para uma segunda onda). */
function Confetti({ seed = 0, delayOffset = 0 }: { seed?: number; delayOffset?: number }) {
  // Pseudoaleatório fixo por peça: o confete cai igual a cada renderização.
  const pieces = useMemo(
    () =>
      Array.from({ length: 36 }, (_, i) => {
        const rand = (k: number) => {
          const x = Math.sin((i + seed * 101) * 12.9898 + k * 78.233) * 43758.5453;
          return x - Math.floor(x);
        };
        return {
          left: `${rand(1) * 100}%`,
          background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
          borderRadius: rand(6) > 0.7 ? '9999px' : undefined,
          '--x': `${(rand(2) - 0.5) * 120}px`,
          '--r': `${360 + rand(3) * 540}deg`,
          '--d': `${1.3 + delayOffset + rand(4) * 0.6}s`,
          '--t': `${1.8 + rand(5) * 1.4}s`,
        } as CSSProperties;
      }),
    [seed, delayOffset],
  );
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-10">
      {pieces.map((style, i) => (
        <span key={i} className="hv-confetti" style={style} />
      ))}
    </div>
  );
}
