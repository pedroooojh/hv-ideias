import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Lightbulb, ThumbsUp } from 'lucide-react';
import { api, qk } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { useDebounced } from '@/lib/useDebounced';

/**
 * Enquanto a pessoa escreve o título, mostra ideias parecidas do mesmo projeto,
 * para votar na existente em vez de criar uma duplicada.
 */
export function SimilarSuggestions({ projectId, title, excludeId }: { projectId: string; title: string; excludeId?: string }) {
  const term = useDebounced(title.trim().slice(0, 100), 400);
  const similar = useQuery({
    queryKey: qk.search(term, `similar:${projectId}`),
    queryFn: () => api.searchSuggestions(term, { projectId, matchAny: true, limit: 4 }),
    enabled: term.length >= 4,
    staleTime: 30_000,
  });
  const items = (similar.data ?? []).filter((s) => s.id !== excludeId);
  if (term.length < 4 || items.length === 0) return null;

  return (
    <div className="mt-3 animate-fade-in rounded-xl border border-warning/30 bg-warning/10 p-3" role="status">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-ink">
        <Lightbulb className="h-3.5 w-3.5 text-warning" aria-hidden /> Já existem ideias parecidas neste projeto. Que tal votar nelas?
      </p>
      <ul className="mt-2 space-y-1">
        {items.map((s) => (
          <li key={s.id}>
            <Link
              to={`/sugestoes/${s.id}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm text-ink hover:bg-surface/70"
            >
              <span className="truncate">{s.title}</span>
              <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted">
                <ThumbsUp className="h-3.5 w-3.5" aria-hidden /> {formatNumber(s.vote_count)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
