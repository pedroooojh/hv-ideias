import { useEffect, useId, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, MailPlus } from 'lucide-react';
import { api, qk } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { FormError, Modal } from './Modal';
import { useToast } from './Toast';

/** Convite por e-mail (Gestão → Usuários). A pessoa recebe o link e cria a própria senha. */
export function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const id = useId();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setEmail('');
      setName('');
      setError(null);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => api.adminInviteUser(email.trim(), name.trim()),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: qk.adminUsers });
      queryClient.invalidateQueries({ queryKey: qk.auditLog });
      toast.success(`Convite enviado para ${result.email}.`);
      onOpenChange(false);
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Informe um e-mail válido.');
    if (name.trim() && name.trim().length < 2) return setError('O nome deve ter pelo menos 2 caracteres.');
    setError(null);
    mutation.mutate();
  };

  return (
    <Modal
      open={open}
      onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}
      title="Convidar pessoa"
      description="Ela recebe um e-mail com o link para criar a senha e entrar na plataforma."
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        {error && <FormError message={error} />}
        <div>
          <label htmlFor={`${id}-email`} className="field-label">
            E-mail
          </label>
          <input
            id={`${id}-email`}
            type="email"
            className="field-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="nome@hubvision.com.br"
            autoComplete="off"
            autoFocus
          />
        </div>
        <div>
          <label htmlFor={`${id}-name`} className="field-label">
            Nome <span className="font-normal text-muted">(opcional)</span>
          </label>
          <input
            id={`${id}-name`}
            className="field-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="Como vai aparecer na plataforma"
            autoComplete="off"
          />
          <p className="mt-1.5 text-xs text-muted">A pessoa pode mudar depois, no perfil.</p>
        </div>
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-secondary" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={mutation.isPending}>
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <MailPlus className="h-4 w-4" aria-hidden />}
            Enviar convite
          </button>
        </div>
      </form>
    </Modal>
  );
}
