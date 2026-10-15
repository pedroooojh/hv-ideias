import { useEffect, useRef } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { UserRound } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { ThemeToggle } from './ThemeToggle';

const iconButton =
  'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-subtle/70 text-ink transition-colors duration-200 hover:bg-subtle hover:text-brand sm:h-11 sm:w-11';

export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex flex-col ${className}`}>
      <span className="logo-mask block h-[19px] w-[102px] bg-navy min-[360px]:h-[22px] min-[360px]:w-[118px] dark:bg-ink min-[400px]:h-[28px] min-[400px]:w-[152px] sm:h-[28px] sm:w-[152px]" aria-hidden />
      <span className="sr-only">Hubvision Ideias</span>
    </span>
  );
}

function Header() {
  const { profile } = useAuth();
  const ref = useRef<HTMLElement>(null);

  // Publica a altura real do cabeçalho em --header-h, para seções que ocupam
  // exatamente o restante da primeira tela (ex.: o hero da página inicial).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => document.documentElement.style.setProperty('--header-h', `${el.offsetHeight}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Intensidade do desfoque atrás do cabeçalho: 0 no topo da página, chegando a 1
  // suavemente nos primeiros 120px de rolagem.
  useEffect(() => {
    const root = document.documentElement;
    const update = () => root.style.setProperty('--hv-veil', Math.min(1, Math.max(0, window.scrollY / 120)).toFixed(3));
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => {
      window.removeEventListener('scroll', update);
      root.style.removeProperty('--hv-veil');
    };
  }, []);

  return (
    <>
      {/* Faixa de desfoque progressivo (mais forte no topo, some para baixo) atrás do cabeçalho. */}
      <div aria-hidden className="hv-header-veil pointer-events-none fixed inset-x-0 top-0 z-30">
        <div className="hv-veil-layer hv-veil-1" />
        <div className="hv-veil-layer hv-veil-2" />
        <div className="hv-veil-layer hv-veil-3" />
      </div>
    <header ref={ref} className="page-wide sticky top-0 z-40 pt-4">
      <div className="flex items-center justify-between gap-2 rounded-xl border border-line/70 bg-surface/85 py-2.5 pl-5 pr-2.5 shadow-header backdrop-blur sm:gap-3 sm:py-3.5 sm:pl-9 sm:pr-5">
        <Link to="/" className="shrink-0 rounded-lg" aria-label="Hubvision Ideias — página inicial">
          <Logo />
        </Link>
        <nav className="flex items-center gap-1.5 sm:gap-3" aria-label="Navegação principal">
          <ThemeToggle className={`${iconButton} hidden sm:inline-flex`} />
          <NavLink
            to="/perfil"
            className={iconButton}
            aria-label={`Meu perfil (${profile?.name ?? 'conta'})`}
            title="Meu perfil"
          >
            <UserRound className="h-5 w-5" />
          </NavLink>
          <NavLink
            to="/ranking"
            className={({ isActive }) =>
              `inline-flex h-9 shrink-0 items-center rounded-lg border-2 px-3 text-xs font-semibold tracking-wide transition-colors duration-200 sm:h-11 sm:px-6 sm:text-sm ${
                isActive
                  ? 'border-brand bg-brand text-white dark:text-page'
                  : 'border-brand/70 text-brand hover:bg-brand-soft'
              }`
            }
          >
            RANKING
          </NavLink>
        </nav>
      </div>
    </header>
    </>
  );
}

/** Remonta (e faz o fade) só quando muda a página, não quando mudam filtros na URL. */
function PageTransition() {
  const { pathname } = useLocation();
  return (
    <div key={pathname} className="animate-fade-in">
      <Outlet />
    </div>
  );
}

function Footer() {
  // Nas páginas do fórum (projeto e sugestão) o rodapé segue o design dessas telas.
  const { pathname } = useLocation();
  const forum = /^\/(projetos|sugestoes)\/./.test(pathname);
  return (
    <footer className="mt-24 border-t border-line bg-surface">
      <div className="page-wide flex flex-col gap-4 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
        <p>
          © {new Date().getFullYear()}{' '}
          {forum ? 'Hubvision. Painel de Melhorias e Ideias de Produto.' : 'Hubvision Inovação e Negócios. Todos os direitos reservados.'}
        </p>
        <nav className="flex gap-6" aria-label="Rodapé">
          <Link to="/diretrizes" className="hover:text-ink">
            Diretrizes
          </Link>
          <Link to="/ranking" className="hover:text-ink">
            Ranking
          </Link>
          <ThemeToggle className="inline-flex items-center gap-1 hover:text-ink sm:hidden" />
        </nav>
      </div>
    </footer>
  );
}

export function Layout() {
  return (
    <div className="flex min-h-screen flex-col overflow-x-clip">
      <a
        href="#conteudo"
        className="sr-only z-50 rounded-lg bg-surface px-4 py-2 focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Pular para o conteúdo
      </a>
      <Header />
      <main id="conteudo" className="flex-1">
        <PageTransition />
      </main>
      <Footer />
    </div>
  );
}
