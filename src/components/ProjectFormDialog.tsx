import { useEffect, useId, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { api, qk, type ProjectInput } from '@/lib/api';
import { LIMITS, PROJECT_STATUS, PROJECT_STATUS_HINT, PROJECT_STATUS_ORDER, lengthError } from '@/lib/domain';
import { errorMessage } from '@/lib/errors';
import { FormError, Modal } from './Modal';
import { ComboField, Dot, Select } from './Select';
import { CharCounter } from './ui';
import { useToast } from './Toast';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: { id: string } & ProjectInput;
  /** Categorias já usadas, oferecidas como sugestão no campo. */
  knownCategories?: string[];
  onSaved?: (id: string) => void;
}

type Errors = Partial<Record<keyof ProjectInput, string>>;
const EMPTY: ProjectInput = { name: '', description: '', category: '', status: 'em_avaliacao' };

export function ProjectFormDialog({ open, onOpenChange, editing, knownCategories = [], onSaved }: Props) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const id = useId();
  const [values, setValues] = useState<ProjectInput>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValues(editing ? { name: editing.name, description: editing.description, category: editing.category, status: editing.status } : EMPTY);
      setErrors({});
      setServerError(null);
    }
    // Reinicia apenas quando o diálogo abre, para não apagar o que está sendo digitado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const mutation = useMutation({
    mutationFn: (input: ProjectInput) =>
      editing ? api.updateProject(editing.id, input).then(() => editing.id) : api.createProject(input),
    onSuccess: (projectId) => {
      queryClient.invalidateQueries({ queryKey: qk.projects });
      queryClient.invalidateQueries({ queryKey: qk.project(projectId) });
      queryClient.invalidateQueries({ queryKey: qk.stats });
      queryClient.invalidateQueries({ queryKey: qk.auditLog });
      toast.success(editing ? 'Projeto atualizado.' : 'Projeto criado.');
      onOpenChange(false);
      onSaved?.(projectId);
    },
    onError: (err) => setServerError(errorMessage(err)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Errors = {};
    const n = lengthError(values.name, 'Nome', LIMITS.projectName);
    if (n) next.name = n;
    const c = lengthError(values.category, 'Categoria', LIMITS.projectCategory);
    if (c) next.category = c;
    const d = lengthError(values.description, 'Descrição', LIMITS.projectDescription);
    if (d) next.description = d;
    setErrors(next);
    setServerError(null);
    if (Object.keys(next).length > 0) return;
    mutation.mutate({
      name: values.name.trim(),
      category: values.category.trim(),
      description: values.description.trim(),
      status: values.status,
    });
  };

  const set = <K extends keyof ProjectInput>(key: K, value: ProjectInput[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const fieldError = (key: keyof ProjectInput) =>
    errors[key] ? (
      <p id={`${id}-${key}-error`} className="field-error">
        {errors[key]}
      </p>
    ) : null;

  return (
    <Modal
      open={open}
      onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}
      title={editing ? 'Editar projeto' : 'Novo projeto'}
      size="lg"
    >
      <form onSubmit={submit} noValidate className="space-y-5">
        {serverError && <FormError message={serverError} />}
        <div>
          <label htmlFor={`${id}-name`} className="field-label">
            Nome
          </label>
          <input
            id={`${id}-name`}
            className="field-input"
            value={values.name}
            onChange={(e) => set('name', e.target.value)}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? `${id}-name-error` : undefined}
            autoFocus
          />
          {fieldError('name')}
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor={`${id}-category`} className="field-label">
              Categoria
            </label>
            <ComboField
              id={`${id}-category`}
              value={values.category}
              onChange={(v) => set('category', v)}
              suggestions={knownCategories}
              placeholder="Ex.: Integração API"
              invalid={Boolean(errors.category)}
              describedBy={errors.category ? `${id}-category-error` : undefined}
            />
            {fieldError('category')}
          </div>
          <div>
            <label htmlFor={`${id}-status`} className="field-label">
              Status
            </label>
            <Select
              id={`${id}-status`}
              value={values.status}
              onChange={(v) => set('status', v)}
              options={PROJECT_STATUS_ORDER.map((s) => ({
                value: s,
                label: PROJECT_STATUS[s].label,
                description: PROJECT_STATUS_HINT[s],
                marker: <Dot className={PROJECT_STATUS[s].dot} />,
              }))}
            />
          </div>
        </div>
        {values.status === 'arquivado' && (
          <p className="rounded-xl bg-subtle px-3.5 py-2.5 text-xs text-muted">
            Projetos arquivados continuam visíveis, mas não recebem novas sugestões, votos ou comentários.
          </p>
        )}

        <div>
          <div className="flex items-end justify-between">
            <label htmlFor={`${id}-description`} className="field-label">
              Descrição
            </label>
            <CharCounter value={values.description} max={LIMITS.projectDescription.max} />
          </div>
          <textarea
            id={`${id}-description`}
            className="field-input min-h-[140px] resize-y"
            value={values.description}
            onChange={(e) => set('description', e.target.value)}
            aria-invalid={Boolean(errors.description)}
            aria-describedby={errors.description ? `${id}-description-error` : undefined}
          />
          {fieldError('description')}
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-secondary" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {editing ? 'Salvar alterações' : 'Criar projeto'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
