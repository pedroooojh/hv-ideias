import { QueryClient, type Query } from '@tanstack/react-query';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import type { PersistQueryClientOptions } from '@tanstack/react-query-persist-client';
import { toApiError } from './errors';

// Cache entre recargas: os últimos dados ficam no navegador e as telas abrem na
// hora; em seguida o React Query busca a versão atual no banco. É só um atalho
// de exibição — permissões e regras continuam sendo checadas no servidor.

const CACHE_KEY = 'hv-ideias-cache';
const OWNER_KEY = 'hv-ideias-cache-owner';
/** Mude ao alterar o formato dos dados das RPCs: invalida caches antigos. */
const CACHE_VERSION = '1';
const DAY = 24 * 60 * 60 * 1000;

/** Dados administrativos com informação pessoal (e-mails, auditoria) não vão para o navegador. */
const NOT_PERSISTED = new Set(['admin-users', 'audit-log']);

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      // Precisa ser >= maxAge do cache persistido, senão os dados restaurados somem antes de usar.
      gcTime: DAY,
      refetchOnWindowFocus: true,
      // Não insiste em erros definitivos (permissão, registro inexistente, validação).
      retry: (failureCount, error) => {
        const kind = toApiError(error).kind;
        return (kind === 'network' || kind === 'unknown') && failureCount < 2;
      },
    },
  },
});

function safeStorage(): Storage | undefined {
  try {
    const probe = '__hv_probe__';
    window.localStorage.setItem(probe, probe);
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return undefined; // modo privado/bloqueado: o app funciona sem cache persistente
  }
}

const storage = safeStorage();

export const persistOptions: Omit<PersistQueryClientOptions, 'queryClient'> = {
  persister: createSyncStoragePersister({ storage, key: CACHE_KEY, throttleTime: 1000 }),
  maxAge: DAY,
  buster: CACHE_VERSION,
  dehydrateOptions: {
    shouldDehydrateQuery: (query: Query) =>
      query.state.status === 'success' && !NOT_PERSISTED.has(String(query.queryKey[0])),
  },
};

/** Usuário dono do cache salvo (para não mostrar dados de uma conta a outra). */
export function getCacheOwner(): string | null {
  try {
    return storage?.getItem(OWNER_KEY) ?? null;
  } catch {
    return null;
  }
}

export function setCacheOwner(userId: string | null): void {
  try {
    if (userId) storage?.setItem(OWNER_KEY, userId);
    else storage?.removeItem(OWNER_KEY);
  } catch {
    // sem armazenamento: nada a fazer
  }
}
