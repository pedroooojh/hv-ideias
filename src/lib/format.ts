const dateFormatter = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const numberFormatter = new Intl.NumberFormat('pt-BR');
const pointsFormatter = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const formatDate = (value: string | Date) => dateFormatter.format(new Date(value));
export const formatDateTime = (value: string | Date) => dateTimeFormatter.format(new Date(value));
export const formatNumber = (value: number | string) => numberFormatter.format(Number(value));
export const formatPoints = (value: number | string) => pointsFormatter.format(Number(value));

/** "hoje", "ontem", "há 3 dias", "há 2 meses"… */
export function formatRelative(value: string | Date, now: Date = new Date()): string {
  const date = new Date(value);
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(date)) / 86_400_000);
  if (days <= 0) return 'hoje';
  if (days === 1) return 'ontem';
  if (days < 30) return `há ${days} dias`;
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? 'há 1 mês' : `há ${months} meses`;
  const years = Math.floor(days / 365);
  return years <= 1 ? 'há 1 ano' : `há ${years} anos`;
}

export function plural(count: number | string, singular: string, pluralForm: string): string {
  const n = Number(count);
  return `${formatNumber(n)} ${n === 1 ? singular : pluralForm}`;
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Fuso do ranking semanal: a semana fecha na sexta, no horário de Brasília. */
export const RANKING_TZ = 'America/Sao_Paulo';
const weekDayFormatter = new Intl.DateTimeFormat('pt-BR', { timeZone: RANKING_TZ, day: 'numeric' });
const weekMonthFormatter = new Intl.DateTimeFormat('pt-BR', { timeZone: RANKING_TZ, month: 'short' });
const weekdayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: RANKING_TZ, weekday: 'short' });
const dayKeyFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: RANKING_TZ });

/** "10 a 16 de out." ou "27 de set. a 3 de out." — o fim é exclusivo (sábado 00:00 seguinte). */
export function formatWeekRange(start: string | Date, endExclusive: string | Date): string {
  const from = new Date(start);
  const to = new Date(new Date(endExclusive).getTime() - 1);
  const month = (d: Date) => weekMonthFormatter.format(d).replace(/\.?$/, '.');
  const sameMonth = month(from) === month(to);
  return sameMonth
    ? `${weekDayFormatter.format(from)} a ${weekDayFormatter.format(to)} de ${month(to)}`
    : `${weekDayFormatter.format(from)} de ${month(from)} a ${weekDayFormatter.format(to)} de ${month(to)}`;
}

/** Sexta-feira no horário de Brasília: dia do fechamento do ranking semanal. */
export const isRankingClosingDay = (now: Date = new Date()) => weekdayFormatter.format(now) === 'Fri';

/** Data no fuso do ranking (AAAA-MM-DD), para marcar "já vi o fechamento de hoje". */
export const rankingDayKey = (now: Date = new Date()) => dayKeyFormatter.format(now);
