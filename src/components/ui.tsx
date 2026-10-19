import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useBack, type BackTarget } from '@/lib/navigation';
import { AlertCircle, ArrowLeft, Loader2, RefreshCw } from 'lucide-react';
import { useAvatarUrl } from '@/lib/avatarUrls';
import { errorMessage, toApiError } from '@/lib/errors';
import { initials } from '@/lib/format';
import {
  PROJECT_STATUS,
  SUGGESTION_STATUS,
  typeChipClass,
  type ProjectStatus,
  type SuggestionStatus,
} from '@/lib/domain';

export function Spinner({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-subtle ${className}`} aria-hidden />;
}

export function ErrorState({ error, onRetry, title }: { error: unknown; onRetry?: () => void; title?: string }) {
  const apiError = toApiError(error);
  return (
    <div role="alert" className="card flex animate-fade-in flex-col items-center px-6 py-10 text-center">
      <AlertCircle className="h-8 w-8 text-danger" aria-hidden />
      <h2 className="mt-3 text-lg font-bold text-ink">
        {title ?? (apiError.kind === 'not_found' ? 'Não encontrado' : 'Não foi possível carregar')}
      </h2>
      <p className="mt-1 max-w-md text-sm text-muted">{errorMessage(error)}</p>
      <div className="mt-5 flex gap-2">
        {onRetry && apiError.kind !== 'not_found' && (
          <button type="button" className="btn-secondary" onClick={onRetry}>
            <RefreshCw className="h-4 w-4" aria-hidden /> Tentar novamente
          </button>
        )}
        {apiError.kind === 'not_found' && (
          <Link to="/" className="btn-secondary">
            Voltar ao início
          </Link>
        )}
        {(apiError.kind === 'unauthenticated' || apiError.code === '42501') && (
          <Link to="/entrar" className="btn-primary">
            Entrar
          </Link>
        )}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="card flex animate-fade-in flex-col items-center px-6 py-12 text-center">
      {icon && <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-brand-soft text-brand">{icon}</div>}
      <h3 className="text-lg font-bold text-ink">{title}</h3>
      {children && <div className="mt-1 max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}

const AVATAR_DIMS = {
  sm: 'h-7 w-7 text-[0.6875rem]',
  md: 'h-10 w-10 text-sm',
  lg: 'h-14 w-14 text-base',
  xl: 'h-20 w-20 text-2xl',
  '2xl': 'h-28 w-28 text-4xl',
};

/** Foto de perfil (caminho no Storage) ou, sem foto ou se ela falhar, as iniciais. */
export function Avatar({
  name,
  photo,
  size = 'sm',
  tone = 0,
}: {
  name: string | null;
  photo?: string | null;
  size?: keyof typeof AVATAR_DIMS;
  tone?: number;
}) {
  const [failed, setFailed] = useState(false);
  // Qual link já terminou de carregar (trocar de foto volta às iniciais até a nova chegar).
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const src = useAvatarUrl(photo);
  const loaded = src !== null && loadedSrc === src;
  useEffect(() => setFailed(false), [photo]);
  const tones = ['bg-navy text-white dark:text-page', 'bg-teal text-white dark:text-page', 'bg-ink text-page', 'bg-brand text-white dark:text-page'];
  const palette = tones[Math.abs(tone) % tones.length];
  const dims = AVATAR_DIMS[size];
  // As iniciais ficam por baixo até a foto terminar de carregar; aí a foto aparece por cima, suave.
  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold ${dims} ${palette}`} aria-hidden>
      {initials(name)}
      {src && !failed && (
        <img
          // Foto já em cache dispara o load antes do React ligar o evento: confere ao montar.
          ref={(img) => {
            if (img?.complete && img.naturalWidth > 0 && !loaded) setLoadedSrc(src);
          }}
          src={src}
          alt=""
          decoding="async"
          onLoad={() => setLoadedSrc(src)}
          onError={() => setFailed(true)}
          className={`absolute inset-0 h-full w-full rounded-full bg-subtle object-cover transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
    </span>
  );
}

/** Índice estável para escolher a cor do avatar a partir do nome. */
export function toneFor(name: string | null): number {
  let h = 0;
  for (const ch of name ?? '') h = (h * 31 + ch.charCodeAt(0)) | 0;
  return h;
}

/**
 * Inclinação sutil e "aleatória" das medalhas (5° a 14°, para um lado ou para o
 * outro). Vem de um hash da semente: cada medalha tem o seu ângulo, mas ele não
 * muda a cada renderização.
 */
export function medalTilt(seed: string): CSSProperties {
  const h = Math.abs(Math.imul(toneFor(seed), 2654435761 | 0)) % 1000;
  const deg = (5 + (h % 10)) * (h % 2 === 0 ? 1 : -1);
  return { transform: `rotate(${deg}deg)` };
}

export function SuggestionStatusChip({ status }: { status: SuggestionStatus }) {
  const s = SUGGESTION_STATUS[status];
  return <span className={`chip font-medium ${s.chip}`}>{s.label}</span>;
}

export function ProjectStatusLabel({ status }: { status: ProjectStatus }) {
  const s = PROJECT_STATUS[status];
  return (
    <span className="inline-flex items-center gap-2 text-sm font-medium text-ink">
      <span className={`h-2.5 w-2.5 rounded-full ${s.dot}`} aria-hidden />
      {s.label}
    </span>
  );
}

export function TypeChip({ slug, label }: { slug: string; label: string }) {
  return <span className={`chip ${typeChipClass(slug)}`}>{label}</span>;
}

export function LoadMore({
  hasMore,
  loading,
  onClick,
  label = 'Carregar mais',
}: {
  hasMore: boolean;
  loading: boolean;
  onClick: () => void;
  label?: string;
}) {
  if (!hasMore) return null;
  return (
    <div className="mt-6 flex justify-center">
      <button type="button" className="btn-secondary" onClick={onClick} disabled={loading}>
        {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {label}
      </button>
    </div>
  );
}

export function CharCounter({ value, max }: { value: string; max: number }) {
  const length = value.trim().length;
  return (
    <span className={`text-xs ${length > max ? 'text-danger' : 'text-muted'}`} aria-live="polite">
      {length}/{max}
    </span>
  );
}

interface PageContainerProps {
  children: ReactNode;
  narrow?: boolean;
  /**
   * "Voltar" da página. `to`/`label` são o nível acima na hierarquia, usado quando
   * não há página anterior no app (link aberto direto); havendo, volta para ela.
   */
  back?: BackTarget;
}

/** Voltar padrão de todas as páginas: mesmo lugar (alinhado ao logo), mesmo formato. */
export function BackLink({ fallback }: { fallback: BackTarget }) {
  const back = useBack(fallback);
  return (
    <a
      href={back.href}
      onClick={(e) => {
        // Ctrl/Cmd/Shift/botão do meio: deixa o navegador abrir em nova aba/janela.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        back.go();
      }}
      className="ml-5 inline-flex max-w-[calc(100%-1.25rem)] items-center gap-2 text-[0.9375rem] text-muted transition-colors duration-200 hover:text-ink sm:ml-9 sm:max-w-[60%]"
    >
      <ArrowLeft className="h-5 w-5 shrink-0" aria-hidden />
      <span className="truncate">Voltar para {back.label}</span>
    </a>
  );
}

export function PageContainer({ children, narrow = false, back }: PageContainerProps) {
  return (
    <>
      {back && (
        <nav className="page-wide pt-6" aria-label="Navegação da página">
          <BackLink fallback={back} />
        </nav>
      )}
      <div
        className={`${narrow ? 'page-narrow' : 'page-wide'} ${back ? 'pt-8 sm:pt-12' : 'pt-8 sm:pt-10'}`}
      >
        {children}
      </div>
    </>
  );
}
