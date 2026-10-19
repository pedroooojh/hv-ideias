import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AtSign, Camera, Download, ImageIcon, KeyRound, Loader2, LogOut, MailCheck, ShieldAlert, Trash2, UserRound } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { api, type Profile } from '@/lib/api';
import { LIMITS, lengthError } from '@/lib/domain';
import { ApiError, MIN_PASSWORD, authMessage, errorMessage } from '@/lib/errors';
import { checkAvatarFile, prepareAvatar, type CropArea } from '@/lib/image';
import { supabase } from '@/lib/supabase';
import { AvatarCropDialog } from './AvatarCropDialog';
import { useBeforeUnloadGuard } from '@/lib/unsavedChanges';
import { DiscardChangesDialog, FormError, Modal } from './Modal';
import { useToast } from './Toast';
import { Avatar, toneFor } from './ui';

/** Telas que mostram nome ou foto de autores: recarregam depois de uma mudança no perfil. */
const AUTHOR_KEYS = new Set(['profile', 'ranking', 'suggestions', 'suggestion', 'comments']);

function useRefreshAuthors() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ predicate: (q) => AUTHOR_KEYS.has(String(q.queryKey[0])) });
}

// -----------------------------------------------------------------------------
// Foto
// -----------------------------------------------------------------------------

export interface AvatarUpload {
  pick: () => void;
  remove: () => void;
  busy: boolean;
  error: string | null;
  /** Input de arquivo escondido: renderize uma vez na página. */
  input: ReactNode;
}

/** Envio e remoção da foto; o topo do perfil e a linha "Foto" usam a mesma instância. */
export function useAvatarUpload(profile: Profile | null): AvatarUpload {
  const toast = useToast();
  const refresh = useRefreshAuthors();
  const ref = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  /** Arquivo escolhido, aguardando o enquadramento. */
  const [picked, setPicked] = useState<File | null>(null);

  const upload = useMutation({
    mutationFn: async ({ file, crop }: { file: File; crop: CropArea }) =>
      api.uploadMyAvatar(profile!.id, await prepareAvatar(file, crop), profile!.avatar_path),
    onSuccess: () => {
      setPicked(null);
      refresh();
      toast.success('Foto atualizada.');
    },
    onError: (err) => setError(errorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: () => api.removeMyAvatar(profile!.avatar_path),
    onSuccess: () => {
      refresh();
      toast.success('Foto removida.');
    },
    onError: (err) => setError(errorMessage(err)),
  });

  return {
    pick: () => ref.current?.click(),
    remove: () => {
      setError(null);
      remove.mutate();
    },
    busy: upload.isPending || remove.isPending,
    error,
    input: (
      <>
        <input
          ref={ref}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file || !profile) return;
            setError(null);
            try {
              checkAvatarFile(file);
              setPicked(file);
            } catch (err) {
              setError(errorMessage(err));
            }
          }}
        />
        <AvatarCropDialog
          file={picked}
          busy={upload.isPending}
          error={error}
          onCancel={() => {
            setPicked(null);
            setError(null);
          }}
          onConfirm={(crop) => picked && upload.mutate({ file: picked, crop })}
        />
      </>
    ),
  };
}

/** Foto grande e clicável do topo do perfil. */
export function AvatarButton({ profile, upload }: { profile: Profile; upload: AvatarUpload }) {
  return (
    <button
      type="button"
      onClick={upload.pick}
      disabled={upload.busy}
      className="group relative shrink-0 rounded-full ring-4 ring-surface focus-visible:outline-none focus-visible:ring-brand/50"
      aria-label={profile.avatar_path ? 'Trocar foto de perfil' : 'Enviar foto de perfil'}
    >
      <Avatar name={profile.name} photo={profile.avatar_path} size="xl" tone={toneFor(profile.name)} />
      <span
        className={`absolute inset-0 grid place-items-center rounded-full bg-black/45 text-white transition-opacity duration-200 ${
          upload.busy ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
        aria-hidden
      >
        {upload.busy && <Loader2 className="h-6 w-6 animate-spin" />}
      </span>
      <span className="absolute -bottom-0.5 -right-0.5 grid h-7 w-7 place-items-center rounded-full border-2 border-surface bg-brand text-white dark:text-page" aria-hidden>
        <Camera className="h-3.5 w-3.5" />
      </span>
    </button>
  );
}

// -----------------------------------------------------------------------------
// Configurações da conta: foto, nome, e-mail e senha
// -----------------------------------------------------------------------------

/** Confere a senha atual antes de mudar e-mail ou senha (o Supabase não exige por padrão). */
async function confirmCurrentPassword(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    throw new ApiError(/invalid login credentials/i.test(error.message) ? 'Senha atual incorreta.' : authMessage(error.message), 'validation');
  }
}

async function updateAuthUser(attributes: { email?: string; password?: string }) {
  const { data, error } = await supabase.auth.updateUser(attributes);
  if (error) throw new ApiError(authMessage(error.message), 'validation');
  return data.user;
}

type Editing = 'name' | 'email' | 'password' | null;

export function AccountCard({
  profile,
  upload,
  onSignOut,
}: {
  profile: Profile;
  upload: AvatarUpload;
  onSignOut: () => void;
}) {
  const { user } = useAuth();
  const [editing, setEditing] = useState<Editing>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // O formulário aberto avisa se há algo digitado; trocar ou fechar com alterações pede confirmação.
  const [formDirty, setFormDirty] = useState(false);
  const [leavingTo, setLeavingTo] = useState<Editing | undefined>(undefined);
  useBeforeUnloadGuard(formDirty);
  const switchTo = (next: Editing) => {
    setNotice(null);
    setFormDirty(false);
    setEditing(next);
  };
  const toggle = (row: Exclude<Editing, null>) => {
    const next = editing === row ? null : row;
    if (formDirty) setLeavingTo(next);
    else switchTo(next);
  };
  const done = () => {
    setFormDirty(false);
    setEditing(null);
  };

  return (
    <section className="card p-6" aria-labelledby="conta-titulo">
      <h2 id="conta-titulo" className="text-lg font-bold text-ink">
        Configurações da conta
      </h2>
      <p className="mt-0.5 text-sm text-muted">Como você aparece para a comunidade e como entra na plataforma.</p>

      <div className="mt-5 divide-y divide-line">
        <AccountRow
          icon={<ImageIcon className="h-4 w-4" />}
          label="Foto de perfil"
          value={profile.avatar_path ? 'Foto enviada' : 'Usando suas iniciais'}
          hint="Aparece para toda a comunidade"
          action={
            <div className="flex shrink-0 gap-1.5">
              {profile.avatar_path && (
                <button type="button" className="btn-ghost px-2.5 py-2" onClick={upload.remove} disabled={upload.busy} aria-label="Remover foto">
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              )}
              <button type="button" className="btn-secondary px-3 py-2" onClick={upload.pick} disabled={upload.busy}>
                {upload.busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                {profile.avatar_path ? 'Trocar' : 'Enviar'}
              </button>
            </div>
          }
        >
          {upload.error && (
            <p className="field-error" role="alert">
              {upload.error}
            </p>
          )}
        </AccountRow>

        <AccountRow
          icon={<UserRound className="h-4 w-4" />}
          label="Nome exibido"
          value={profile.name}
          open={editing === 'name'}
          onToggle={() => toggle('name')}
        >
          <NameForm currentName={profile.name} onDone={done} onDirtyChange={setFormDirty} />
        </AccountRow>

        {user?.email && (
          <>
            <AccountRow
              icon={<AtSign className="h-4 w-4" />}
              label="E-mail"
              value={user.email}
              hint={user.new_email ? `Aguardando confirmação de ${user.new_email}` : 'Nunca é exibido'}
              open={editing === 'email'}
              onToggle={() => toggle('email')}
            >
              <EmailForm
                currentEmail={user.email}
                onDirtyChange={setFormDirty}
                onDone={(message) => {
                  done();
                  setNotice(message);
                }}
              />
            </AccountRow>
            <AccountRow
              icon={<KeyRound className="h-4 w-4" />}
              label="Senha"
              value="••••••••"
              open={editing === 'password'}
              onToggle={() => toggle('password')}
            >
              <PasswordForm email={user.email} onDone={done} onDirtyChange={setFormDirty} />
            </AccountRow>
          </>
        )}
      </div>

      {notice && (
        <div role="status" className="mt-4 flex animate-fade-in gap-2.5 rounded-xl border border-brand/25 bg-brand-soft px-3.5 py-3 text-sm text-ink">
          <MailCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
          <p>{notice}</p>
        </div>
      )}

      {user?.email && <PrivacySection email={user.email} onDeleted={onSignOut} />}

      <DiscardChangesDialog
        open={leavingTo !== undefined}
        onOpenChange={(open) => !open && setLeavingTo(undefined)}
        onDiscard={() => switchTo(leavingTo ?? null)}
      />

      <div className="mt-5 border-t border-line pt-4">
        <button type="button" className="btn-ghost w-full justify-start px-3 text-danger hover:bg-danger/10 hover:text-danger" onClick={onSignOut}>
          <LogOut className="h-4 w-4" aria-hidden /> Sair da conta
        </button>
      </div>
    </section>
  );
}

function AccountRow({
  icon,
  label,
  value,
  hint,
  open = false,
  onToggle,
  action,
  children,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint?: string;
  open?: boolean;
  onToggle?: () => void;
  /** Botões próprios no lugar de "Alterar" (ex.: foto). */
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="py-3.5 first:pt-0 last:pb-0">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-subtle text-muted" aria-hidden>
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted">{label}</p>
          <p className="truncate text-sm font-semibold text-ink">{value}</p>
          {hint && <p className={`mt-0.5 text-xs ${hint.startsWith('Aguardando') ? 'text-warning' : 'text-muted'}`}>{hint}</p>}
        </div>
        {action ?? (
          <button type="button" className="btn-secondary shrink-0 px-3 py-2" onClick={onToggle} aria-expanded={open}>
            {open ? 'Cancelar' : 'Alterar'}
          </button>
        )}
      </div>
      {action ? children : open && <div className="mt-4 animate-fade-in">{children}</div>}
    </div>
  );
}

type DirtyReport = (dirty: boolean) => void;

function NameForm({ currentName, onDone, onDirtyChange }: { currentName: string; onDone: () => void; onDirtyChange: DirtyReport }) {
  const id = useId();
  const toast = useToast();
  const refresh = useRefreshAuthors();
  const [name, setName] = useState(currentName);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setName(currentName), [currentName]);
  const dirty = name.trim() !== currentName.trim();
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const mutation = useMutation({
    mutationFn: (value: string) => api.updateMyProfile(value),
    onSuccess: () => {
      refresh();
      toast.success('Nome atualizado.');
      onDone();
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const problem = lengthError(name, 'Nome', LIMITS.profileName);
    setError(problem);
    if (!problem) mutation.mutate(name.trim());
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      <div>
        <label htmlFor={`${id}-name`} className="field-label">
          Novo nome
        </label>
        <input
          id={`${id}-name`}
          className="field-input"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-name-error` : undefined}
          autoComplete="name"
        />
        {error && (
          <p id={`${id}-name-error`} className="field-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="flex justify-end">
        <button type="submit" className="btn-primary" disabled={mutation.isPending || name.trim() === currentName}>
          {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Salvar nome
        </button>
      </div>
    </form>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <input
        id={id}
        type="password"
        className="field-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
      />
    </div>
  );
}

function EmailForm({
  currentEmail,
  onDone,
  onDirtyChange,
}: {
  currentEmail: string;
  onDone: (message: string | null) => void;
  onDirtyChange: DirtyReport;
}) {
  const id = useId();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const dirty = email.trim() !== '' || password !== '';
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const mutation = useMutation({
    mutationFn: async () => {
      await confirmCurrentPassword(currentEmail, password);
      return updateAuthUser({ email: email.trim() });
    },
    onSuccess: (updated) => {
      if (updated?.email?.toLowerCase() === email.trim().toLowerCase()) {
        toast.success('E-mail alterado.');
        onDone(null);
        return;
      }
      onDone(
        `Enviamos links de confirmação para ${email.trim()} e para ${currentEmail}. A troca só vale depois que você confirmar nos dois e-mails.`,
      );
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = email.trim();
    let problem: string | null = null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) problem = 'Informe um e-mail válido.';
    else if (value.toLowerCase() === currentEmail.toLowerCase()) problem = 'Este já é o seu e-mail.';
    else if (!password) problem = 'Informe sua senha atual para confirmar.';
    setError(problem);
    if (!problem) mutation.mutate();
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      {error && <FormError message={error} />}
      <div>
        <label htmlFor={`${id}-email`} className="field-label">
          Novo e-mail
        </label>
        <input
          id={`${id}-email`}
          type="email"
          className="field-input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          placeholder="nome@empresa.com.br"
        />
      </div>
      <PasswordField id={`${id}-current`} label="Senha atual" value={password} onChange={setPassword} autoComplete="current-password" />
      <div className="flex justify-end">
        <button type="submit" className="btn-primary" disabled={mutation.isPending}>
          {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Alterar e-mail
        </button>
      </div>
    </form>
  );
}

function PasswordForm({ email, onDone, onDirtyChange }: { email: string; onDone: () => void; onDirtyChange: DirtyReport }) {
  const id = useId();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const dirty = current !== '' || next !== '' || confirm !== '';
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const mutation = useMutation({
    mutationFn: async () => {
      await confirmCurrentPassword(email, current);
      await updateAuthUser({ password: next });
    },
    onSuccess: () => {
      toast.success('Senha alterada.');
      onDone();
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    let problem: string | null = null;
    if (!current) problem = 'Informe sua senha atual.';
    else if (next.length < MIN_PASSWORD) problem = `A nova senha deve ter pelo menos ${MIN_PASSWORD} caracteres.`;
    else if (next !== confirm) problem = 'A confirmação não confere com a nova senha.';
    else if (next === current) problem = 'A nova senha deve ser diferente da atual.';
    setError(problem);
    if (!problem) mutation.mutate();
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      {error && <FormError message={error} />}
      <PasswordField id={`${id}-current`} label="Senha atual" value={current} onChange={setCurrent} autoComplete="current-password" />
      <PasswordField id={`${id}-new`} label="Nova senha" value={next} onChange={setNext} autoComplete="new-password" />
      <PasswordField id={`${id}-confirm`} label="Confirme a nova senha" value={confirm} onChange={setConfirm} autoComplete="new-password" />
      <div className="flex justify-end">
        <button type="submit" className="btn-primary" disabled={mutation.isPending}>
          {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Alterar senha
        </button>
      </div>
    </form>
  );
}

// -----------------------------------------------------------------------------
// Privacidade (LGPD): baixar meus dados e excluir a conta
// -----------------------------------------------------------------------------

function PrivacySection({ email, onDeleted }: { email: string; onDeleted: () => void }) {
  const toast = useToast();
  const [deleting, setDeleting] = useState(false);
  const exportData = useMutation({
    mutationFn: api.exportMyData,
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hv-ideias-meus-dados-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Download dos seus dados iniciado.');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <div className="mt-5 border-t border-line pt-4">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Privacidade</p>
      <div className="mt-3 divide-y divide-line">
        <AccountRow
          icon={<Download className="h-4 w-4" />}
          label="Seus dados"
          value="Perfil, sugestões, comentários e votos"
          action={
            <button type="button" className="btn-secondary shrink-0 px-3 py-2" onClick={() => exportData.mutate()} disabled={exportData.isPending}>
              {exportData.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Baixar
            </button>
          }
        />
        <AccountRow
          icon={<ShieldAlert className="h-4 w-4" />}
          label="Excluir conta"
          value="Apaga seu login, votos e foto"
          action={
            <button type="button" className="btn-ghost shrink-0 px-3 py-2 text-danger hover:bg-danger/10 hover:text-danger" onClick={() => setDeleting(true)}>
              Excluir
            </button>
          }
        />
      </div>
      <DeleteAccountDialog open={deleting} onOpenChange={setDeleting} email={email} onDeleted={onDeleted} />
    </div>
  );
}

const CONFIRM_WORD = 'EXCLUIR';

function DeleteAccountDialog({
  open,
  onOpenChange,
  email,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string;
  onDeleted: () => void;
}) {
  const id = useId();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [word, setWord] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) {
      setPassword('');
      setWord('');
      setError(null);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: async () => {
      await confirmCurrentPassword(email, password);
      await api.deleteMyAccount();
    },
    onSuccess: () => {
      toast.success('Sua conta foi excluída.');
      onDeleted();
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (word.trim().toUpperCase() !== CONFIRM_WORD) return setError(`Digite ${CONFIRM_WORD} para confirmar.`);
    if (!password) return setError('Informe sua senha atual.');
    setError(null);
    mutation.mutate();
  };

  return (
    <Modal
      open={open}
      onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}
      title="Excluir minha conta"
      description="Esta ação não pode ser desfeita."
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        <ul className="list-disc space-y-1 rounded-xl border border-danger/25 bg-danger/5 py-3 pl-8 pr-4 text-sm text-ink">
          <li>Seu login (e-mail e senha), seus votos, suas notificações e sua foto são apagados.</li>
          <li>Seus comentários passam a aparecer como removidos.</li>
          <li>Suas sugestões continuam, sem seu nome (“Participante removido”), porque outras pessoas votaram nelas.</li>
          <li>Antes, se quiser, baixe uma cópia dos seus dados.</li>
        </ul>
        {error && <FormError message={error} />}
        <PasswordField id={`${id}-password`} label="Senha atual" value={password} onChange={setPassword} autoComplete="current-password" />
        <div>
          <label htmlFor={`${id}-word`} className="field-label">
            Digite {CONFIRM_WORD} para confirmar
          </label>
          <input id={`${id}-word`} className="field-input" value={word} onChange={(e) => setWord(e.target.value)} autoComplete="off" />
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-secondary" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancelar
          </button>
          <button type="submit" className="btn-danger" disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Excluir conta
          </button>
        </div>
      </form>
    </Modal>
  );
}
