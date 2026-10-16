import { Component, type ErrorInfo, type ReactNode } from 'react';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { AuthProvider } from '@/auth/AuthProvider';
import { PublicOnly, RequireAdmin, RequireAuth } from '@/auth/guards';
import { NavigationProvider, ScrollManager, usePageTitle } from '@/lib/navigation';
import { persistOptions, queryClient } from '@/lib/queryCache';
import { isSupabaseConfigured } from '@/lib/supabase';
import { Layout } from '@/components/Layout';
import { OverlayScrollbar } from '@/components/OverlayScrollbar';
import { ToastProvider } from '@/components/Toast';
import { PageContainer } from '@/components/ui';
import { AdminPage } from '@/pages/AdminPage';
import { GuidelinesPage } from '@/pages/GuidelinesPage';
import { HomePage } from '@/pages/HomePage';
import { LoginPage } from '@/pages/LoginPage';
import { ProfilePage } from '@/pages/ProfilePage';
import { ProjectPage } from '@/pages/ProjectPage';
import { ProjectsPage } from '@/pages/ProjectsPage';
import { PublicProfilePage } from '@/pages/PublicProfilePage';
import { RankingPage } from '@/pages/RankingPage';
import { ResetPasswordPage } from '@/pages/ResetPasswordPage';
import { SuggestionPage } from '@/pages/SuggestionPage';

function NotFoundPage() {
  usePageTitle('Página não encontrada');
  return (
    <PageContainer narrow back={{ to: '/', label: 'Início' }}>
      <div className="card p-10 text-center">
        <h1 className="text-3xl font-bold text-ink">Página não encontrada</h1>
        <p className="mt-2 text-muted">O endereço acessado não existe ou foi removido.</p>
        <Link to="/" className="btn-primary mt-6">
          Voltar ao início
        </Link>
      </div>
    </PageContainer>
  );
}

function MissingConfig() {
  return (
    <div className="mx-auto max-w-xl px-4 pt-24">
      <div className="card p-8">
        <h1 className="text-2xl font-bold text-ink">Configuração pendente</h1>
        <p className="mt-3 text-muted">
          Defina <code className="rounded bg-subtle px-1.5 py-0.5 text-sm">VITE_SUPABASE_URL</code> e{' '}
          <code className="rounded bg-subtle px-1.5 py-0.5 text-sm">VITE_SUPABASE_ANON_KEY</code> no arquivo{' '}
          <code className="rounded bg-subtle px-1.5 py-0.5 text-sm">.env.local</code> (veja{' '}
          <code className="rounded bg-subtle px-1.5 py-0.5 text-sm">.env.example</code> e o README) e reinicie o servidor.
        </p>
      </div>
    </div>
  );
}

/** Evita tela em branco: qualquer erro de renderização vira uma mensagem com opção de recarregar. */
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[app] erro de renderização', error, info.componentStack);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="mx-auto max-w-xl px-4 pt-24">
        <div className="card p-8 text-center">
          <h1 className="text-2xl font-bold text-ink">Algo deu errado</h1>
          <p className="mt-2 text-muted">Ocorreu um erro inesperado ao exibir esta página.</p>
          <button type="button" className="btn-primary mt-6" onClick={() => window.location.reload()}>
            Recarregar
          </button>
        </div>
      </div>
    );
  }
}

export default function App() {
  if (!isSupabaseConfigured) return <MissingConfig />;
  return (
    <ErrorBoundary>
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <NavigationProvider>
            <ScrollManager />
            <OverlayScrollbar />
            <Routes>
              {/* Públicas: só entrar/cadastrar e o destino do link de recuperação de senha. */}
              <Route element={<PublicOnly />}>
                <Route path="entrar" element={<LoginPage />} />
              </Route>
              <Route path="redefinir-senha" element={<ResetPasswordPage />} />

              {/* Todo o resto exige login e conta ativa. */}
              <Route element={<RequireAuth />}>
                <Route element={<Layout />}>
                  <Route index element={<HomePage />} />
                  <Route path="projetos" element={<ProjectsPage />} />
                  <Route path="projetos/:projectId" element={<ProjectPage />} />
                  <Route path="sugestoes/:suggestionId" element={<SuggestionPage />} />
                  <Route path="ranking" element={<RankingPage />} />
                  <Route path="perfil" element={<ProfilePage />} />
                  <Route path="pessoas/:userId" element={<PublicProfilePage />} />
                  <Route path="diretrizes" element={<GuidelinesPage />} />
                  {/* Exclusivas de administrador. */}
                  <Route element={<RequireAdmin />}>
                    <Route path="admin" element={<AdminPage />} />
                  </Route>
                  <Route path="*" element={<NotFoundPage />} />
                </Route>
              </Route>
            </Routes>
            </NavigationProvider>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </PersistQueryClientProvider>
    </ErrorBoundary>
  );
}
