import { useId, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, KeyRound, Loader2 } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { supabase } from '@/lib/supabase';
import { FormError } from '@/components/Modal';
import { AuthField, AuthShell } from '@/components/AuthShell';
import { useToast } from '@/components/Toast';
import { usePageTitle } from '@/lib/navigation';

/** Destino do link de recuperação enviado por e-mail: o Supabase abre uma sessão temporária. */
export function ResetPasswordPage() {
  // Convite: a pessoa ainda não tem senha; o texto muda de "nova senha" para "crie sua senha".
  const invited = useSearchParams()[0].has('convite');
  usePageTitle(invited ? 'Crie sua senha' : 'Redefinir senha');
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const id = useId();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (loading) {
    return (
      <AuthShell>
        <p role="status" className="inline-flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Validando o link…
        </p>
      </AuthShell>
    );
  }

  if (!user) {
    return (
      <AuthShell>
        <h1 className="text-3xl font-bold tracking-tight text-ink">Link inválido ou expirado</h1>
        <p className="mt-3 text-[0.9375rem] text-muted">Solicite um novo link de recuperação na tela de login.</p>
        <Link to="/entrar" state={{ mode: 'forgot' }} className="btn-primary mt-8 w-full py-3.5">
          Solicitar novo link <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </AuthShell>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (password.length < 8) next.password = 'A senha deve ter pelo menos 8 caracteres.';
    if (password !== confirm) next.confirm = 'As senhas não coincidem.';
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length > 0) return;
    setPending(true);
    const { error } = await supabase.auth.updateUser({ password });
    setPending(false);
    if (error) {
      setFormError('Não foi possível alterar a senha. Solicite um novo link e tente novamente.');
      return;
    }
    toast.success(invited ? 'Senha criada. Boas-vindas ao Hubvision Ideias!' : 'Senha alterada com sucesso.');
    navigate('/', { replace: true });
  };

  return (
    <AuthShell>
      <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">{invited ? 'Crie sua senha' : 'Definir nova senha'}</h1>
      <p className="mt-3 text-[0.9375rem] text-muted">
        {invited
          ? 'Boas-vindas ao Hubvision Ideias! Defina uma senha para entrar na plataforma.'
          : 'Escolha uma nova senha para acessar a plataforma.'}
      </p>
      <form onSubmit={submit} noValidate className="mt-8 space-y-5 border-t border-line pt-8">
        {formError && <FormError message={formError} />}
        <AuthField
          id={`${id}-pw`}
          label="Nova senha"
          icon={<KeyRound className="h-4 w-4" />}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          hint="Mínimo de 8 caracteres."
          error={errors.password}
        />
        <AuthField
          id={`${id}-pw2`}
          label="Confirmar nova senha"
          icon={<KeyRound className="h-4 w-4" />}
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          error={errors.confirm}
        />
        <button type="submit" className="btn-primary w-full py-3.5" disabled={pending}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Salvar nova senha
        </button>
      </form>
    </AuthShell>
  );
}
