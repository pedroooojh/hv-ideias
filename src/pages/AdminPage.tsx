import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImageOff, Lightbulb, MailPlus, MessageSquare, RefreshCcw, ScrollText, Send, ThumbsUp, Users } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { api, qk, type AdminSuggestion, type AdminUser, type AuditEntry } from '@/lib/api';
import {
  PROJECT_STATUS,
  SUGGESTION_STATUS,
  SUGGESTION_STATUS_ORDER,
  type ProjectStatus,
  type SuggestionStatus,
} from '@/lib/domain';
import { errorMessage } from '@/lib/errors';
import { formatDate, formatDateTime, formatNumber } from '@/lib/format';
import { usePageTitle } from '@/lib/navigation';
import { FilterBar, FilterMenu, FilterSummary, SearchField, pick, useUrlFilters } from '@/components/Filters';
import { InviteDialog } from '@/components/InviteDialog';
import { ConfirmDialog } from '@/components/Modal';
import { Dot, Select } from '@/components/Select';
import { StatusDialog } from '@/components/StatusDialog';
import { useToast } from '@/components/Toast';
import { Avatar, EmptyState, ErrorState, LoadMore, PageContainer, Skeleton, SuggestionStatusChip, TypeChip, toneFor } from '@/components/ui';

const TABS = [
  { id: 'sugestoes', label: 'Sugestões', icon: Lightbulb },
  { id: 'usuarios', label: 'Usuários', icon: Users },
  { id: 'auditoria', label: 'Auditoria', icon: ScrollText },
] as const;
type Tab = (typeof TABS)[number]['id'];

/** Painel de gestão aberto pelos cartões da página inicial do administrador. */
export function AdminPage() {
  usePageTitle('Gestão da plataforma');
  const [params, setParams] = useSearchParams();
  const requested = params.get('aba');
  const tab: Tab = TABS.some((t) => t.id === requested) ? (requested as Tab) : 'sugestoes';
  const [controlsSlot, setControlsSlot] = useState<HTMLDivElement | null>(null);
  const tabClass = (active: boolean) =>
    `inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-1 pb-3 text-base transition-colors duration-200 ${
      active ? 'border-brand font-bold text-brand' : 'border-transparent text-muted hover:text-ink'
    }`;

  let panel: ReactNode;
  if (tab === 'sugestoes') panel = <SuggestionsPanel controlsSlot={controlsSlot} />;
  else if (tab === 'usuarios') panel = <UsersPanel controlsSlot={controlsSlot} />;
  else panel = <AuditPanel controlsSlot={controlsSlot} />;

  return (
    <PageContainer narrow back={{ to: '/', label: 'Início' }}>
      <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">Gestão da plataforma</h1>
      <p className="mt-2 max-w-3xl text-muted">
        Analise as sugestões de todos os projetos, gerencie as contas e consulte o histórico de ações administrativas.
        Projetos são criados e editados na página inicial (cartão “Projetos” e engrenagem de cada projeto).
      </p>

      {/* Linha única, como nas outras telas: seções à esquerda e, à direita, os
          filtros do painel aberto (cada painel os coloca ali via portal).
          Trocar de seção limpa os filtros da seção anterior. */}
      <div className="mt-8">
        <FilterBar
          tabs={
            <div className="no-scrollbar flex gap-8 overflow-x-auto" role="tablist" aria-label="Seções da gestão">
              {TABS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  id={`aba-${id}`}
                  aria-selected={tab === id}
                  aria-controls={`painel-${id}`}
                  className={tabClass(tab === id)}
                  onClick={() => setParams({ aba: id }, { replace: true })}
                >
                  <Icon className="h-4 w-4" aria-hidden /> {label}
                </button>
              ))}
            </div>
          }
          controls={<div ref={setControlsSlot} />}
        />
      </div>

      <div key={tab} className="animate-fade-in" id={`painel-${tab}`} role="tabpanel" aria-labelledby={`aba-${tab}`}>
        {panel}
      </div>
    </PageContainer>
  );
}

/** Filtros do painel, exibidos à direita das seções (mesma linha, como nas outras telas). */
function PanelControls({ slot, children }: { slot: HTMLElement | null; children: ReactNode }) {
  if (!slot) return null;
  return createPortal(<div className="flex animate-fade-in flex-wrap items-center gap-2">{children}</div>, slot);
}

const SUGGESTION_FILTERS = ['status', 'tipo', 'busca'] as const;

function SuggestionsPanel({ controlsSlot }: { controlsSlot: HTMLElement | null }) {
  const filters = useUrlFilters(SUGGESTION_FILTERS);
  const status = pick(filters.get('status'), SUGGESTION_STATUS_ORDER);
  const type = filters.get('tipo');
  const search = filters.get('busca');
  const filtered = filters.active();

  const types = useQuery({ queryKey: qk.types, queryFn: api.listSuggestionTypes, staleTime: 10 * 60_000 });
  const counts = useQuery({
    queryKey: [...qk.adminSuggestions, 'counts', type, search],
    queryFn: () => api.adminSuggestionStatusCounts({ type, search }),
  });
  const query = useInfiniteQuery({
    queryKey: [...qk.adminSuggestions, status, type, search],
    queryFn: ({ pageParam }) => api.adminListSuggestions({ status, type, search }, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <PanelControls slot={controlsSlot}>
        <SearchField
          label="Buscar sugestões por título, projeto ou autor"
          placeholder="Buscar sugestões"
          value={search}
          onChange={(v) => filters.set('busca', v)}
        />
        <FilterMenu
          label="Status"
          allLabel="Todos"
          value={status}
          onChange={(v) => filters.set('status', v)}
          options={SUGGESTION_STATUS_ORDER.map((s) => ({
            value: s,
            label: SUGGESTION_STATUS[s].label,
            marker: <Dot className={SUGGESTION_STATUS[s].dot} />,
            count: counts.data ? Number(counts.data[s] ?? 0) : undefined,
          }))}
        />
        <FilterMenu
          label="Tipo"
          value={type}
          onChange={(v) => filters.set('tipo', v)}
          options={(types.data ?? []).map((t) => ({ value: t.slug, label: t.label }))}
        />
      </PanelControls>
      <FilterSummary active={filtered} total={query.data?.pages[0]?.total} onClear={() => filters.clear()} />
      <div className="mt-5">
        {query.isPending ? (
          <Skeleton className="h-48 rounded-xl" />
        ) : query.isError && !query.data ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Lightbulb className="h-6 w-6" />}
            title={status === 'em_analise' && !type && !search ? 'Nada aguardando análise' : 'Nenhuma sugestão com esses filtros'}
          />
        ) : (
          <ul className="card animate-fade-in divide-y divide-line">
            {items.map((s) => (
              <SuggestionRow key={s.id} suggestion={s} />
            ))}
          </ul>
        )}
        <LoadMore hasMore={query.hasNextPage} loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()} />
      </div>
    </>
  );
}

function SuggestionRow({ suggestion: s }: { suggestion: AdminSuggestion }) {
  const [statusOpen, setStatusOpen] = useState(false);
  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <TypeChip slug={s.type} label={s.type_label} />
          <SuggestionStatusChip status={s.status} />
        </div>
        <Link to={`/sugestoes/${s.id}`} className="mt-2 block font-semibold text-ink transition-colors duration-200 hover:text-brand">
          {s.title}
        </Link>
        <p className="mt-0.5 text-sm text-muted">
          <Link to={`/projetos/${s.project_id}`} className="hover:text-ink hover:underline">
            {s.project_name}
          </Link>{' '}
          · {s.author_name} · {formatDate(s.created_at)}
        </p>
        <p className="mt-1 flex gap-4 text-xs text-muted">
          <span className="inline-flex items-center gap-1">
            <ThumbsUp className="h-3.5 w-3.5" aria-hidden /> {formatNumber(s.vote_count)}{' '}
            {Number(s.vote_count) === 1 ? 'voto' : 'votos'}
          </span>
          <span className="inline-flex items-center gap-1">
            <MessageSquare className="h-3.5 w-3.5" aria-hidden /> {formatNumber(s.comment_count)}{' '}
            {Number(s.comment_count) === 1 ? 'comentário' : 'comentários'}
          </span>
        </p>
      </div>
      <button type="button" className="btn-secondary shrink-0 py-2" onClick={() => setStatusOpen(true)}>
        <RefreshCcw className="h-4 w-4" aria-hidden /> Alterar status
      </button>
      <StatusDialog
        open={statusOpen}
        onOpenChange={setStatusOpen}
        suggestionId={s.id}
        projectId={s.project_id}
        currentStatus={s.status}
        currentReason={null}
      />
    </li>
  );
}

const USER_FILTERS = ['situacao', 'perfil', 'busca'] as const;

function UsersPanel({ controlsSlot }: { controlsSlot: HTMLElement | null }) {
  const { profile } = useAuth();
  const filters = useUrlFilters(USER_FILTERS);
  const status = pick(filters.get('situacao'), ['active', 'disabled'] as const);
  const role = pick(filters.get('perfil'), ['user', 'admin'] as const);
  const search = filters.get('busca');
  const filtered = filters.active();

  const counts = useQuery({
    queryKey: [...qk.adminUsers, 'counts', role, search],
    queryFn: () => api.adminUserStatusCounts({ search, role }),
  });
  const query = useInfiniteQuery({
    queryKey: [...qk.adminUsers, status, role, search],
    queryFn: ({ pageParam }) => api.adminListUsers({ search, role, status }, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset,
  });
  const users = query.data?.pages.flatMap((p) => p.items) ?? [];
  const count = (k: string) => (counts.data ? Number(counts.data[k] ?? 0) : undefined);
  const [inviting, setInviting] = useState(false);

  return (
    <>
      <PanelControls slot={controlsSlot}>
        <button type="button" className="btn-primary py-2" onClick={() => setInviting(true)}>
          <MailPlus className="h-4 w-4" aria-hidden /> Convidar pessoa
        </button>
        <SearchField
          label="Buscar usuários por nome ou e-mail"
          placeholder="Buscar usuários"
          value={search}
          onChange={(v) => filters.set('busca', v)}
        />
        <FilterMenu
          label="Situação"
          allLabel="Todas"
          value={status}
          onChange={(v) => filters.set('situacao', v)}
          options={[
            { value: 'active', label: 'Ativas', count: count('active') },
            { value: 'disabled', label: 'Desativadas', count: count('disabled') },
          ]}
        />
        <FilterMenu
          label="Perfil"
          value={role}
          onChange={(v) => filters.set('perfil', v)}
          options={[
            { value: 'user', label: 'Usuário' },
            { value: 'admin', label: 'Administrador' },
          ]}
        />
      </PanelControls>
      <FilterSummary active={filtered} total={query.data?.pages[0]?.total} onClear={() => filters.clear()} />
      <div className="mt-5">
        {query.isPending ? (
          <Skeleton className="h-48 rounded-xl" />
        ) : query.isError && !query.data ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : users.length === 0 ? (
          <EmptyState icon={<Users className="h-6 w-6" />} title="Nenhuma conta com esses filtros" />
        ) : (
          <ul className="card animate-fade-in divide-y divide-line">
            {users.map((u) => (
              <UserRow key={u.id} user={u} isSelf={u.id === profile?.id} />
            ))}
          </ul>
        )}
        <LoadMore hasMore={query.hasNextPage} loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()} />
      </div>
      <InviteDialog open={inviting} onOpenChange={setInviting} />
    </>
  );
}

function UserRow({ user, isSelf }: { user: AdminUser; isSelf: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [pending, setPending] = useState<{ role: AdminUser['role']; status: AdminUser['status'] } | null>(null);
  const [removingPhoto, setRemovingPhoto] = useState(false);
  const [resending, setResending] = useState(false);

  const resendInvite = async () => {
    setResending(true);
    try {
      await api.adminInviteUser(user.email);
      queryClient.invalidateQueries({ queryKey: qk.auditLog });
      toast.success(`Convite reenviado para ${user.email}.`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setResending(false);
    }
  };

  const describe = (next: { role: AdminUser['role']; status: AdminUser['status'] }) => {
    if (next.status !== user.status) {
      return next.status === 'disabled'
        ? `${user.name} não poderá mais publicar, votar ou comentar e sairá do ranking. O conteúdo já publicado é mantido.`
        : `${user.name} voltará a poder participar normalmente.`;
    }
    return next.role === 'admin'
      ? `${user.name} terá acesso total à administração: projetos, status, moderação e contas.`
      : `${user.name} perderá o acesso administrativo.`;
  };

  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={user.name} photo={user.avatar_path} size="md" tone={toneFor(user.name)} />
        <div className="min-w-0">
          <p className="font-semibold text-ink">
            {user.name} {isSelf && <span className="chip ml-1 bg-brand-soft py-0.5 text-[0.6875rem] text-brand">você</span>}
          </p>
          <p className="truncate text-sm text-muted">{user.email}</p>
          <p className="text-xs text-muted">
            Desde {formatDate(user.created_at)} · {user.suggestion_count} sugestão(ões)
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:flex-nowrap sm:justify-end">
        <Select
          compact
          className="w-auto min-w-[11rem]"
          aria-label={`Perfil de ${user.name}`}
          value={user.role}
          disabled={isSelf}
          onChange={(role) => role !== user.role && setPending({ role, status: user.status })}
          options={[
            { value: 'user', label: 'Usuário', description: 'Sugere, vota e comenta' },
            { value: 'admin', label: 'Administrador', description: 'Gerencia projetos, status, moderação e contas' },
          ]}
        />
        <button
          type="button"
          className={user.status === 'active' ? 'btn-secondary py-2' : 'btn-primary py-2'}
          disabled={isSelf}
          onClick={() => setPending({ role: user.role, status: user.status === 'active' ? 'disabled' : 'active' })}
          title={isSelf ? 'Você não pode alterar a própria conta' : undefined}
        >
          {user.status === 'active' ? 'Desativar' : 'Reativar'}
        </button>
        {user.avatar_path && (
          <button type="button" className="btn-ghost py-2" onClick={() => setRemovingPhoto(true)} title="Remover a foto de perfil">
            <ImageOff className="h-4 w-4" aria-hidden /> Remover foto
          </button>
        )}
        {user.invite_pending && (
          <>
            <span className="chip bg-warning/10 text-warning" title="A pessoa ainda não abriu o convite nem criou a senha">
              Convite pendente
            </span>
            <button type="button" className="btn-ghost py-2" onClick={resendInvite} disabled={resending}>
              <Send className="h-4 w-4" aria-hidden /> {resending ? 'Reenviando…' : 'Reenviar convite'}
            </button>
          </>
        )}
        {user.status === 'disabled' && <span className="chip bg-danger/10 text-danger">Desativada</span>}
      </div>
      <ConfirmDialog
        open={removingPhoto}
        onOpenChange={setRemovingPhoto}
        title="Remover foto de perfil"
        description={`A foto de ${user.name} será apagada e as iniciais aparecerão no lugar. A pessoa pode enviar outra depois. A remoção fica registrada na auditoria.`}
        confirmLabel="Remover foto"
        onConfirm={async () => {
          await api.adminRemoveAvatar(user.id);
          for (const key of ['admin-users', 'audit-log', 'ranking', 'suggestions', 'suggestion', 'comments', 'profile']) {
            queryClient.invalidateQueries({ queryKey: [key] });
          }
          toast.success('Foto removida.');
        }}
      />
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title="Confirmar alteração da conta"
        description={pending ? describe(pending) : ''}
        confirmLabel="Confirmar"
        tone={pending?.status === 'disabled' ? 'danger' : 'primary'}
        onConfirm={async () => {
          if (!pending) return;
          await api.adminUpdateUser(user.id, pending.role, pending.status);
          queryClient.invalidateQueries({ queryKey: qk.adminUsers });
          queryClient.invalidateQueries({ queryKey: qk.auditLog });
          queryClient.invalidateQueries({ queryKey: qk.ranking });
          queryClient.invalidateQueries({ queryKey: qk.publicProfiles });
          toast.success('Conta atualizada.');
        }}
      />
    </li>
  );
}

const ENTITY_LABEL: Record<AuditEntry['entity_type'], string> = {
  project: 'Projeto',
  suggestion: 'Sugestão',
  comment: 'Comentário',
  user: 'Usuário',
};

const ACTION_LABEL: Record<string, string> = {
  'project.create': 'criou o projeto',
  'project.update': 'editou o projeto',
  'project.delete': 'excluiu o projeto',
  'suggestion.update': 'editou a sugestão',
  'suggestion.delete': 'excluiu a sugestão',
  'suggestion.status_change': 'alterou o status da sugestão',
  'comment.moderate': 'removeu um comentário em',
  'user.update': 'alterou a conta de',
  'user.avatar_remove': 'removeu a foto de perfil de',
  'user.self_delete': 'excluiu a própria conta',
  'user.invite': 'convidou',
};

function statusLabel(value: unknown): string {
  const v = String(value ?? '');
  return SUGGESTION_STATUS[v as SuggestionStatus]?.label ?? PROJECT_STATUS[v as ProjectStatus]?.label ?? v;
}

function describeChange(entry: AuditEntry): string | null {
  const prev = entry.previous_value ?? {};
  const next = entry.new_value ?? {};
  if (entry.action === 'suggestion.status_change') {
    const reason = next.reason ? ` — “${String(next.reason)}”` : '';
    return `${statusLabel(prev.status)} → ${statusLabel(next.status)}${reason}`;
  }
  if (entry.action === 'user.update') {
    const parts: string[] = [];
    if (prev.role !== next.role) parts.push(`perfil: ${prev.role === 'admin' ? 'administrador' : 'usuário'} → ${next.role === 'admin' ? 'administrador' : 'usuário'}`);
    if (prev.status !== next.status) parts.push(`conta: ${prev.status === 'active' ? 'ativa' : 'desativada'} → ${next.status === 'active' ? 'ativa' : 'desativada'}`);
    return parts.join('; ');
  }
  if (entry.action === 'project.update') {
    const changed = ['name', 'category', 'status', 'description'].filter((k) => prev[k] !== next[k]);
    const names: Record<string, string> = { name: 'nome', category: 'categoria', status: 'status', description: 'descrição' };
    return changed.length ? `Campos alterados: ${changed.map((k) => names[k]).join(', ')}` : 'Sem alterações de conteúdo';
  }
  if (entry.action === 'project.delete' && Number(prev.active_suggestions) > 0) {
    return `${prev.active_suggestions} sugestão(ões) ativa(s) ocultadas junto com o projeto`;
  }
  return null;
}

const AUDIT_ENTITIES = ['project', 'suggestion', 'comment', 'user'] as const;
const AUDIT_FILTERS = ['entidade'] as const;

function AuditPanel({ controlsSlot }: { controlsSlot: HTMLElement | null }) {
  const filters = useUrlFilters(AUDIT_FILTERS);
  const entity = pick(filters.get('entidade'), AUDIT_ENTITIES);
  const query = useInfiniteQuery({
    queryKey: [...qk.auditLog, entity],
    queryFn: ({ pageParam }) => api.adminListAuditLog(entity, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset,
  });
  const entries = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <PanelControls slot={controlsSlot}>
        <FilterMenu
          label="Registro"
          allLabel="Todas as ações"
          value={entity}
          onChange={(v) => filters.set('entidade', v)}
          options={[
            { value: 'project', label: 'Projetos' },
            { value: 'suggestion', label: 'Sugestões' },
            { value: 'comment', label: 'Comentários' },
            { value: 'user', label: 'Usuários' },
          ]}
        />
      </PanelControls>
      <FilterSummary active={Boolean(entity)} total={query.data?.pages[0]?.total} onClear={() => filters.clear()} />
      <div className="mt-5">
        {query.isPending ? (
          <Skeleton className="h-48 rounded-xl" />
        ) : query.isError && !query.data ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : entries.length === 0 ? (
          <EmptyState icon={<ScrollText className="h-6 w-6" />} title={entity ? 'Nenhuma ação deste tipo' : 'Nenhuma ação registrada'} />
        ) : (
          <ol className="card animate-fade-in divide-y divide-line">
            {entries.map((e) => {
              const detail = describeChange(e);
              const label = e.entity_label ?? '(registro removido)';
              const link =
                e.entity_type === 'suggestion' && e.action !== 'suggestion.delete' && e.entity_id
                  ? `/sugestoes/${e.entity_id}`
                  : e.entity_type === 'project' && e.action !== 'project.delete' && e.entity_id
                    ? `/projetos/${e.entity_id}`
                    : null;
              return (
                <li key={e.id} className="p-4 sm:px-6">
                  <p className="text-sm text-ink">
                    <strong>{e.actor_name ?? 'Sistema'}</strong> {ACTION_LABEL[e.action] ?? e.action}{' '}
                    {link ? (
                      <Link to={link} className="font-semibold text-brand hover:underline">
                        {label}
                      </Link>
                    ) : (
                      <strong>{label}</strong>
                    )}
                  </p>
                  {detail && <p className="mt-0.5 text-sm text-muted">{detail}</p>}
                  <p className="mt-1 text-xs text-muted">
                    {ENTITY_LABEL[e.entity_type]} · {formatDateTime(e.created_at)}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
        <LoadMore hasMore={query.hasNextPage} loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()} />
      </div>
    </>
  );
}
