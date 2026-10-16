import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { useIsRestoring, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { api, qk, type Profile } from '@/lib/api';
import { clearAvatarUrls } from '@/lib/avatarUrls';
import { getCacheOwner, setCacheOwner } from '@/lib/queryCache';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  /** true enquanto a sessão inicial ou o perfil ainda estão carregando */
  loading: boolean;
  isAdmin: boolean;
  /** conta autenticada e ativa: pode publicar, votar e comentar */
  canParticipate: boolean;
  isDisabled: boolean;
  /** falha ao carregar o perfil (ex.: rede) — as rotas protegidas mostram erro com nova tentativa */
  profileError: unknown;
  retryProfile: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setSessionLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      // Não chamar o Supabase dentro deste callback (pode travar o cliente);
      // apenas atualizamos o estado e o React Query recarrega o perfil.
      setSession(next);
      setSessionLoading(false);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const userId = session?.user.id;
  const profileQuery = useQuery({
    queryKey: qk.profile(userId),
    queryFn: api.getMyProfile,
    enabled: Boolean(userId),
    staleTime: 60_000,
  });

  // Dados que dependem do usuário (has_voted, is_author, can_edit…) mudam de uma
  // conta para outra. O cache (inclusive o salvo no navegador) pertence a um único
  // usuário: se a sessão for de outra pessoa, ele é descartado antes de ser usado.
  const isRestoring = useIsRestoring();
  useEffect(() => {
    if (sessionLoading || isRestoring) return;
    const owner = getCacheOwner();
    const current = userId ?? null;
    if (owner === current) return;
    queryClient.removeQueries({
      predicate: (q) => !(q.queryKey[0] === 'profile' && q.queryKey[1] === userId),
    });
    setCacheOwner(current);
  }, [userId, sessionLoading, isRestoring, queryClient]);

  const value = useMemo<AuthContextValue>(() => {
    const profile = profileQuery.data ?? null;
    const isActive = profile?.status === 'active';
    return {
      session,
      user: session?.user ?? null,
      profile,
      loading: sessionLoading || (Boolean(userId) && profileQuery.isPending),
      isAdmin: Boolean(profile && isActive && profile.role === 'admin'),
      canParticipate: Boolean(profile && isActive),
      isDisabled: profile?.status === 'disabled',
      profileError: profileQuery.error,
      retryProfile: () => void profileQuery.refetch(),
      signOut: async () => {
        await supabase.auth.signOut();
        queryClient.clear();
        clearAvatarUrls();
        setCacheOwner(null);
      },
    };
  }, [session, sessionLoading, userId, profileQuery, queryClient]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>.');
  return ctx;
}
