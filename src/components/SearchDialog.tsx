import { useEffect, useState, type KeyboardEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Search, ThumbsUp, X } from 'lucide-react';
import { api, qk, type SearchResult } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { useDebounced } from '@/lib/useDebounced';
import { Avatar, SuggestionStatusChip, toneFor } from './ui';

/** Atalho global Ctrl+K / ⌘K para abrir a busca. */
export function useSearchShortcut(open: () => void) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
}

/** Busca em todas as sugestões de todos os projetos; setas e Enter navegam pelos resultados. */
export function SearchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const [active, setActive] = useState(0);
  const debounced = useDebounced(term.trim());
  const enabled = open && debounced.length >= 3;
  const results = useQuery({
    queryKey: qk.search(debounced, 'all'),
    queryFn: () => api.searchSuggestions(debounced, { limit: 12 }),
    enabled,
    staleTime: 30_000,
  });
  const items = enabled ? (results.data ?? []) : [];

  useEffect(() => {
    if (open) {
      setTerm('');
      setActive(0);
    }
  }, [open]);
  useEffect(() => setActive(0), [debounced]);

  const go = (r: SearchResult) => {
    onOpenChange(false);
    navigate(`/sugestoes/${r.id}`);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && items[active]) {
      e.preventDefault();
      go(items[active]);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/40 animate-presence backdrop-blur-[2px] dark:bg-black/60" />
        <Dialog.Content className="fixed inset-x-3 top-[10vh] z-50 mx-auto flex max-h-[75vh] max-w-xl animate-presence flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-float">
          <Dialog.Title className="sr-only">Buscar sugestões</Dialog.Title>
          <Dialog.Description className="sr-only">Procure ideias em todos os projetos pelo título ou pela descrição.</Dialog.Description>
          <div className="flex items-center gap-3 border-b border-line px-4">
            {results.isFetching ? (
              <Loader2 className="h-5 w-5 shrink-0 animate-spin text-muted" aria-hidden />
            ) : (
              <Search className="h-5 w-5 shrink-0 text-muted" aria-hidden />
            )}
            <input
              autoFocus
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={onKeyDown}
              maxLength={100}
              placeholder="Buscar ideias em todos os projetos…"
              aria-label="Buscar sugestões"
              aria-controls="resultados-busca"
              aria-activedescendant={items[active] ? `busca-${items[active].id}` : undefined}
              className="h-14 min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-muted/70 focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            <Dialog.Close className="rounded-lg p-1.5 text-muted hover:bg-subtle hover:text-ink" aria-label="Fechar">
              <X className="h-5 w-5" />
            </Dialog.Close>
          </div>

          <div className="hv-scroll min-h-0 flex-1 overflow-y-auto p-2">
            {debounced.length < 3 ? (
              <p className="px-3 py-6 text-center text-sm text-muted">
                Digite pelo menos 3 letras. Dica: <kbd className="rounded border border-line bg-subtle px-1.5 text-xs">Ctrl</kbd> +{' '}
                <kbd className="rounded border border-line bg-subtle px-1.5 text-xs">K</kbd> abre a busca de qualquer tela.
              </p>
            ) : results.isError ? (
              <p className="px-3 py-6 text-center text-sm text-danger">
                Não foi possível buscar agora.{' '}
                <button type="button" className="font-semibold underline" onClick={() => results.refetch()}>
                  Tentar de novo
                </button>
              </p>
            ) : results.isPending ? null : items.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted">Nenhuma sugestão encontrada para “{debounced}”.</p>
            ) : (
              <ul id="resultados-busca" role="listbox" aria-label="Resultados">
                {items.map((r, i) => (
                  <li
                    key={r.id}
                    id={`busca-${r.id}`}
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(r)}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 ${i === active ? 'bg-subtle' : ''}`}
                  >
                    <Avatar name={r.author_name} photo={r.author_avatar} tone={toneFor(r.author_name)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">{r.title}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                        <SuggestionStatusChip status={r.status} />
                        <span className="truncate">{r.project_name}</span>
                        <span aria-hidden>·</span>
                        <span className="truncate">{r.author_name}</span>
                      </span>
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted">
                      <ThumbsUp className="h-3.5 w-3.5" aria-hidden /> {formatNumber(r.vote_count)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
