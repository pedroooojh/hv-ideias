import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { EmailOtpType } from '@supabase/supabase-js';
import { ArrowRight, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { usePageTitle } from '@/lib/navigation';
import { AuthShell } from '@/components/AuthShell';
import { useToast } from '@/components/Toast';

const TYPES: EmailOtpType[] = ['email', 'signup', 'invite', 'magiclink', 'recovery', 'email_change'];

const SUCCESS: Partial<Record<EmailOtpType, string>> = {
  email: 'E-mail confirmado. Boas-vindas!',
  signup: 'E-mail confirmado. Boas-vindas!',
  email_change: 'Confirmação registrada. Se a troca pedir os dois e-mails, confirme também no outro endereço.',
};

/** Só caminhos internos ("/perfil"), nunca outro site ("//exemplo.com" ou "https://..."). */
function safeNext(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') ? value : '/';
}

/**
 * Destino dos links dos e-mails do Supabase (templates em supabase/templates).
 * O e-mail traz só o token; a validação acontece aqui, no navegador, depois que a
 * pessoa abre a página. Assim o antivírus do e-mail, que "visita" os links antes,
 * não consome o token de uso único.
 */
export function ConfirmPage() {
  usePageTitle('Validando link');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    // O token é de uso único: não pode ser enviado duas vezes (StrictMode roda efeitos em dobro).
    if (started.current) return;
    started.current = true;
    const tokenHash = params.get('token_hash');
    const type = params.get('type') as EmailOtpType | null;
    const next = safeNext(params.get('next'));
    if (!tokenHash || !type || !TYPES.includes(type)) {
      setFailed(true);
      return;
    }
    supabase.auth.verifyOtp({ token_hash: tokenHash, type }).then(({ error }) => {
      if (error) {
        setFailed(true);
        return;
      }
      if (SUCCESS[type]) toast.success(SUCCESS[type]);
      navigate(next, { replace: true });
    });
  }, [params, navigate, toast]);

  if (failed) {
    return (
      <AuthShell>
        <h1 className="text-3xl font-bold tracking-tight text-ink">Link inválido ou expirado</h1>
        <p className="mt-3 text-[0.9375rem] text-muted">
          Os links enviados por e-mail valem por pouco tempo e só podem ser usados uma vez. Peça um novo na tela de login ou
          fale com a administração.
        </p>
        <Link to="/entrar" className="btn-primary mt-8 w-full py-3.5">
          Ir para o login <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <p role="status" className="inline-flex items-center gap-2 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Validando o link…
      </p>
    </AuthShell>
  );
}
