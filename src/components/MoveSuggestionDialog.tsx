import { useEffect, useId, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { api, qk } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { FormError, Modal, ModalClose } from './Modal';
import { Select } from './Select';
import { Skeleton } from './ui';
import { useToast } from './Toast';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suggestionId: string;
  projectId: string;
  projectName: string;
}

/**
 * Administração: corrige o projeto de uma sugestão publicada no lugar errado. Os
 * pontos dela passam a contar na área do projeto novo (peso por área no ranking).
 */
export function MoveSuggestionDialog({ open, onOpenChange, suggestionId, projectId, projectName }: Props) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const id = useId();
  const [target, setTarget] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTarget('');
      setServerError(null);
    }
  }, [open]);

  // Arquivados não recebem sugestões.
  const projects = useQuery({
    queryKey: [...qk.projects, 'move-targets'],
    queryFn: () => api.listProjects({}, 0, 50),
    enabled: open,
    select: (page) => page.items.filter((p) => p.id !== projectId && p.status !== 'arquivado'),
  });
  const chosen = projects.data?.find((p) => p.id === target);

  const mutation = useMutation({
    mutationFn: () => api.moveSuggestion(suggestionId, target),
    onSuccess: () => {
      for (const key of [
        qk.suggestion(suggestionId),
        qk.suggestions(projectId),
        qk.suggestions(target),
        qk.project(projectId),
        qk.project(target),
        qk.projects,
        qk.stats,
        qk.auditLog,
        qk.mySuggestions,
        qk.adminSuggestions,
        qk.userSuggestionLists,
        // A área conta no peso do ranking.
        qk.ranking,
        qk.myScore,
        qk.publicProfiles,
      ]) {
        queryClient.invalidateQueries({ queryKey: key });
      }
      toast.success(`Sugestão movida para "${chosen?.name ?? 'outro projeto'}".`);
      onOpenChange(false);
    },
    onError: (err) => setServerError(errorMessage(err)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setServerError(null);
    if (!target) {
      setServerError('Escolha o projeto de destino.');
      return;
    }
    mutation.mutate();
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      busy={mutation.isPending}
      dirty={Boolean(target)}
      title="Mover para outro projeto"
      description={`Hoje em "${projectName}". Os votos e comentários vão junto, e os pontos passam a contar na área do projeto novo. O autor é avisado e a mudança fica na auditoria.`}
    >
      <form onSubmit={submit} noValidate className="space-y-5">
        {serverError && <FormError message={serverError} />}
        <div>
          <label htmlFor={`${id}-project`} className="field-label">
            Projeto de destino
          </label>
          {projects.isPending ? (
            <Skeleton className="h-11 rounded-xl" />
          ) : projects.isError ? (
            <FormError message={errorMessage(projects.error)} />
          ) : projects.data.length === 0 ? (
            <p className="text-sm text-muted">Não há outro projeto ativo para receber a sugestão.</p>
          ) : (
            <Select
              id={`${id}-project`}
              value={target}
              onChange={setTarget}
              placeholder="Selecione o projeto"
              options={projects.data.map((p) => ({ value: p.id, label: p.name, description: `Área: ${p.category}` }))}
            />
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <ModalClose asChild>
            <button type="button" className="btn-secondary" disabled={mutation.isPending}>
              Cancelar
            </button>
          </ModalClose>
          <button type="submit" className="btn-primary" disabled={mutation.isPending || !target}>
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Mover sugestão
          </button>
        </div>
      </form>
    </Modal>
  );
}
