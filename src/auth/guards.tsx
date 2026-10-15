import type { ReactNode } from 'react';
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { Loader2, LogOut, RefreshCw, ShieldAlert, UserX } from 'lucide-react';
import { errorMessage } from '@/lib/errors';
import { Logo } from '@/components/Layout';
import { PageContainer } from '@/components/ui';
import { usePageTitle } from '@/lib/navigation';
import { useAuth } from './AuthProvider';

// Toda a navegação passa por estes guardas. Eles controlam só o que a tela
// mostra: as permissões de verdade são checadas no banco, em cada função RPC.

function FullScreenLoading() {
  return (
    <div role="status" className="flex min-h-screen animate-fade-in items-center justify-center gap-2 text-sm text-muted">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> Carregando…
    </div>
  );
}

function AccountNotice({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen animate-fade-in items-center justify-center px-4">
      <div className="card w-full max-w-md p-8 text-center">
        <div className="flex justify-center">
          <Logo />
        </div>
        <div className="mx-auto mt-8 flex h-12 w-12 items-center justify-center rounded-lg bg-danger/10 text-danger">{icon}</div>
        <h1 className="mt-4 text-2xl font-bold text-ink">{title}</h1>
        {children}
      </div>
    </div>
  );
}

/** Rotas do app: exigem sessão, perfil carregado e conta ativa. */
export function RequireAuth() {
  const { user, profile, loading, profileError, retryProfile, signOut } = useAuth();
  const location = useLocation();

  if (loading) return <FullScreenLoading />;
  if (!user) return <Navigate to="/entrar" replace state={{ from: location.pathname + location.search }} />;

  const signOutButton = (
    <button type="button" className="btn-secondary" onClick={() => void signOut()}>
      <LogOut className="h-4 w-4" aria-hidden /> Sair
    </button>
  );

  if (profileError || !profile) {
    return (
      <AccountNotice icon={<ShieldAlert className="h-6 w-6" />} title="Não foi possível carregar sua conta">
        <p className="mt-2 text-muted">
          {profileError ? errorMessage(profileError) : 'Seu perfil não foi encontrado. Procure um administrador.'}
        </p>
        <div className="mt-6 flex justify-center gap-2">
          {signOutButton}
          {Boolean(profileError) && (
            <button type="button" className="btn-primary" onClick={retryProfile}>
              <RefreshCw className="h-4 w-4" aria-hidden /> Tentar novamente
            </button>
          )}
        </div>
      </AccountNotice>
    );
  }

  if (profile.status !== 'active') {
    return (
      <AccountNotice icon={<UserX className="h-6 w-6" />} title="Conta desativada">
        <p className="mt-2 text-muted">
          Sua conta foi desativada e não tem acesso à plataforma. Procure um administrador da Hubvision.
        </p>
        <div className="mt-6 flex justify-center">{signOutButton}</div>
      </AccountNotice>
    );
  }

  return <Outlet />;
}

/** Rotas exclusivas de administrador (dentro de RequireAuth). */
export function RequireAdmin() {
  const { isAdmin } = useAuth();
  usePageTitle(isAdmin ? null : 'Acesso restrito');
  if (isAdmin) return <Outlet />;
  return (
    <PageContainer narrow back={{ to: '/', label: 'Início' }}>
      <div className="card p-10 text-center">
        <h1 className="text-2xl font-bold text-ink">Acesso restrito</h1>
        <p className="mt-2 text-muted">Esta área é exclusiva para administradores.</p>
        <Link to="/" className="btn-secondary mt-6">
          Voltar ao início
        </Link>
      </div>
    </PageContainer>
  );
}

/** Tela de entrada: quem já está logado volta para onde ia (ou para o início). */
export function PublicOnly() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullScreenLoading />;
  if (user) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from && from.startsWith('/') ? from : '/'} replace />;
  }
  return <Outlet />;
}
