import { Link } from 'react-router-dom';
import { PersonLink } from './PersonLink';
import { ArrowRight, MessageSquare } from 'lucide-react';
import type { SuggestionListItem } from '@/lib/api';
import { formatDate, plural } from '@/lib/format';
import { Avatar, SuggestionStatusChip, TypeChip, toneFor } from './ui';
import { RichText } from './RichText';
import { VoteButton } from './VoteButton';

/** A partir deste tamanho a descrição aparece resumida e o link vira "Ler mais detalhes". */
const LONG_DESCRIPTION = 280;

export function SuggestionCard({ suggestion: s }: { suggestion: SuggestionListItem }) {
  const isLong = s.description.length > LONG_DESCRIPTION || s.description.split('\n').length > 4;
  return (
    <article className="card flex animate-fade-in gap-4 p-5 sm:gap-6 sm:p-8" aria-labelledby={`sug-${s.id}`}>
      <div className="shrink-0">
        <VoteButton
          suggestionId={s.id}
          projectId={s.project_id}
          voteCount={Number(s.vote_count)}
          hasVoted={s.has_voted}
          isAuthor={s.is_author}
          votingOpen={s.voting_open}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <TypeChip slug={s.type} label={s.type_label} />
            <SuggestionStatusChip status={s.status} />
          </div>
          <time dateTime={s.created_at} className="text-sm text-muted">
            {formatDate(s.created_at)}
          </time>
        </div>
        <h3 id={`sug-${s.id}`} className="mt-2.5 text-lg font-bold leading-snug tracking-tight text-ink sm:text-xl">
          <Link to={`/sugestoes/${s.id}`} className="hover:text-brand">
            {s.title}
          </Link>
        </h3>
        <p className={`mt-3 whitespace-pre-line break-words text-[0.9375rem] leading-relaxed text-muted sm:text-base ${isLong ? 'line-clamp-4' : ''}`}>
          <RichText text={s.description} />
        </p>
        {s.status === 'nao_aprovado' && s.status_reason && (
          <p className="mt-3 rounded-xl bg-danger/5 px-3.5 py-2.5 text-sm text-ink">
            <strong className="text-danger">Motivo: </strong>
            <span className="line-clamp-2">{s.status_reason}</span>
          </p>
        )}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-4">
          <Link
            to={isLong ? `/sugestoes/${s.id}` : `/sugestoes/${s.id}#discussao`}
            className="inline-flex items-center gap-1.5 font-bold text-brand hover:underline"
            aria-label={`${isLong ? 'Ler mais detalhes' : 'Ver discussão'}: ${s.title}`}
          >
            {isLong ? 'Ler mais detalhes' : 'Ver discussão'} <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted sm:text-[0.9375rem]">
            <span className="inline-flex items-center gap-2">
              <MessageSquare className="h-4 w-4" aria-hidden />
              {plural(s.comment_count, 'comentário', 'comentários')}
            </span>
            <PersonLink id={s.author_id} className="inline-flex items-center gap-2">
              <Avatar name={s.author_name} photo={s.author_avatar} tone={toneFor(s.author_name)} />
              <span className="text-ink/80">{s.author_name}</span>
              {s.is_author && <span className="chip bg-brand-soft py-0.5 text-[0.6875rem] text-brand">você</span>}
            </PersonLink>
          </div>
        </div>
      </div>
    </article>
  );
}
