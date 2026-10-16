import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronUp, Loader2 } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { api, qk, type Page, type SuggestionDetail, type SuggestionListItem } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatNumber } from '@/lib/format';
import { useToast } from './Toast';

interface VoteButtonProps {
  suggestionId: string;
  projectId: string;
  voteCount: number;
  hasVoted: boolean;
  isAuthor: boolean;
  votingOpen: boolean;
  layout?: 'vertical' | 'horizontal';
}

export function VoteButton({
  suggestionId,
  projectId,
  voteCount,
  hasVoted,
  isAuthor,
  votingOpen,
  layout = 'vertical',
}: VoteButtonProps) {
  const { user, canParticipate } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const mutation = useMutation({
    // Envia o estado desejado (não um "toggle"): cliques repetidos não invertem o voto.
    mutationFn: (vote: boolean) => api.setVote(suggestionId, vote),
    onSuccess: (result) => {
      // Usa a contagem devolvida pelo servidor, não um cálculo local.
      const patch = <T extends { id: string; vote_count: number; has_voted: boolean }>(item: T): T =>
        item.id === suggestionId ? { ...item, vote_count: result.vote_count, has_voted: result.has_voted } : item;
      queryClient.setQueriesData<InfiniteData<Page<SuggestionListItem>>>({ queryKey: qk.suggestions(projectId) }, (data) =>
        data ? { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map(patch) })) } : data,
      );
      queryClient.setQueryData<SuggestionDetail>(qk.suggestion(suggestionId), (data) => (data ? patch(data) : data));
      for (const key of [qk.stats, qk.projects, qk.project(projectId), qk.ranking, qk.myScore, qk.publicProfiles, qk.userSuggestionLists]) {
        queryClient.invalidateQueries({ queryKey: key });
      }
    },
    onError: (err) => {
      toast.error(errorMessage(err));
      // Em caso de erro, recarrega o estado real para não exibir números divergentes.
      queryClient.invalidateQueries({ queryKey: qk.suggestions(projectId) });
      queryClient.invalidateQueries({ queryKey: qk.suggestion(suggestionId) });
    },
  });

  let disabledReason: string | null = null;
  if (user && !canParticipate) disabledReason = 'Sua conta não pode votar no momento.';
  else if (isAuthor) disabledReason = 'Você não pode votar na sua própria sugestão.';
  else if (!votingOpen && !hasVoted) disabledReason = 'A votação desta sugestão está encerrada.';

  const onClick = () => {
    if (!user) {
      navigate('/entrar', { state: { from: location.pathname + location.search } });
      return;
    }
    if (disabledReason || mutation.isPending) return;
    mutation.mutate(!hasVoted);
  };

  const votesLabel = `${formatNumber(voteCount)} ${Number(voteCount) === 1 ? 'voto' : 'votos'}`;
  const actionLabel = !user
    ? `Entrar para votar (${votesLabel})`
    : disabledReason
      ? `${votesLabel}. ${disabledReason}`
      : hasVoted
        ? `Retirar meu voto (${votesLabel})`
        : `Votar nesta sugestão (${votesLabel})`;

  const base =
    'group inline-flex items-center justify-center rounded-lg font-display font-semibold transition-colors duration-200 disabled:cursor-not-allowed';
  const tone = hasVoted
    ? 'bg-brand text-white shadow-[0_8px_18px_-8px_rgb(var(--brand)/0.8)] hover:bg-brand-strong dark:text-page'
    : 'bg-subtle text-navy hover:bg-brand-soft hover:text-brand disabled:hover:bg-subtle disabled:hover:text-navy';
  const shape =
    layout === 'vertical' ? 'h-[5rem] w-[3.5rem] flex-col gap-0.5 text-base sm:h-[5.5rem] sm:w-[4rem] sm:text-lg' : 'h-11 gap-2 px-4 text-base';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={Boolean(user && disabledReason) || mutation.isPending}
      aria-pressed={user ? hasVoted : undefined}
      aria-label={actionLabel}
      title={disabledReason ?? (hasVoted ? 'Clique para retirar seu voto' : 'Apoiar esta sugestão')}
      className={`${base} ${tone} ${shape} ${Boolean(user && disabledReason) ? 'opacity-60' : ''}`}
    >
      {mutation.isPending ? (
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
      ) : (
        <ChevronUp className="h-5 w-5" strokeWidth={2.5} aria-hidden />
      )}
      <span>{formatNumber(voteCount)}</span>
      {layout === 'horizontal' && (
        <span className="text-sm font-semibold">{hasVoted ? 'Você apoiou' : 'Apoiar'}</span>
      )}
    </button>
  );
}
