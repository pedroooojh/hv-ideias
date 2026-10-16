import { Link, useParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ChevronRight, Lightbulb, MessageSquare, ThumbsUp, UserRound } from 'lucide-react';
import { api, qk } from '@/lib/api';
import { toApiError } from '@/lib/errors';
import { formatDate, formatNumber } from '@/lib/format';
import { usePageTitle } from '@/lib/navigation';
import { ProfileHero } from '@/components/ProfileHero';
import { Avatar, EmptyState, ErrorState, LoadMore, PageContainer, Skeleton, SuggestionStatusChip, toneFor } from '@/components/ui';

export function PublicProfilePage() {
  const { userId = '' } = useParams();
  const profile = useQuery({ queryKey: qk.publicProfile(userId), queryFn: () => api.getPublicProfile(userId) });
  usePageTitle(profile.data?.name ?? 'Perfil');
  const firstName = profile.data?.name.split(/\s+/)[0];

  if (profile.isError && !profile.data) {
    const notFound = toApiError(profile.error).kind === 'not_found';
    return (
      <PageContainer narrow back={{ to: '/', label: 'Início' }}>
        {notFound ? (
          <EmptyState icon={<UserRound className="h-6 w-6" />} title="Perfil não encontrado">
            A conta pode ter sido desativada ou o endereço está incorreto.
          </EmptyState>
        ) : (
          <ErrorState error={profile.error} onRetry={() => profile.refetch()} />
        )}
      </PageContainer>
    );
  }

  return (
    <PageContainer narrow back={{ to: '/', label: 'Início' }}>
      {profile.isPending ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : (
        <ProfileHero
          eyebrow={profile.data.is_me ? 'Seu perfil público' : 'Perfil'}
          name={profile.data.name}
          avatar={
            <span className="shrink-0 rounded-full ring-4 ring-surface">
              <Avatar name={profile.data.name} photo={profile.data.avatar_path} size="xl" tone={toneFor(profile.data.name)} />
            </span>
          }
          subtitle={<span>Participa desde {formatDate(profile.data.member_since)}</span>}
          data={profile.data}
          action={
            profile.data.is_me && (
              <Link to="/perfil" className="btn-secondary px-3 py-2">
                Editar meu perfil
              </Link>
            )
          }
        />
      )}

      <section className="card mt-6 flex flex-col p-6" aria-labelledby="sugestoes-pessoa">
        <h2 id="sugestoes-pessoa" className="flex items-center gap-2 text-lg font-bold text-ink">
          {profile.data?.is_me ? 'Suas sugestões' : firstName ? `Sugestões de ${firstName}` : 'Sugestões'}
          {profile.data && <span className="chip bg-subtle py-0.5 text-muted">{formatNumber(profile.data.suggestion_count)}</span>}
        </h2>
        <UserSuggestions userId={userId} />
      </section>
    </PageContainer>
  );
}

function UserSuggestions({ userId }: { userId: string }) {
  const list = useInfiniteQuery({
    queryKey: qk.userSuggestions(userId),
    queryFn: ({ pageParam }) => api.listUserSuggestions(userId, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  if (list.isPending) {
    return (
      <div className="mt-4 space-y-3">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    );
  }
  if (list.isError && !list.data) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;
  if (items.length === 0) {
    return (
      <div className="mt-4">
        <EmptyState icon={<Lightbulb className="h-6 w-6" />} title="Nenhuma sugestão publicada ainda" />
      </div>
    );
  }

  return (
    <div className="hv-scroll -mx-6 mt-3 max-h-[34rem] overflow-y-auto px-6">
      <ul className="animate-fade-in divide-y divide-line">
        {items.map((s) => (
          <li key={s.id}>
            <Link
              to={`/sugestoes/${s.id}`}
              className="group -mx-3 flex items-center justify-between gap-4 rounded-xl px-3 py-3.5 transition-colors duration-200 hover:bg-subtle/70"
            >
              <div className="min-w-0">
                <p className="truncate font-semibold text-ink group-hover:text-brand">{s.title}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                  <SuggestionStatusChip status={s.status} />
                  <span className="truncate">{s.project_name}</span>
                  <span aria-hidden>·</span>
                  <span>{formatDate(s.created_at)}</span>
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-xs text-muted">
                <span className="inline-flex items-center gap-1" title="Votos">
                  <ThumbsUp className="h-3.5 w-3.5" aria-hidden /> {formatNumber(s.vote_count)}
                </span>
                <span className="inline-flex items-center gap-1" title="Comentários">
                  <MessageSquare className="h-3.5 w-3.5" aria-hidden /> {formatNumber(s.comment_count)}
                </span>
                <ChevronRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
              </div>
            </Link>
          </li>
        ))}
      </ul>
      <LoadMore hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()} />
    </div>
  );
}
