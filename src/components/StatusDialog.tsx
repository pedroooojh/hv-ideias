import { useEffect, useId, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { api, qk } from '@/lib/api';
import { LIMITS, SUGGESTION_STATUS, SUGGESTION_STATUS_ORDER, type SuggestionStatus } from '@/lib/domain';
import { errorMessage } from '@/lib/errors';
import { hasChanges } from '@/lib/unsavedChanges';
import { FormError, Modal, ModalClose } from './Modal';
import { CharCounter } from './ui';
import { useToast } from './Toast';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suggestionId: string;
  projectId: string;
  currentStatus: SuggestionStatus;
  currentReason: string | null;
}

export function StatusDialog({ open, onOpenChange, suggestionId, projectId, currentStatus, currentReason }: Props) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const id = useId();
  const [status, setStatus] = useState<SuggestionStatus>(currentStatus);
  const [reason, setReason] = useState(currentReason ?? '');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStatus(currentStatus);
      setReason(currentReason ?? '');
      setReasonError(null);
      setServerError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => api.setSuggestionStatus(suggestionId, status, reason.trim() || null),
    onSuccess: () => {
      for (const key of [
        qk.suggestion(suggestionId),
        qk.statusHistory(suggestionId),
        qk.suggestions(projectId),
        qk.stats,
        qk.auditLog,
        qk.mySuggestions,
        qk.adminSuggestions,
        qk.userSuggestionLists,
        // A seleção (ou a saída dela) muda os pontos do autor.
        qk.ranking,
        qk.myScore,
        qk.publicProfiles,
      ]) {
        queryClient.invalidateQueries({ queryKey: key });
      }
      toast.success(`Status alterado para "${SUGGESTION_STATUS[status].label}".`);
      onOpenChange(false);
    },
    onError: (err) => setServerError(errorMessage(err)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setServerError(null);
    const length = reason.trim().length;
    if (status === 'nao_aprovado' && length < LIMITS.statusReason.min) {
      setReasonError(`Explique o motivo da não aprovação (mínimo de ${LIMITS.statusReason.min} caracteres).`);
      return;
    }
    if (length > LIMITS.statusReason.max) {
      setReasonError(`A justificativa deve ter no máximo ${LIMITS.statusReason.max} caracteres.`);
      return;
    }
    setReasonError(null);
    mutation.mutate();
  };

  const reasonRequired = status === 'nao_aprovado';
  const dirty = hasChanges({ status, reason }, { status: currentStatus, reason: currentReason ?? '' });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      busy={mutation.isPending}
      dirty={dirty}
      title="Alterar status"
      description="A mudança fica registrada no histórico da sugestão e na auditoria. Planejado, Em desenvolvimento e Implementado contam como ideia selecionada: os pontos do autor dobram."
    >
      <form onSubmit={submit} noValidate className="space-y-5">
        {serverError && <FormError message={serverError} />}
        <fieldset>
          <legend className="field-label">Novo status</legend>
          <div className="grid gap-2">
            {SUGGESTION_STATUS_ORDER.map((s) => (
              <label
                key={s}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 text-sm transition-colors duration-200 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand ${
                  status === s ? 'border-brand bg-brand-soft' : 'border-line hover:bg-subtle'
                }`}
              >
                <input
                  type="radio"
                  name="status"
                  value={s}
                  checked={status === s}
                  onChange={() => setStatus(s)}
                  className="h-4 w-4 accent-[rgb(var(--brand))]"
                />
                <span className={`h-2.5 w-2.5 rounded-full ${SUGGESTION_STATUS[s].dot}`} aria-hidden />
                <span className="font-semibold text-ink">{SUGGESTION_STATUS[s].label}</span>
                {s === currentStatus && <span className="ml-auto text-xs text-muted">atual</span>}
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <div className="flex items-end justify-between">
            <label htmlFor={`${id}-reason`} className="field-label">
              Justificativa {reasonRequired ? '(obrigatória)' : '(opcional)'}
            </label>
            <CharCounter value={reason} max={LIMITS.statusReason.max} />
          </div>
          <textarea
            id={`${id}-reason`}
            className="field-input min-h-[100px] resize-y"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setReasonError(null);
            }}
            placeholder={reasonRequired ? 'Explique à comunidade por que a ideia não será executada.' : 'Nota interna registrada no histórico.'}
            aria-invalid={Boolean(reasonError)}
            aria-describedby={reasonError ? `${id}-reason-error` : undefined}
          />
          {reasonError && (
            <p id={`${id}-reason-error`} className="field-error">
              {reasonError}
            </p>
          )}
          {reasonRequired && !reasonError && (
            <p className="mt-1.5 text-xs text-muted">A justificativa fica visível para todos na página da sugestão.</p>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <ModalClose asChild>
            <button type="button" className="btn-secondary" disabled={mutation.isPending}>
              Cancelar
            </button>
          </ModalClose>
          <button type="submit" className="btn-primary" disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Salvar status
          </button>
        </div>
      </form>
    </Modal>
  );
}
