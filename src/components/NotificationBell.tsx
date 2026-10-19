import { useState } from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, Crown, MessageSquare, RefreshCcw, ThumbsUp, Trophy } from 'lucide-react';
import { api, qk, type NotificationItem } from '@/lib/api';
import { SUGGESTION_STATUS } from '@/lib/domain';
import { formatMonth, formatNumber, formatRelative, formatWeekRange } from '@/lib/format';
import type { RankingView } from './RankingDialog';
import { Skeleton } from './ui';

const LIST_KEY = [...qk.notifications, 'list'] as const;

function describe(n: NotificationItem): { icon: JSX.Element; text: JSX.Element } {
  const title = <strong className="font-semibold text-ink">“{n.suggestion_title}”</strong>;
  const many = n.event_count > 1;
  switch (n.kind) {
    case 'vote':
      return {
        icon: <ThumbsUp className="h-4 w-4" />,
        text: many ? (
          <>{formatNumber(n.event_count)} novos votos em {title}</>
        ) : (
          <><strong className="font-semibold text-ink">{n.actor_name ?? 'Alguém'}</strong> votou em {title}</>
        ),
      };
    case 'comment':
      return {
        icon: <MessageSquare className="h-4 w-4" />,
        text: many ? (
          <>{formatNumber(n.event_count)} novos comentários em {title}</>
        ) : (
          <><strong className="font-semibold text-ink">{n.actor_name ?? 'Alguém'}</strong> comentou em {title}</>
        ),
      };
    case 'status': {
      const label = n.data.new_status ? SUGGESTION_STATUS[n.data.new_status]?.label : null;
      return {
        icon: <RefreshCcw className="h-4 w-4" />,
        text: (
          <>
            {title} mudou para <strong className="font-semibold text-ink">{label ?? n.data.new_status}</strong>
          </>
        ),
      };
    }
    case 'podium':
      return {
        icon: <Trophy className="h-4 w-4" />,
        text: (
          <>
            Você ficou em <strong className="font-semibold text-ink">{n.data.rank_position}º lugar</strong> no ranking da semana
            {n.data.week_start && n.data.week_end ? ` de ${formatWeekRange(n.data.week_start, n.data.week_end)}` : ''}!
          </>
        ),
      };
    case 'champion':
      return {
        icon: <Crown className="h-4 w-4" />,
        text: (
          <>
            Você é o <strong className="font-semibold text-ink">campeão do mês</strong>
            {n.data.month_start ? ` de ${formatMonth(n.data.month_start)}` : ''}! Parabéns, o prêmio é seu.
          </>
        ),
      };
  }
}

/** Sininho do cabeçalho: contagem de não lidas (atualiza a cada minuto) e lista ao abrir. */
export function NotificationBell({ className, onOpenRanking }: { className: string; onOpenRanking: (view?: RankingView) => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const unread = useQuery({
    queryKey: qk.unreadNotifications,
    queryFn: api.countUnreadNotifications,
    refetchInterval: 60_000,
  });
  const list = useQuery({ queryKey: LIST_KEY, queryFn: () => api.listMyNotifications(), enabled: open });
  const markRead = useMutation({
    mutationFn: (ids?: string[]) => api.markNotificationsRead(ids),
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.notifications }),
  });

  const count = unread.data ?? 0;
  const items = list.data?.items ?? [];

  const openItem = (n: NotificationItem) => {
    if (!n.is_read) markRead.mutate([n.id]);
    setOpen(false);
    if (n.kind === 'podium') onOpenRanking('semana');
    else if (n.kind === 'champion') onOpenRanking('campeao');
    else if (n.suggestion_id) navigate(`/sugestoes/${n.suggestion_id}`);
  };

  return (
    <Menu.Root
      modal={false}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) queryClient.invalidateQueries({ queryKey: LIST_KEY });
      }}
    >
      <Menu.Trigger
        className={`${className} relative`}
        aria-label={count > 0 ? `Notificações: ${count} não lidas` : 'Notificações'}
        title="Notificações"
      >
        <Bell className="h-5 w-5" />
        {count > 0 && (
          <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-danger px-1 text-[0.625rem] font-bold text-white ring-2 ring-surface" aria-hidden>
            {count > 99 ? '99+' : count}
          </span>
        )}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="animate-presence z-50 flex max-h-[min(32rem,80vh)] w-[min(24rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-float focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
        >
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <Menu.Label className="font-display text-sm font-bold text-ink">Notificações</Menu.Label>
            {count > 0 && (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline"
                onClick={() => markRead.mutate(undefined)}
              >
                <CheckCheck className="h-3.5 w-3.5" aria-hidden /> Marcar todas como lidas
              </button>
            )}
          </div>
          <div className="hv-scroll min-h-0 flex-1 overflow-y-auto p-1.5">
            {list.isPending ? (
              <div className="space-y-1.5 p-1.5">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-14 rounded-lg" />
                ))}
              </div>
            ) : list.isError ? (
              <p className="px-4 py-8 text-center text-sm text-danger">
                Não foi possível carregar as notificações.{' '}
                <button type="button" className="font-semibold underline" onClick={() => list.refetch()}>
                  Tentar de novo
                </button>
              </p>
            ) : items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted">
                Nada por aqui ainda. Você será avisado quando suas ideias receberem votos, comentários ou mudarem de status.
              </p>
            ) : (
              items.map((n) => {
                const { icon, text } = describe(n);
                return (
                  <Menu.Item
                    key={n.id}
                    onSelect={() => openItem(n)}
                    className="flex cursor-pointer select-none gap-3 rounded-lg px-2.5 py-2.5 outline-none transition-colors duration-150 data-[highlighted]:bg-subtle"
                  >
                    <span
                      className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full ${
                        n.kind === 'podium' || n.kind === 'champion' ? 'bg-[#d4a017]/15 text-[#d4a017]' : 'bg-brand-soft text-brand'
                      }`}
                      aria-hidden
                    >
                      {icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm leading-snug text-muted">{text}</span>
                      <span className="mt-0.5 block text-xs text-muted/80">{formatRelative(n.updated_at)}</span>
                    </span>
                    {!n.is_read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-brand" aria-label="não lida" />}
                  </Menu.Item>
                );
              })
            )}
          </div>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
