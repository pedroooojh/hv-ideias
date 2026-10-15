import { useId, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, AtSign, KeyRound, Loader2, MailCheck, UserRound } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { LIMITS, lengthError } from '@/lib/domain';
import { FormError } from '@/components/Modal';
import { AuthField, AuthShell } from '@/components/AuthShell';
import { DemoLogin } from '@/components/DemoLogin';
import { usePageTitle } from '@/lib/navigation';

type Mode = 'login' | 'signup' | 'forgot';
const MIN_PASSWORD = 8;

/** Traduz as mensagens mais comuns do Supabase Auth. */
function authMessage(message: string): string {
  if (/invalid login credentials/i.test(message)) return 'E-mail ou senha incorretos.';
  if (/email not confirmed/i.test(message)) return 'Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.';
  if (/user already registered/i.test(message)) return 'Já existe uma conta com este e-mail.';
  if (/password should be at least/i.test(message)) return `A senha deve ter pelo menos ${MIN_PASSWORD} caracteres.`;
  if (/rate limit|too many/i.test(message)) return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
  if (/signups not allowed/i.test(message)) return 'Novos cadastros estão desativados. Fale com um administrador.';
  if (/failed to fetch|network/i.test(message)) return 'Não foi possível conectar ao servidor. Verifique sua conexão.';
  return 'Não foi possível concluir a operação. Tente novamente.';
}

const COPY: Record<Mode, { title: string; subtitle: string; submit: string }> = {
  login: {
    title: 'Bem-vindo de volta',
    subtitle: 'Insira suas credenciais para acessar o painel de melhorias, sugerir novas ideias e votar em projetos ativos.',
    submit: 'Entrar na plataforma',
  },
  signup: {
    title: 'Crie sua conta',
    subtitle: 'Cadastre-se para sugerir ideias, votar e acompanhar a evolução dos projetos da Hubvision.',
    submit: 'Criar conta',
  },
  forgot: {
    title: 'Recuperar senha',
    subtitle: 'Informe seu e-mail corporativo para receber o link de redefinição de senha.',
    submit: 'Enviar link de recuperação',
  },
};

export function LoginPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = (location.state ?? {}) as { from?: string; mode?: Mode };
  const from = state.from && state.from.startsWith('/') ? state.from : '/';

  const id = useId();
  const [mode, setMode] = useState<Mode>(state.mode ?? 'login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const switchMode = (next: Mode) => {
    setMode(next);
    setErrors({});
    setFormError(null);
    setNotice(null);
  };

  const validate = () => {
    const next: Record<string, string> = {};
    if (mode === 'signup') {
      const n = lengthError(name, 'Nome', LIMITS.profileName);
      if (n) next.name = n;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) next.email = 'Informe um e-mail válido.';
    if (mode === 'login' && password.length === 0) next.password = 'Informe sua senha.';
    if (mode === 'signup' && password.length < MIN_PASSWORD) {
      next.password = `A senha deve ter pelo menos ${MIN_PASSWORD} caracteres.`;
    }
    return next;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found = validate();
    setErrors(found);
    setFormError(null);
    setNotice(null);
    if (Object.keys(found).length > 0) return;

    setPending(true);
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        navigate(from, { replace: true });
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { name: name.trim() }, emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        if (data.session) navigate(from, { replace: true });
        else {
          setNotice('Conta criada! Enviamos um link de confirmação para o seu e-mail. Depois de confirmar, é só entrar.');
          setMode('login');
          setPassword('');
        }
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/redefinir-senha`,
        });
        if (error) throw error;
        setNotice('Se houver uma conta com este e-mail, você receberá um link para redefinir a senha.');
      }
    } catch (err) {
      setFormError(authMessage((err as Error).message ?? ''));
    } finally {
      setPending(false);
    }
  };

  const copy = COPY[mode];
  usePageTitle(copy.title);

  return (
    <AuthShell>
      <div key={mode} className="animate-fade-in">
      <h1 className="text-[1.875rem] font-bold leading-tight tracking-[-0.02em] text-ink sm:text-[2.125rem]">{copy.title}</h1>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted">{copy.subtitle}</p>

      <form onSubmit={submit} noValidate className="mt-8 space-y-5 border-t border-line pt-8">
        {formError && <FormError message={formError} />}
        {notice && (
          <div role="status" className="flex gap-2 rounded-xl border border-success/25 bg-success/10 px-3.5 py-2.5 text-sm text-ink">
            <MailCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
            {notice}
          </div>
        )}

        {mode === 'signup' && (
          <AuthField
            id={`${id}-name`}
            label="Nome completo"
            icon={<UserRound className="h-4 w-4" />}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            placeholder="Como você quer aparecer no ranking"
            error={errors.name}
          />
        )}

        <AuthField
          id={`${id}-email`}
          label="E-mail corporativo"
          icon={<AtSign className="h-4 w-4" />}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          placeholder="nome@empresa.com.br"
          error={errors.email}
        />

        {mode !== 'forgot' && (
          <AuthField
            id={`${id}-password`}
            label="Senha de acesso"
            icon={<KeyRound className="h-4 w-4" />}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            error={errors.password}
            hint={mode === 'signup' ? `Mínimo de ${MIN_PASSWORD} caracteres.` : undefined}
            labelAction={
              mode === 'login' ? (
                <button type="button" className="text-xs font-semibold text-brand hover:underline" onClick={() => switchMode('forgot')}>
                  Esqueceu a senha?
                </button>
              ) : undefined
            }
          />
        )}

        <button type="submit" className="btn-primary w-full py-3.5 text-[0.9375rem]" disabled={pending}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {copy.submit}
          {!pending && <ArrowRight className="h-4 w-4" aria-hidden />}
        </button>
      </form>

      {mode === 'login' && (
        <DemoLogin onSuccess={() => navigate(from, { replace: true })} onError={setFormError} />
      )}

      <p className="mt-8 border-t border-line pt-6 text-center text-sm text-muted">
        {mode === 'login' ? (
          <>
            Ainda não tem conta corporativa?{' '}
            <button type="button" className="font-semibold text-brand hover:underline" onClick={() => switchMode('signup')}>
              Cadastre-se
            </button>
          </>
        ) : mode === 'signup' ? (
          <>
            Já tem uma conta?{' '}
            <button type="button" className="font-semibold text-brand hover:underline" onClick={() => switchMode('login')}>
              Entrar
            </button>
          </>
        ) : (
          <>
            Lembrou a senha?{' '}
            <button type="button" className="font-semibold text-brand hover:underline" onClick={() => switchMode('login')}>
              Voltar para o login
            </button>
          </>
        )}
      </p>
      </div>
    </AuthShell>
  );
}
