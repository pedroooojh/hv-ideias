import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';

// Navegação do app: registra o caminho percorrido (com o título de cada página)
// para que o "Voltar" leve de fato à página anterior e diga qual é; guarda a
// posição de rolagem de cada página para restaurá-la ao voltar.

interface Entry {
  key: string;
  path: string;
  title: string;
}

interface NavigationContextValue {
  entries: Entry[];
  setTitle: (key: string, title: string) => void;
}

const NavigationContext = createContext<NavigationContextValue | null>(null);
const STACK_KEY = 'hv-nav-stack';
const SCROLL_KEY = 'hv-nav-scroll';
const APP_NAME = 'Hubvision Ideias';
/** Telas que nunca são destino do "Voltar" (autenticação). */
const NOT_BACK_TARGETS = ['/entrar', '/redefinir-senha'];

function readSession<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeSession(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // armazenamento indisponível: o voltar usa o destino padrão de cada página
  }
}

export function NavigationProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigationType = useNavigationType();
  const titles = useRef<Record<string, string>>({});
  const [entries, setEntries] = useState<Entry[]>(() => readSession<Entry[]>(STACK_KEY, []));

  // Mantém a pilha alinhada ao histórico do navegador.
  useEffect(() => {
    setEntries((prev) => {
      const path = location.pathname + location.search;
      const index = prev.findIndex((e) => e.key === location.key);
      const title = titles.current[location.key] ?? (index >= 0 ? prev[index].title : '');
      const entry: Entry = { key: location.key, path, title };
      let next: Entry[];
      if (index >= 0) {
        // Voltou (ou recarregou) para uma página conhecida: descarta o que vinha depois.
        next = [...prev.slice(0, index), entry];
      } else if (navigationType === 'REPLACE' && prev.length > 0) {
        next = [...prev.slice(0, -1), entry];
      } else {
        next = [...prev, entry].slice(-50);
      }
      writeSession(STACK_KEY, next);
      return next;
    });
  }, [location.key, location.pathname, location.search, navigationType]);

  const setTitle = useCallback((key: string, title: string) => {
    titles.current[key] = title;
    setEntries((prev) => {
      if (!prev.some((e) => e.key === key && e.title !== title)) return prev;
      const next = prev.map((e) => (e.key === key ? { ...e, title } : e));
      writeSession(STACK_KEY, next);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ entries, setTitle }), [entries, setTitle]);
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

function useNavigationContext() {
  const ctx = useContext(NavigationContext);
  if (!ctx) throw new Error('Use dentro de <NavigationProvider>.');
  return ctx;
}

/** Define o título da página (aba do navegador e rótulo do "Voltar" de quem vier depois). */
export function usePageTitle(title: string | null | undefined) {
  const { setTitle } = useNavigationContext();
  const location = useLocation();
  useEffect(() => {
    if (!title) return;
    document.title = `${title} · ${APP_NAME}`;
    setTitle(location.key, title);
  }, [title, location.key, setTitle]);
}

export interface BackTarget {
  /** Destino quando não há página anterior no app (link aberto direto, nova aba). */
  to: string;
  label: string;
}

/** Para onde o "Voltar" leva: a página anterior real, ou o nível acima na hierarquia. */
export function useBack(fallback: BackTarget): { label: string; go: () => void; href: string } {
  const { entries } = useNavigationContext();
  const location = useLocation();
  const navigate = useNavigate();
  const index = entries.findIndex((e) => e.key === location.key);
  const previous = index > 0 ? entries[index - 1] : null;
  const usable =
    previous && previous.title && !NOT_BACK_TARGETS.some((p) => previous.path.startsWith(p));

  if (usable) {
    return { label: previous.title, href: previous.path, go: () => navigate(-1) };
  }
  return { label: fallback.label, href: fallback.to, go: () => navigate(fallback.to) };
}

/** Rolagem: topo ao abrir uma página nova; posição anterior ao voltar/avançar/recarregar. */
export function ScrollManager() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const positions = useRef<Record<string, number>>(readSession(SCROLL_KEY, {}));

  useEffect(() => {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  }, []);

  // Salva a posição da página atual enquanto o usuário rola.
  useEffect(() => {
    const key = location.key;
    let timer = 0;
    const save = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        positions.current[key] = window.scrollY;
        writeSession(SCROLL_KEY, positions.current);
      }, 100);
    };
    window.addEventListener('scroll', save, { passive: true });
    return () => {
      window.clearTimeout(timer);
      positions.current[key] = window.scrollY;
      writeSession(SCROLL_KEY, positions.current);
      window.removeEventListener('scroll', save);
    };
  }, [location.key]);

  const lastPath = useRef<string | null>(null);
  useLayoutEffect(() => {
    // Trocar filtro (replace na mesma página) não mexe na rolagem.
    const samePage = lastPath.current === location.pathname;
    lastPath.current = location.pathname;
    if (navigationType === 'REPLACE' && samePage) return;

    const target = navigationType === 'POP' ? positions.current[location.key] : undefined;
    if (target === undefined) {
      // Link com âncora (ex.: #discussao): rola até a seção assim que ela existir.
      const anchor = location.hash ? decodeURIComponent(location.hash.slice(1)) : '';
      if (!anchor) {
        window.scrollTo(0, 0);
        return;
      }
      let tries = 0;
      let anchorTimer = 0;
      const toAnchor = () => {
        const el = document.getElementById(anchor);
        if (el) el.scrollIntoView({ block: 'start' });
        else if (tries++ < 40) anchorTimer = window.setTimeout(toAnchor, 50);
      };
      toAnchor();
      return () => window.clearTimeout(anchorTimer);
    }
    // O conteúdo pode ainda estar chegando: tenta até a página ter altura suficiente.
    let attempts = 0;
    let timer = 0;
    const restore = () => {
      window.scrollTo(0, target);
      if (Math.abs(window.scrollY - target) > 2 && attempts++ < 20) timer = window.setTimeout(restore, 50);
    };
    restore();
    return () => window.clearTimeout(timer);
    // Só ao trocar de página (filtros na URL usam replace e não devem rolar).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  return null;
}
