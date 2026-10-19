import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, FolderOpen, History, Lock, MessageSquare, Pencil, RefreshCcw, Trash2 } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { api, qk } from '@/lib/api';
import { toApiError } from '@/lib/errors';
import { SELECTED_STATUSES, SUGGESTION_STATUS } from '@/lib/domain';
import { formatDate, formatDateTime, plural } from '@/lib/format';
import { usePageTitle } from '@/lib/navigation';
import { Comments } from '@/components/Comments';
import { RichText } from '@/components/RichText';
import { ConfirmDialog } from '@/components/Modal';
import { StatusDialog } from '@/components/StatusDialog';
import { SuggestionFormDialog } from '@/components/SuggestionFormDialog';
import { useToast } from '@/components/Toast';
import { PersonLink } from '@/components/PersonLink';
import { Avatar, ErrorState, PageContainer, Skeleton, SuggestionStatusChip, TypeChip, toneFor } from '@/components/ui';
import { VoteButton } from '@/components/VoteButton';

/**
 * Hierarquia da página: 1) a sugestão (problemática), no mesmo formato do cartão da
 * listagem; 2) a discussão, logo abaixo; 3) o histórico de status, como registro.
 */
export function SuggestionPage() {
  const { suggestionId = '' } = useParams();
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);

  const query = useQuery({ queryKey: qk.suggestion(suggestionId), queryFn: () => api.getSuggestion(suggestionId) });
  const history = useQuery({
    queryKey: qk.statusHistory(suggestionId),
    queryFn: () => api.listStatusHistory(suggestionId),
    enabled: query.isSuccess,
  });
  usePageTitle(query.data?.title ?? 'Sugestão');

  // Sem página anterior no app, o voltar sobe para o projeto da sugestão.
  const back = query.data
    ? { to: `/projetos/${query.data.project_id}`, label: query.data.project_name }
    : { to: '/projetos', label: 'Todos os projetos' };

  if (query.isPending) {
    return (
      <PageContainer narrow back={back}>
        <Skeleton className="h-56 w-full rounded-xl" />
        <Skeleton className="mt-6 h-40 w-full rounded-xl" />
      </PageContainer>
    );
  }
  // Com dados em cache, só a falha de rede mantém a versão salva; registro excluído ou
  // sem permissão mostra o erro.
  if (query.isError && (!query.data || toApiError(query.error).kind !== 'network')) {
    return (
      <PageContainer narrow back={back}>
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      </PageContainer>
    );
  }

  const s = query.data;
  const authorLocked = s.is_author && !isAdmin && !s.can_edit;
  const voteHint = s.is_author
    ? SELECTED_STATUSES.includes(s.status)
      ? 'Ideia selecionada: cada voto recebido vale 2 pontos para você no ranking.'
      : 'Cada voto recebido vale 1 ponto para você no ranking (o dobro se a ideia for selecionada).'
    : !s.voting_open
      ? 'Votação encerrada para este status.'
      : s.has_voted
        ? 'Você apoia esta ideia. Clique no contador para retirar o voto.'
        : 'Apoie esta ideia se você também quer vê-la realizada.';

  return (
    <PageContainer narrow back={back}>
      {/* 1. A sugestão (problemática) */}
      <article className="card flex animate-fade-in gap-4 p-5 sm:gap-6 sm:p-8" aria-labelledby="sugestao-titulo">
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

          <h1 id="sugestao-titulo" className="mt-3 text-2xl font-bold leading-tight tracking-[-0.02em] text-ink sm:text-[2rem]">
            {s.title}
          </h1>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
            <PersonLink id={s.author_id} className="inline-flex items-center gap-2">
              <Avatar name={s.author_name} photo={s.author_avatar} tone={toneFor(s.author_name)} />
              <span className="font-medium text-ink">{s.author_name}</span>
              {s.is_author && <span className="chip bg-brand-soft py-0.5 text-[0.6875rem] text-brand">você</span>}
            </PersonLink>
            <Link
              to={`/projetos/${s.project_id}`}
              className="inline-flex items-center gap-1.5 transition-colors duration-200 hover:text-brand"
            >
              <FolderOpen className="h-4 w-4" aria-hidden />
              {s.project_name}
            </Link>
            {s.updated_at !== s.created_at && (
              <span>
                Atualizada em <time dateTime={s.updated_at}>{formatDate(s.updated_at)}</time>
              </span>
            )}
          </div>

          <div className="mt-6 whitespace-pre-line break-words text-base leading-relaxed text-ink/85 sm:text-[1.0625rem]">
            <RichText text={s.description} />
          </div>

          {s.status === 'nao_aprovado' && s.status_reason && (
            <div className="mt-6 flex gap-3 rounded-lg border border-danger/20 bg-danger/5 p-4">
              <Ban className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden />
              <div>
                <p className="font-semibold text-ink">Por que esta ideia não foi aprovada</p>
                <p className="mt-1 whitespace-pre-line text-muted">{s.status_reason}</p>
              </div>
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-4">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted">
              <a href="#discussao" className="inline-flex items-center gap-2 font-semibold text-brand transition-colors duration-200 hover:text-brand-strong">
                <MessageSquare className="h-4 w-4" aria-hidden />
                {plural(s.comment_count, 'comentário', 'comentários')}
              </a>
              <span>{voteHint}</span>
            </div>
            {(isAdmin || s.can_edit || s.can_delete) && (
              <div className="flex flex-wrap gap-2">
                {isAdmin && (
                  <button type="button" className="btn-secondary py-2" onClick={() => setStatusOpen(true)}>
                    <RefreshCcw className="h-4 w-4" aria-hidden /> Alterar status
                  </button>
                )}
                {s.can_edit && (
                  <button type="button" className="btn-secondary py-2" onClick={() => setEditOpen(true)}>
                    <Pencil className="h-4 w-4" aria-hidden /> Editar
                  </button>
                )}
                {s.can_delete && (
                  <button
                    type="button"
                    className="btn-ghost py-2 text-danger hover:bg-danger/10 hover:text-danger"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden /> Excluir
                  </button>
                )}
              </div>
            )}
          </div>
          {authorLocked && (
            <p className="mt-3 inline-flex items-center gap-2 text-sm text-muted">
              <Lock className="h-4 w-4" aria-hidden /> A sugestão saiu da análise; ajustes agora são feitos pela administração.
            </p>
          )}
        </div>
      </article>

      {/* 2. Discussão, logo abaixo da problemática */}
      <Comments suggestionId={s.id} projectId={s.project_id} commentCount={Number(s.comment_count)} />

      {/* 3. Histórico de status */}
      {history.data && history.data.length > 0 && (
        <section className="card mt-6 animate-fade-in p-6 sm:p-8" aria-labelledby="historico-titulo">
          <h2 id="historico-titulo" className="flex items-center gap-2 text-lg font-bold text-ink">
            <History className="h-5 w-5 text-muted" aria-hidden /> Histórico de status
          </h2>
          <ol className="mt-4 space-y-4 border-l-2 border-line pl-5">
            {history.data.map((h) => (
              <li key={h.id} className="relative">
                <span
                  className={`absolute -left-[27px] top-1.5 h-3 w-3 rounded-full ring-4 ring-surface ${SUGGESTION_STATUS[h.new_status].dot}`}
                  aria-hidden
                />
                <p className="text-sm text-ink">
                  {h.previous_status ? (
                    <>
                      {SUGGESTION_STATUS[h.previous_status].label} → <strong>{SUGGESTION_STATUS[h.new_status].label}</strong>
                    </>
                  ) : (
                    <strong>{SUGGESTION_STATUS[h.new_status].label}</strong>
                  )}
                </p>
                <p className="text-xs text-muted">
                  {formatDateTime(h.created_at)}
                  {h.actor_name && ` · por ${h.actor_name}`}
                </p>
                {h.reason && <p className="mt-1 text-sm text-muted">“{h.reason}”</p>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {s.can_edit && (
        <SuggestionFormDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          projectId={s.project_id}
          projectName={s.project_name}
          editing={{ id: s.id, type: s.type, title: s.title, description: s.description }}
        />
      )}
      {isAdmin && (
        <StatusDialog
          open={statusOpen}
          onOpenChange={setStatusOpen}
          suggestionId={s.id}
          projectId={s.project_id}
          currentStatus={s.status}
          currentReason={s.status_reason}
        />
      )}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Excluir sugestão?"
        confirmLabel="Excluir sugestão"
        description={
          <>
            A sugestão deixará de aparecer nas listagens e os {Number(s.vote_count)} voto(s) recebidos deixarão de contar pontos
            no ranking. {!s.is_author && 'A exclusão ficará registrada na auditoria.'}
          </>
        }
        onConfirm={async () => {
          await api.deleteSuggestion(s.id);
          for (const key of [
            qk.suggestions(s.project_id),
            qk.project(s.project_id),
            qk.projects,
            qk.stats,
            qk.ranking,
            qk.myScore,
            qk.mySuggestions,
            qk.publicProfiles,
            qk.userSuggestionLists,
            qk.auditLog,
            qk.adminSuggestions,
          ]) {
            queryClient.invalidateQueries({ queryKey: key });
          }
          toast.success('Sugestão excluída.');
          navigate(`/projetos/${s.project_id}`, { replace: true });
          // Remove depois de sair da página, para não disparar uma nova busca que retornaria 404.
          queryClient.removeQueries({ queryKey: qk.suggestion(s.id) });
        }}
      />
    </PageContainer>
  );
}
