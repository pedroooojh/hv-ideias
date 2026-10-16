import type { ReactNode } from 'react';
import { Medal } from 'lucide-react';
import type { Medals, PublicProfile } from '@/lib/api';
import { formatNumber, formatPoints } from '@/lib/format';
import { Skeleton } from './ui';

const MEDAL_STYLE = [
  { key: 'gold', label: '1º lugar', color: '#d4a017' },
  { key: 'silver', label: '2º lugar', color: '#9aa4b2' },
  { key: 'bronze', label: '3º lugar', color: '#c07a3f' },
] as const;

const hasMedals = (data: PublicProfile | undefined) =>
  Boolean(data && data.medals.gold + data.medals.silver + data.medals.bronze > 0);

/** Medalhas dos fechamentos semanais; não aparece enquanto a pessoa não tiver nenhuma. */
export function MedalRow({ medals }: { medals: Medals }) {
  const total = medals.gold + medals.silver + medals.bronze;
  if (total === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Medalhas no ranking semanal">
      {MEDAL_STYLE.filter((m) => medals[m.key] > 0).map((m) => (
        <li
          key={m.key}
          className="chip border border-line bg-surface py-0.5 text-ink"
          title={`${medals[m.key]}× ${m.label} no ranking da semana`}
        >
          <Medal className="h-3.5 w-3.5" style={{ color: m.color }} aria-hidden />
          {formatNumber(medals[m.key])}× {m.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * Topo de perfil (o próprio e o público): foto metade sobre o banner, nome, linha
 * de apoio, medalhas e os números da pessoa centrados na borda do banner.
 */
export function ProfileHero({
  avatar,
  eyebrow,
  name,
  subtitle,
  data,
  action,
  footer,
}: {
  avatar: ReactNode;
  eyebrow: string;
  name: string;
  subtitle?: ReactNode;
  data: PublicProfile | undefined;
  action?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="card overflow-hidden" aria-label={eyebrow}>
      <div className="h-20 bg-gradient-to-r from-brand/25 via-teal/15 to-transparent sm:h-24" aria-hidden />
      {/* relative: a foto e os números sobem sobre o banner e precisam ser pintados por cima dele. */}
      <div className="relative flex flex-col gap-6 px-6 pb-6 sm:px-8 lg:flex-row lg:items-start lg:justify-between">
        <div className="-mt-10 flex min-w-0 items-end gap-4 sm:gap-5">
          {avatar}
          <div className="min-w-0 pb-1">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">{eyebrow}</p>
            <h1 className="truncate text-2xl font-bold tracking-tight text-ink sm:text-3xl">{name}</h1>
            {subtitle && <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">{subtitle}</div>}
          </div>
        </div>

        {/* No desktop os números ficam centrados na borda do banner, como a foto. */}
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:-mt-[2.125rem] lg:min-w-[26rem]">
          {!data ? (
            [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[4.25rem] rounded-xl" />)
          ) : (
            <>
              <Stat label="Posição geral" value={data.rank_position ? `${data.rank_position}º` : '—'} highlight />
              <Stat label="Pontos" value={formatPoints(data.score)} />
              <Stat label="Na semana" value={formatPoints(data.weekly_score)} />
              <Stat label="Votos recebidos" value={formatNumber(data.votes_received)} />
            </>
          )}
        </dl>
      </div>
      {(hasMedals(data) || action) && (
        <div className="-mt-3 flex flex-wrap items-center justify-between gap-3 px-6 pb-6 sm:px-8">
          {data && hasMedals(data) ? <MedalRow medals={data.medals} /> : <span />}
          {action}
        </div>
      )}
      {footer}
    </section>
  );
}

function Stat({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      className={`h-[4.25rem] animate-fade-in rounded-xl border px-4 py-3 shadow-card ${
        highlight ? 'border-brand bg-brand text-white dark:text-page' : 'border-line bg-subtle'
      }`}
    >
      <dt className={`text-xs ${highlight ? 'text-white/80 dark:text-page/80' : 'text-muted'}`}>{label}</dt>
      <dd className={`font-display text-xl font-bold ${highlight ? '' : 'text-ink'}`}>{value}</dd>
    </div>
  );
}
