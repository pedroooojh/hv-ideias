import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { Pencil, Settings, ThumbsUp, Trash2 } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { api, qk, type ProjectListItem } from '@/lib/api';
import { formatRelative, plural } from '@/lib/format';
import { ConfirmDialog } from './Modal';
import { ProjectFormDialog } from './ProjectFormDialog';
import { ProjectStatusLabel } from './ui';
import { useToast } from './Toast';

export function ProjectCard({ project, knownCategories }: { project: ProjectListItem; knownCategories: string[] }) {
  const { isAdmin } = useAuth();
  return (
    <article className="card relative flex h-full animate-fade-in flex-col p-6 transition-[border-color,box-shadow] duration-200 hover:border-brand/30 hover:shadow-float sm:p-7">
      <div className="flex items-start justify-between gap-3">
        <span className="chip bg-teal-soft font-medium text-teal">{project.category}</span>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-sm text-muted">
            <ThumbsUp className="h-4 w-4 fill-brand/90 text-brand" aria-hidden />
            {plural(project.vote_count, 'voto', 'votos')}
          </span>
          {isAdmin && <ProjectAdminMenu project={project} knownCategories={knownCategories} />}
        </div>
      </div>

      <h3 className="mt-4 text-lg font-bold leading-snug tracking-tight text-ink">
        {/* O link cobre o cartão inteiro; o menu de administração fica acima dele. */}
        <Link to={`/projetos/${project.id}`} className="after:absolute after:inset-0 after:rounded-xl focus:outline-none">
          {project.name}
        </Link>
      </h3>
      <p className="mt-2 line-clamp-3 text-[0.9375rem] leading-relaxed text-muted">{project.description}</p>

      <div className="mt-auto pt-8">
        <div className="flex items-center justify-between border-t border-line pt-5 text-sm text-muted">
          <ProjectStatusLabel status={project.status} />
          <span>Atualizado {formatRelative(project.last_activity_at)}</span>
        </div>
      </div>
    </article>
  );
}

function ProjectAdminMenu({ project, knownCategories }: { project: ProjectListItem; knownCategories: string[] }) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const item = 'flex cursor-default select-none items-center gap-2 px-3.5 py-2 text-sm outline-none transition-colors duration-200';
  return (
    <div className="relative z-10">
      <Menu.Root modal={false}>
        <Menu.Trigger
          className="rounded-lg p-1.5 text-teal transition-colors duration-200 hover:bg-teal-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          aria-label={`Gerenciar projeto ${project.name}`}
        >
          <Settings className="h-5 w-5" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content
            align="end"
            sideOffset={6}
            className="animate-presence z-50 w-44 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-float"
          >
            <Menu.Item className={`${item} text-ink data-[highlighted]:bg-subtle`} onSelect={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4" aria-hidden /> Editar
            </Menu.Item>
            <Menu.Item className={`${item} text-danger data-[highlighted]:bg-danger/10`} onSelect={() => setDeleteOpen(true)}>
              <Trash2 className="h-4 w-4" aria-hidden /> Excluir
            </Menu.Item>
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
      <ProjectFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        knownCategories={knownCategories}
        editing={{
          id: project.id,
          name: project.name,
          description: project.description,
          category: project.category,
          status: project.status,
        }}
      />
      <DeleteProjectDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        projectId={project.id}
        projectName={project.name}
        suggestionCount={Number(project.suggestion_count)}
      />
    </div>
  );
}

export function DeleteProjectDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
  suggestionCount,
  redirectTo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
  suggestionCount: number;
  redirectTo?: string;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Excluir projeto?"
      confirmLabel={suggestionCount > 0 ? `Excluir com ${plural(suggestionCount, 'sugestão', 'sugestões')}` : 'Excluir projeto'}
      description={
        <>
          <strong className="text-ink">{projectName}</strong> deixará de aparecer na plataforma.
          {suggestionCount > 0 ? (
            <>
              {' '}
              Ele possui <strong className="text-ink">{plural(suggestionCount, 'sugestão ativa', 'sugestões ativas')}</strong>, que
              também deixarão de aparecer e de contar pontos no ranking. Os registros são preservados no banco e a exclusão fica
              registrada na auditoria.
            </>
          ) : (
            ' A exclusão fica registrada na auditoria.'
          )}
        </>
      }
      onConfirm={async () => {
        await api.deleteProject(projectId, suggestionCount > 0);
        for (const key of [qk.projects, qk.stats, qk.ranking, qk.myScore, qk.auditLog, qk.adminSuggestions]) {
          queryClient.invalidateQueries({ queryKey: key });
        }
        queryClient.removeQueries({ queryKey: qk.project(projectId) });
        toast.success('Projeto excluído.');
        if (redirectTo) navigate(redirectTo);
      }}
    />
  );
}
