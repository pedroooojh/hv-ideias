import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { WeeklyRanking } from '@/lib/api';
import { RankingDialog } from '../RankingDialog';

const getWeeklyRanking = vi.fn<(weeksAgo?: number) => Promise<WeeklyRanking>>();

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getWeeklyRanking: (weeksAgo?: number) => getWeeklyRanking(weeksAgo),
      getRanking: vi.fn(async () => ({ items: [], total: 0, nextOffset: null })),
      getMyScore: vi.fn(async () => ({ rank_position: null, score: 0, suggestion_count: 0, votes_received: 0 })),
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

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RankingDialog open onOpenChange={() => undefined} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

beforeEach(() => {
  getWeeklyRanking.mockReset();
  // Sem animação: os pontos aparecem já no valor final.
  window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

describe('RankingDialog', () => {
  it('na sexta mostra o pódio do fechamento com o top 3 e o restante em lista', async () => {
    getWeeklyRanking.mockResolvedValue(week({ is_closing_day: true }));
    renderDialog();

    expect(await screen.findByText('Fechamento da semana')).toBeInTheDocument();
    expect(screen.getByText(/10 a 16 de out\. · encerra hoje/)).toBeInTheDocument();
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

    expect(await screen.findByText('fecha na sexta')).toBeInTheDocument();
    expect(screen.queryByText('Fechamento da semana')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Último fechamento/ }));

    expect(await screen.findByText(/resultado gravado/)).toBeInTheDocument();
    expect(screen.getByText(/3 a 9 de out\./)).toBeInTheDocument();
    expect(getWeeklyRanking).toHaveBeenCalledWith(1);
  });

  it('avisa quando ninguém pontuou na semana', async () => {
    getWeeklyRanking.mockResolvedValue(week({ entries: [], total_count: 0, me: { rank_position: null, score: 0, votes_received: 0 } }));
    renderDialog();
    expect(await screen.findByText(/Ninguém pontuou nesta semana ainda/)).toBeInTheDocument();
    expect(screen.getByText('sem posição')).toBeInTheDocument();
  });
});
