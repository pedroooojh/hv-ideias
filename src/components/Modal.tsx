import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Loader2 } from 'lucide-react';
import { errorMessage } from '@/lib/errors';
import { useBeforeUnloadGuard } from '@/lib/unsavedChanges';

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  size?: 'md' | 'lg';
  /**
   * Há alterações não salvas: fechar pelo fundo, Esc, X ou por um `ModalClose` pede confirmação,
   * e recarregar a aba também. Fechar chamando o `onOpenChange` do pai (ex.: depois de salvar) não pergunta.
   */
  dirty?: boolean;
  /** Enquanto salva, o modal não fecha. */
  busy?: boolean;
  /** Para onde vai o foco ao fechar (o padrão do Radix é o botão que abriu, que aqui não existe). */
  onCloseAutoFocus?: (event: Event) => void;
}

/** Botão que fecha o modal pelo mesmo caminho do X (respeita `dirty` e `busy`). Use com `asChild`. */
export const ModalClose = Dialog.Close;

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  size = 'md',
  dirty = false,
  busy = false,
  onCloseAutoFocus,
}: ModalProps) {
  const [confirming, setConfirming] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  useBeforeUnloadGuard(open && dirty);
  // Fechado por fora (ex.: salvou), a confirmação não pode reaparecer na próxima abertura.
  useEffect(() => {
    if (!open) setConfirming(false);
  }, [open]);

  const handleOpenChange = (next: boolean) => {
    if (busy) return;
    if (!next && dirty) return setConfirming(true);
    onOpenChange(next);
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-50 bg-ink/40 animate-presence backdrop-blur-[2px] dark:bg-black/60"
          // Clicar no fundo não tira o foco do campo: ao "Continuar editando", o cursor volta onde estava.
          onMouseDown={(e) => e.preventDefault()}
        />
        <Dialog.Content
          ref={contentRef}
          // Ao abrir, o foco fica no próprio modal (Tab leva ao primeiro campo), sem marcar um campo ou o X.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            contentRef.current?.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={onCloseAutoFocus}
          className={`fixed inset-x-0 bottom-0 z-50 max-h-[92vh] animate-presence overflow-y-auto rounded-t-xl border border-line bg-surface p-5 shadow-float sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:p-7 focus-visible:ring-0 focus-visible:ring-offset-0 ${
            size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-lg'
          }`}
        >
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-xl font-bold tracking-tight text-ink">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1 text-sm text-muted">{description}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{title}</Dialog.Description>
              )}
            </div>
            <Dialog.Close className="rounded-lg p-1.5 text-muted hover:bg-subtle hover:text-ink" aria-label="Fechar">
              <X className="h-5 w-5" />
            </Dialog.Close>
          </div>
          {children}
          {/* Dentro do Content: vira uma camada acima do modal (Esc e clique fora fecham só a confirmação). */}
          {(dirty || confirming) && (
            <DiscardChangesDialog open={confirming} onOpenChange={setConfirming} onDiscard={() => onOpenChange(false)} />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  /** Texto do botão que fecha sem fazer nada (padrão "Cancelar"). */
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  onConfirm: () => Promise<unknown>;
  onCloseAutoFocus?: (event: Event) => void;
}

/** Confirmação para operações destrutivas; mantém o diálogo aberto e mostra o erro se falhar. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancelar',
  tone = 'danger',
  onConfirm,
  onCloseAutoFocus,
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpenChange = (next: boolean) => {
    if (pending) return;
    if (!next) setError(null);
    onOpenChange(next);
  };

  const confirm = async () => {
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={handleOpenChange} title={title} description={description} onCloseAutoFocus={onCloseAutoFocus}>
      {error && <FormError message={error} />}
      <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className="btn-secondary" onClick={() => handleOpenChange(false)} disabled={pending}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={tone === 'danger' ? 'btn-danger' : 'btn-primary'}
          onClick={confirm}
          disabled={pending}
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/** Confirmação padrão antes de descartar o que foi digitado. */
export function DiscardChangesDialog({
  open,
  onOpenChange,
  onDiscard,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDiscard: () => void;
}) {
  // Ao "Continuar editando", o cursor volta para o campo (ou botão) de onde a pessoa saiu.
  // Layout effect: roda antes de a confirmação puxar o foco para si.
  const returnTo = useRef<HTMLElement | null>(null);
  const discarded = useRef(false);
  useLayoutEffect(() => {
    if (!open) return;
    returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    discarded.current = false;
  }, [open]);

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Sair sem salvar?"
      description="Você vai perder as alterações que fez aqui."
      cancelLabel="Continuar editando"
      confirmLabel="Descartar e sair"
      onConfirm={async () => {
        discarded.current = true;
        onDiscard();
      }}
      onCloseAutoFocus={(event) => {
        const target = returnTo.current;
        if (discarded.current || !target?.isConnected) return;
        event.preventDefault();
        target.focus();
      }}
    />
  );
}

export function FormError({ message }: { message: string }) {
  return (
    <div role="alert" className="mb-4 animate-fade-in rounded-xl border border-danger/25 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
      {message}
    </div>
  );
}
