import type { AreaScore } from '@/lib/api';
import { formatPoints } from '@/lib/format';

const percent = (weight: number) => `${Math.round(Number(weight) * 100)}%`;

/** "SQL & Relatórios: 6,0 × 100% · Integrações: 4,0 × 50%" — para dicas e leitores de tela. */
export const describeAreas = (areas: AreaScore[]) =>
  areas.map((a) => `${a.area}: ${formatPoints(a.points)} × ${percent(a.weight)}`).join(' · ');

/**
 * Composição dos pontos do mês por área (categoria do projeto): a área mais forte
 * vale 100%, a 2ª 50% e as demais 25%. Não aparece sem pontos no mês.
 */
export function AreaBreakdown({ areas, className = '' }: { areas: AreaScore[]; className?: string }) {
  if (areas.length === 0) return null;
  return (
    <ul className={`flex flex-wrap gap-1.5 ${className}`} aria-label="Pontos do mês por área">
      {areas.map((a) => (
        <li
          key={a.area}
          className="chip border border-line bg-surface py-0.5 text-ink"
          title={`${formatPoints(a.points)} pts × ${percent(a.weight)} = ${formatPoints(a.score)} pts`}
        >
          <span className="max-w-[12rem] truncate font-semibold">{a.area}</span>
          <span className="text-muted">
            {formatPoints(a.points)} × {percent(a.weight)}
          </span>
        </li>
      ))}
    </ul>
  );
}
