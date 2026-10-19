import { useEffect, useState } from 'react';
import { supabase } from './supabase';

// As fotos ficam num bucket privado: para exibir, o app pede links assinados
// (válidos por 1 hora). Os pedidos de uma mesma tela são agrupados numa única
// chamada e os links ficam guardados até perto de expirar — também entre
// recarregamentos da página. Cada pedido gera um link novo, então reaproveitar
// o mesmo link é o que deixa o navegador usar a imagem do cache em vez de
// baixá-la de novo.

const BUCKET = 'avatars';
const TTL_SECONDS = 3600;
/** Renova com folga para um link não vencer com a página aberta. */
const REFRESH_MARGIN_MS = 5 * 60_000;

const STORAGE_KEY = 'hv-avatar-urls';

type Entry = { url: string | null; expires: number };
const cache = new Map<string, Entry>(readStored());
const waiting = new Map<string, Array<(url: string | null) => void>>();
let timer: ReturnType<typeof setTimeout> | null = null;

function readStored(): [string, Entry][] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const entries = raw ? (JSON.parse(raw) as [string, Entry][]) : [];
    return entries.filter(([, e]) => e.url && e.expires - REFRESH_MARGIN_MS > Date.now());
  } catch {
    return [];
  }
}

/** Guarda só os links válidos (falhas são tentadas de novo na próxima visita). */
function persist() {
  try {
    const entries = [...cache.entries()].filter(([, e]) => e.url && e.expires - REFRESH_MARGIN_MS > Date.now());
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // armazenamento indisponível: os links valem só enquanto a página estiver aberta
  }
}

function fresh(path: string) {
  const hit = cache.get(path);
  return hit && hit.expires - REFRESH_MARGIN_MS > Date.now() ? hit : null;
}

async function flush() {
  timer = null;
  const batch = [...waiting.entries()];
  waiting.clear();
  const paths = batch.map(([path]) => path);
  let urls = new Map<string, string | null>();
  try {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrls(paths, TTL_SECONDS);
    urls = new Map((data ?? []).map((d) => [d.path ?? '', d.signedUrl ?? null]));
  } catch {
    // Sem link, o Avatar mostra as iniciais.
  }
  const expires = Date.now() + TTL_SECONDS * 1000;
  for (const [path, resolvers] of batch) {
    const url = urls.get(path) ?? null;
    // Falha: tenta de novo daqui a um minuto, não a cada renderização.
    cache.set(path, { url, expires: url ? expires : Date.now() + 60_000 + REFRESH_MARGIN_MS });
    resolvers.forEach((resolve) => resolve(url));
  }
  persist();
}

export function getAvatarUrl(path: string): Promise<string | null> {
  const hit = fresh(path);
  if (hit) return Promise.resolve(hit.url);
  return new Promise((resolve) => {
    waiting.set(path, [...(waiting.get(path) ?? []), resolve]);
    timer ??= setTimeout(flush, 15);
  });
}

/** Link assinado da foto (ou null enquanto carrega / sem foto / sem acesso). */
export function useAvatarUrl(path: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() => (path ? (fresh(path)?.url ?? null) : null));
  useEffect(() => {
    if (!path) return setUrl(null);
    let active = true;
    const hit = fresh(path);
    if (hit) setUrl(hit.url);
    else getAvatarUrl(path).then((next) => active && setUrl(next));
    return () => {
      active = false;
    };
  }, [path]);
  return url;
}

/** Esquece os links (ex.: ao sair da conta). */
export function clearAvatarUrls() {
  cache.clear();
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // nada guardado
  }
}
