import { useId, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, MessageSquare, Pencil, Trash2 } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { api, qk, type CommentItem } from '@/lib/api';
import { LIMITS, lengthError } from '@/lib/domain';
import { errorMessage } from '@/lib/errors';
import { formatDateTime, plural } from '@/lib/format';
import { useBeforeUnloadGuard } from '@/lib/unsavedChanges';
import { ConfirmDialog, DiscardChangesDialog } from './Modal';
import { RichText } from './RichText';
import { useToast } from './Toast';
import { PersonLink } from './PersonLink';
import { Avatar, CharCounter, ErrorState, LoadMore, Skeleton, toneFor } from './ui';

interface Props {
  suggestionId: string;
  projectId: string;
  commentCount: number;
}

export function Comments({ suggestionId, projectId, commentCount }: Props) {
  const { canParticipate, user } = useAuth();
  const location = useLocation();
  const query = useInfiniteQuery({
    queryKey: qk.comments(suggestionId),
    queryFn: ({ pageParam }) => api.listComments(suggestionId, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <section
      id="discussao"
      className="card mt-6 scroll-mt-[calc(var(--header-h,6rem)+1rem)] p-6 sm:p-8"
      aria-labelledby="comentarios-titulo"
    >
      <h2 id="comentarios-titulo" className="flex items-center gap-2 text-xl font-bold text-ink">
        <MessageSquare className="h-5 w-5 text-muted" aria-hidden />
        Discussão <span className="text-base font-medium text-muted">({plural(commentCount, 'comentário', 'comentários')})</span>
      </h2>

      <div className="mt-6">
        {query.isPending ? (
          <div className="space-y-4">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : query.isError && !query.data ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} title="Não foi possível carregar os comentários" />
        ) : items.length === 0 ? (
          <p className="rounded-lg bg-subtle px-4 py-6 text-center text-sm text-muted">
            Nenhum comentário ainda. Comece a discussão!
          </p>
        ) : (
          <ul className="animate-fade-in space-y-5">
            {items.map((c) => (
              <CommentRow key={c.id} comment={c} suggestionId={suggestionId} projectId={projectId} />
            ))}
          </ul>
        )}
        <LoadMore hasMore={query.hasNextPage} loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()} label="Carregar mais comentários" />
      </div>

      <div className="mt-8 border-t border-line pt-6">
        {canParticipate ? (
          <CommentForm suggestionId={suggestionId} projectId={projectId} />
        ) : user ? (
          <p className="text-sm text-muted">Sua conta não pode comentar no momento.</p>
        ) : (
          <p className="text-sm text-muted">
            <Link to="/entrar" state={{ from: location.pathname }} className="font-semibold text-brand hover:underline">
              Entre
            </Link>{' '}
            para participar da discussão.
          </p>
        )}
      </div>
    </section>
  );
}

function useInvalidateComments(suggestionId: string, projectId: string) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: qk.comments(suggestionId) });
    queryClient.invalidateQueries({ queryKey: qk.suggestion(suggestionId) });
    queryClient.invalidateQueries({ queryKey: qk.suggestions(projectId) });
  };
}

function CommentForm({ suggestionId, projectId }: { suggestionId: string; projectId: string }) {
  const id = useId();
  const toast = useToast();
  const invalidate = useInvalidateComments(suggestionId, projectId);
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  useBeforeUnloadGuard(content.trim() !== '');

  const mutation = useMutation({
    mutationFn: (text: string) => api.createComment(suggestionId, text),
    onSuccess: () => {
      setContent('');
      invalidate();
      toast.success('Comentário publicado.');
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const problem = lengthError(content, 'Comentário', LIMITS.comment);
    setError(problem);
    if (!problem) mutation.mutate(content.trim());
  };

  return (
    <form onSubmit={submit} noValidate>
      <div className="flex items-end justify-between">
        <label htmlFor={`${id}-comment`} className="field-label">
          Adicionar comentário
        </label>
        <CharCounter value={content} max={LIMITS.comment.max} />
      </div>
      <textarea
        id={`${id}-comment`}
        className="field-input min-h-[96px] resize-y"
        value={content}
        onChange={(e) => {
          setContent(e.target.value);
          if (error) setError(null);
        }}
        placeholder="Compartilhe sua opinião, um caso de uso ou uma dúvida."
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-comment-error` : undefined}
      />
      {error && (
        <p id={`${id}-comment-error`} className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="mt-3 flex justify-end">
        <button type="submit" className="btn-primary" disabled={mutation.isPending}>
          {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Comentar
        </button>
      </div>
    </form>
  );
}

function CommentRow({ comment: c, suggestionId, projectId }: { comment: CommentItem; suggestionId: string; projectId: string }) {
  const id = useId();
  const toast = useToast();
  const invalidate = useInvalidateComments(suggestionId, projectId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.content ?? '');
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const draftDirty = editing && draft.trim() !== (c.content ?? '').trim();
  useBeforeUnloadGuard(draftDirty);

  const save = useMutation({
    mutationFn: (text: string) => api.updateComment(c.id, text),
    onSuccess: () => {
      setEditing(false);
      invalidate();
      toast.success('Comentário atualizado.');
    },
    onError: (err) => setError(errorMessage(err)),
  });

  if (c.is_deleted) {
    return (
      <li className="rounded-lg border border-dashed border-line px-4 py-3 text-sm italic text-muted">
        {c.deletion_reason === 'moderation' ? 'Comentário removido pela moderação.' : 'Comentário removido pelo autor.'}
        <span className="ml-2 not-italic">· {formatDateTime(c.created_at)}</span>
      </li>
    );
  }

  const stopEditing = () => {
    setEditing(false);
    setDraft(c.content ?? '');
    setError(null);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const problem = lengthError(draft, 'Comentário', LIMITS.comment);
    setError(problem);
    if (!problem) save.mutate(draft.trim());
  };

  return (
    <li className="flex gap-3">
      <PersonLink id={c.author_id} className="shrink-0 self-start rounded-full">
        <Avatar name={c.author_name} photo={c.author_avatar} size="md" tone={toneFor(c.author_name)} />
      </PersonLink>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 text-sm">
          <PersonLink id={c.author_id} className="font-semibold text-ink">
            {c.author_name}
          </PersonLink>
          {c.is_author && <span className="chip bg-brand-soft py-0.5 text-[11px] text-brand">você</span>}
          <time dateTime={c.created_at} className="text-muted">
            {formatDateTime(c.created_at)}
          </time>
          {c.edited_at && <span className="text-muted">(editado)</span>}
        </div>
        {editing ? (
          <form onSubmit={submit} noValidate className="mt-2 animate-fade-in">
            <label htmlFor={`${id}-edit`} className="sr-only">
              Editar comentário
            </label>
            <textarea
              id={`${id}-edit`}
              className="field-input min-h-[80px]"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? `${id}-edit-error` : undefined}
            />
            {error && (
              <p id={`${id}-edit-error`} className="field-error" role="alert">
                {error}
              </p>
            )}
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                className="btn-ghost px-3 py-1.5"
                onClick={() => (draftDirty ? setDiscardOpen(true) : stopEditing())}
              >
                Cancelar
              </button>
              <button type="submit" className="btn-primary px-3 py-1.5" disabled={save.isPending}>
                {save.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                Salvar
              </button>
            </div>
          </form>
        ) : (
          <p className="mt-1 animate-fade-in whitespace-pre-line break-words text-ink/85">
            <RichText text={c.content ?? ''} />
          </p>
        )}
        {!editing && (c.can_edit || c.can_delete) && (
          <div className="mt-1.5 flex animate-fade-in gap-3 text-xs">
            {c.can_edit && (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-muted hover:text-ink"
                onClick={() => {
                  setDraft(c.content ?? '');
                  setEditing(true);
                }}
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden /> Editar
              </button>
            )}
            {c.can_delete && (
              <button type="button" className="inline-flex items-center gap-1 text-muted hover:text-danger" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden /> {c.is_author ? 'Excluir' : 'Remover (moderação)'}
              </button>
            )}
          </div>
        )}
      </div>
      <DiscardChangesDialog open={discardOpen} onOpenChange={setDiscardOpen} onDiscard={stopEditing} />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={c.is_author ? 'Excluir comentário?' : 'Remover comentário?'}
        confirmLabel={c.is_author ? 'Excluir' : 'Remover'}
        description={
          c.is_author
            ? 'O conteúdo deixará de ser exibido. Um marcador indicará que o comentário foi removido, para manter o contexto da discussão.'
            : 'O conteúdo será ocultado e substituído por "Comentário removido pela moderação". A ação fica registrada na auditoria.'
        }
        onConfirm={async () => {
          await api.deleteComment(c.id);
          invalidate();
          toast.success('Comentário removido.');
        }}
      />
    </li>
  );
}
