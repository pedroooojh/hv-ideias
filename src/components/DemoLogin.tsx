import { useState } from 'react';
import { Loader2, ShieldCheck, UserRound } from 'lucide-react';
import { supabase } from '@/lib/supabase';

// Acesso rápido para desenvolvimento: faz login de verdade no emulador local com
// as contas de demonstração (scripts/local/seed.mjs). Não é um atalho de
// autenticação: sem o emulador em localhost e as variáveis de .env.emulator,
// o componente não aparece — e no build de produção essas variáveis não existem.
const DEMO_PASSWORD = import.meta.env.VITE_DEMO_PASSWORD;
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? '';

export const isDemoLoginEnabled =
  import.meta.env.VITE_DEMO_LOGIN === 'true' &&
  Boolean(DEMO_PASSWORD) &&
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(SUPABASE_URL);

const ACCOUNTS = [
  { email: 'admin@hv-ideias.test', label: 'Administrador', who: 'Equipe Hubvision', icon: ShieldCheck },
  { email: 'carlos@hv-ideias.test', label: 'Usuário comum', who: 'Carlos E.', icon: UserRound },
] as const;

export function DemoLogin({ onSuccess, onError }: { onSuccess: () => void; onError: (message: string) => void }) {
  const [pending, setPending] = useState<string | null>(null);
  if (!isDemoLoginEnabled) return null;

  const enter = async (email: string) => {
    setPending(email);
    const { error } = await supabase.auth.signInWithPassword({ email, password: DEMO_PASSWORD! });
    setPending(null);
    if (error) {
      onError('Não foi possível entrar com a conta de demonstração. O emulador local está rodando (npm run emulador)?');
      return;
    }
    onSuccess();
  };

  return (
    <section className="mt-8 rounded-lg border border-dashed border-warning/40 bg-warning/5 p-4" aria-labelledby="demo-titulo">
      <p id="demo-titulo" className="text-xs font-bold uppercase tracking-wide text-warning">
        Ambiente local de demonstração
      </p>
      <p className="mt-1 text-xs text-muted">Entre com uma conta de teste. Atalhos visíveis só no emulador local, nunca em produção.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {ACCOUNTS.map(({ email, label, who, icon: Icon }) => (
          <button
            key={email}
            type="button"
            className="btn-secondary flex-col items-start gap-0.5 px-3 py-2.5 text-left"
            aria-label={`Entrar como ${label.toLowerCase()} (${who})`}
            onClick={() => enter(email)}
            disabled={pending !== null}
          >
            <span className="inline-flex items-center gap-2">
              {pending === email ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Icon className="h-4 w-4 text-brand" aria-hidden />}
              {label}
            </span>
            <span className="text-xs font-normal text-muted">{who}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
