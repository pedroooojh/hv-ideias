import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { MonthlyRanking, MonthlyRunnerUp, WeeklyRanking } from '@/lib/api';
import { RankingDialog } from '../RankingDialog';

const getWeeklyRanking = vi.fn<(weeksAgo?: number) => Promise<WeeklyRanking>>();
const getMonthlyRanking = vi.fn<(monthsAgo?: number) => Promise<MonthlyRanking>>();
const getMonthlyRunnersUp = vi.fn<(monthsAgo?: number) => Promise<MonthlyRunnerUp[]>>();

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getWeeklyRanking: (weeksAgo?: number) => getWeeklyRanking(weeksAgo),
      getMonthlyRanking: (monthsAgo?: number) => getMonthlyRanking(monthsAgo),
      getMonthlyRunnersUp: (monthsAgo?: number) => getMonthlyRunnersUp(monthsAgo),
    },
  };
});

const entry = (rank: number, name: string, score: number, isMe = false) => ({
  rank_position: rank,
  user_id: `id-${rank}`,
  user_name: name,
  user_avatar: null,
  score,
  suggestion_count: 1,
  votes_received: score * 2,
  is_me: isMe,
});

function week(overrides: Partial<WeeklyRanking> = {}): WeeklyRanking {
  return {
    week_start: '2026-10-10T03:00:00Z',
    week_end: '2026-10-17T03:00:00Z',
    is_closing_day: false,
    is_final: false,
    total_count: 4,
    entries: [entry(1, 'Mariana', 3), entry(2, 'Carlos', 2.5, true), entry(3, 'Rafael', 1), entry(4, 'Ana', 0.5)],
    me: { rank_position: 2, score: 2.5, votes_received: 5 },
    ...overrides,
  };
}

function month(overrides: Partial<MonthlyRanking> = {}): MonthlyRanking {
  return {
    month_start: '2026-10-01T03:00:00Z',
    month_end: '2026-11-01T03:00:00Z',
    is_closing_day: false,
    is_final: false,
    total_count: 3,
    entries: [entry(1, 'Mariana', 12), entry(2, 'Carlos', 7.5, true), entry(3, 'Rafael', 3)],
    champion: null,
    me: { rank_position: 2, score: 7.5, votes_received: 6 },
    ...overrides,
  };
}

const champion = {
  user_id: 'id-9',
  user_name: 'Beatriz',
  user_avatar: null,
  score: 21,
  suggestion_count: 4,
  votes_received: 15,
  is_me: false,
};

function renderDialog(view?: 'semana' | 'mes' | 'campeao') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RankingDialog open onOpenChange={() => undefined} view={view} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

beforeEach(() => {
  getWeeklyRanking.mockReset();
  getMonthlyRanking.mockReset();
  getMonthlyRunnersUp.mockReset();
  getMonthlyRunnersUp.mockResolvedValue([]);
  // Sem animação: os pontos aparecem já no valor final.
  window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

describe('RankingDialog', () => {
  it('na sexta mostra o pódio do fechamento com o top 3 e o restante em lista', async () => {
    getWeeklyRanking.mockResolvedValue(week({ is_closing_day: true }));
    renderDialog();

    expect(await screen.findByText(/Fechamento da semana/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '10 a 16 de out.' })).toBeInTheDocument();
    expect(screen.getByText('Encerra hoje às 23h59')).toBeInTheDocument();
    // Pódio com medalhas; a coroa fica só para o campeão do mês.
    expect(screen.getByRole('img', { name: 'Medalha de 1º lugar' })).toBeInTheDocument();
    for (const name of ['Mariana', 'Carlos', 'Rafael', 'Ana']) expect(screen.getByText(name)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Repetir animação/ })).toBeInTheDocument();
    // Rodapé: os pontos e a posição de quem está vendo.
    expect(screen.getByText('#2')).toBeInTheDocument();
  });

  it('nos outros dias mostra a lista e abre o último fechamento gravado', async () => {
    getWeeklyRanking.mockImplementation(async (weeksAgo = 0) =>
      weeksAgo === 0
        ? week()
        : week({ week_start: '2026-10-03T03:00:00Z', week_end: '2026-10-10T03:00:00Z', is_final: true }),
    );
    renderDialog();

    expect(await screen.findByText('Pódio na sexta')).toBeInTheDocument();
    expect(screen.queryByText(/Fechamento da semana/)).not.toBeInTheDocument();
    for (const place of [1, 2, 3]) expect(screen.getByRole('img', { name: `Medalha de ${place}º lugar` })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Último fechamento/ }));

    expect(await screen.findByText('Resultado gravado')).toBeInTheDocument();
    expect(screen.getByText(/3 a 9 de out\./)).toBeInTheDocument();
    expect(getWeeklyRanking).toHaveBeenCalledWith(1);
  });

  it('avisa quando ninguém pontuou na semana', async () => {
    getWeeklyRanking.mockResolvedValue(week({ entries: [], total_count: 0, me: { rank_position: null, score: 0, votes_received: 0 } }));
    renderDialog();
    expect(await screen.findByText(/Ninguém pontuou nesta semana ainda/)).toBeInTheDocument();
    expect(screen.getByText('sem posição')).toBeInTheDocument();
  });

  it('no mês mostra a parcial sem pódio e abre o último campeão', async () => {
    getMonthlyRanking.mockImplementation(async (monthsAgo = 0) =>
      monthsAgo === 0
        ? month()
        : month({
            month_start: '2026-09-01T03:00:00Z',
            month_end: '2026-10-01T03:00:00Z',
            is_final: true,
            entries: [],
            champion,
          }),
    );
    renderDialog();
    fireEvent.click(screen.getByRole('tab', { name: /Este mês/ }));

    expect(await screen.findByText('Campeão definido no último dia')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Outubro de 2026' })).toBeInTheDocument();
    for (const name of ['Mariana', 'Carlos', 'Rafael']) expect(screen.getByText(name)).toBeInTheDocument();
    // Na parcial o 1º leva a medalha de líder: a coroa e o título ficam para o fechamento.
    expect(screen.getByRole('img', { name: 'Líder do mês' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Repetir animação/ })).not.toBeInTheDocument();
    expect(screen.getByText('#2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Último campeão/ }));
    expect(await screen.findByText('Beatriz')).toBeInTheDocument();
    expect(screen.getAllByText(/Campeão de setembro de 2026/).length).toBeGreaterThan(0);
    expect(screen.queryByText('Mariana')).not.toBeInTheDocument();
    expect(getMonthlyRanking).toHaveBeenCalledWith(1);
  });

  it('abre direto no campeão do mês (dia 1º ou notificação)', async () => {
    getMonthlyRanking.mockImplementation(async (monthsAgo = 0) =>
      monthsAgo === 0 ? month() : month({ is_final: true, entries: [], champion: { ...champion, is_me: true } }),
    );
    renderDialog('campeao');
    expect(await screen.findByText('Beatriz')).toBeInTheDocument();
    expect(screen.getByText('você')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Este mês/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('mostra quem quase foi campeão logo abaixo, com a distância até o 1º lugar', async () => {
    getMonthlyRanking.mockImplementation(async (monthsAgo = 0) =>
      monthsAgo === 0 ? month() : month({ is_final: true, entries: [], champion }),
    );
    const runner = (rank: number, name: string, score: number, isMe = false) => ({
      ...champion,
      rank_position: rank,
      user_id: `runner-${rank}`,
      user_name: name,
      score,
      is_me: isMe,
    });
    getMonthlyRunnersUp.mockResolvedValue([runner(2, 'Caio', 18.5, true), runner(3, 'Davi', 12), runner(4, 'Eva', 4)]);
    renderDialog('campeao');

    expect(await screen.findByText('Beatriz')).toBeInTheDocument();
    const list = screen.getByRole('region', { name: 'Quase lá' });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      expect.stringContaining('Caio'),
      expect.stringContaining('Davi'),
      expect.stringContaining('Eva'),
    ]);
    expect(within(list).getByRole('img', { name: '2º lugar' })).toBeInTheDocument();
    expect(within(list).getByText('a 2,5 pts do 1º')).toBeInTheDocument();
    expect(within(list).getByText('a 17 pts do 1º')).toBeInTheDocument();
    expect(within(list).getByText('você')).toBeInTheDocument();
    expect(getMonthlyRunnersUp).toHaveBeenCalledWith(1);
  });

  it('sem ninguém atrás do campeão, não mostra a lista', async () => {
    getMonthlyRanking.mockImplementation(async (monthsAgo = 0) =>
      monthsAgo === 0 ? month() : month({ is_final: true, entries: [], champion }),
    );
    renderDialog('campeao');
    expect(await screen.findByText('Beatriz')).toBeInTheDocument();
    expect(screen.queryByText('Quase lá')).not.toBeInTheDocument();
  });

  it('no último dia do mês avisa o fechamento', async () => {
    getMonthlyRanking.mockResolvedValue(month({ is_closing_day: true }));
    renderDialog('mes');
    expect(await screen.findByText(/Fechamento do mês/)).toBeInTheDocument();
    expect(screen.getByText(/o 1º lugar é o campeão/)).toBeInTheDocument();
  });
});
