import { useEffect, useId, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { api, qk, type SuggestionInput } from '@/lib/api';
import { LIMITS, lengthError } from '@/lib/domain';
import { errorMessage } from '@/lib/errors';
import { FormError, Modal } from './Modal';
import { CharCounter } from './ui';
import { useToast } from './Toast';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
  /** Quando informado, o formulário edita a sugestão existente. */
  editing?: { id: string } & SuggestionInput;
  onSaved?: (id: string) => void;
}

type Errors = Partial<Record<keyof SuggestionInput, string>>;

export function SuggestionFormDialog({ open, onOpenChange, projectId, projectName, editing, onSaved }: Props) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const formId = useId();
  const types = useQuery({ queryKey: qk.types, queryFn: api.listSuggestionTypes, staleTime: 10 * 60_000 });

  const empty: SuggestionInput = { type: '', title: '', description: '' };
  const [values, setValues] = useState<SuggestionInput>(editing ?? empty);
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValues(editing ? { type: editing.type, title: editing.title, description: editing.description } : empty);
      setErrors({});
      setServerError(null);
    }
    // Reinicia apenas quando o diálogo abre, para não apagar o que está sendo digitado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const mutation = useMutation({
    mutationFn: (input: SuggestionInput) =>
      editing ? api.updateSuggestion(editing.id, input).then(() => editing.id) : api.createSuggestion(projectId, input),
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: qk.suggestions(projectId) });
      queryClient.invalidateQueries({ queryKey: qk.project(projectId) });
      queryClient.invalidateQueries({ queryKey: qk.suggestion(id) });
      queryClient.invalidateQueries({ queryKey: qk.projects });
      queryClient.invalidateQueries({ queryKey: qk.stats });
      queryClient.invalidateQueries({ queryKey: qk.mySuggestions });
      queryClient.invalidateQueries({ queryKey: qk.myScore });
      queryClient.invalidateQueries({ queryKey: qk.adminSuggestions });
      toast.success(editing ? 'Sugestão atualizada.' : 'Sugestão publicada! Agora a comunidade pode votar nela.');
      onOpenChange(false);
      onSaved?.(id);
    },
    onError: (err) => setServerError(errorMessage(err)),
  });

  const validate = (v: SuggestionInput): Errors => {
    const next: Errors = {};
    if (!v.type) next.type = 'Selecione o tipo da sugestão.';
    const t = lengthError(v.title, 'Título', LIMITS.suggestionTitle);
    if (t) next.title = t;
    const d = lengthError(v.description, 'Descrição', LIMITS.suggestionDescription);
    if (d) next.description = d;
    return next;
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const found = validate(values);
    setErrors(found);
    setServerError(null);
    if (Object.keys(found).length > 0) return;
    mutation.mutate({ type: values.type, title: values.title.trim(), description: values.description.trim() });
  };

  const set = <K extends keyof SuggestionInput>(key: K, value: SuggestionInput[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  return (
    <Modal
      open={open}
      onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}
      title={editing ? 'Editar sugestão' : 'Nova sugestão'}
      description={<>Projeto: <strong className="text-ink">{projectName}</strong></>}
      size="lg"
    >
      <form onSubmit={submit} noValidate className="space-y-5">
        {serverError && <FormError message={serverError} />}

        <fieldset>
          <legend className="field-label">Tipo</legend>
          {types.isError && !types.data ? (
            <p className="field-error">Não foi possível carregar os tipos. Feche e tente novamente.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-describedby={errors.type ? `${formId}-type-error` : undefined}>
              {(types.data ?? []).map((t) => (
                <label
                  key={t.slug}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 text-sm font-semibold transition-colors duration-200 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand ${
                    values.type === t.slug ? 'border-brand bg-brand-soft text-brand' : 'border-line text-ink hover:bg-subtle'
                  }`}
                >
                  <input
                    type="radio"
                    name="type"
                    value={t.slug}
                    checked={values.type === t.slug}
                    onChange={() => set('type', t.slug)}
                    className="h-4 w-4 accent-[rgb(var(--brand))]"
                  />
                  {t.label}
                </label>
              ))}
              {types.isPending && <p className="text-sm text-muted">Carregando tipos…</p>}
            </div>
          )}
          {errors.type && (
            <p id={`${formId}-type-error`} className="field-error">
              {errors.type}
            </p>
          )}
        </fieldset>

        <div>
          <div className="flex items-end justify-between">
            <label htmlFor={`${formId}-title`} className="field-label">
              Título
            </label>
            <CharCounter value={values.title} max={LIMITS.suggestionTitle.max} />
          </div>
          <input
            id={`${formId}-title`}
            className="field-input"
            value={values.title}
            onChange={(e) => set('title', e.target.value)}
            maxLength={LIMITS.suggestionTitle.max + 20}
            placeholder="Resuma a ideia em uma frase"
            aria-invalid={Boolean(errors.title)}
            aria-describedby={errors.title ? `${formId}-title-error` : undefined}
            autoFocus
          />
          {errors.title && (
            <p id={`${formId}-title-error`} className="field-error">
              {errors.title}
            </p>
          )}
        </div>

        <div>
          <div className="flex items-end justify-between">
            <label htmlFor={`${formId}-description`} className="field-label">
              Descrição
            </label>
            <CharCounter value={values.description} max={LIMITS.suggestionDescription.max} />
          </div>
          <textarea
            id={`${formId}-description`}
            className="field-input min-h-[160px] resize-y"
            value={values.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="Explique o problema, a proposta e quem se beneficia."
            aria-invalid={Boolean(errors.description)}
            aria-describedby={errors.description ? `${formId}-description-error` : undefined}
          />
          {errors.description ? (
            <p id={`${formId}-description-error`} className="field-error">
              {errors.description}
            </p>
          ) : (
            <p className="mt-1.5 text-xs text-muted">
              Dica: escreva nomes de campos ou trechos de código entre crases, como{' '}
              <code className="rounded bg-subtle px-1 font-mono">`:data_ini`</code>, para destacá-los.
            </p>
          )}
        </div>

        {!editing && (
          <p className="rounded-xl bg-subtle px-3.5 py-2.5 text-xs text-muted">
            Você poderá editar ou excluir a sugestão enquanto ela estiver <strong>em análise</strong>.
          </p>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-secondary" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {editing ? 'Salvar alterações' : 'Publicar sugestão'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
