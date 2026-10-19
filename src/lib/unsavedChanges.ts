import { useEffect } from 'react';

/**
 * Diz se algum campo mudou em relação aos valores iniciais. Textos são comparados sem os espaços
 * das pontas (o que é salvo), então apagar o que foi digitado ou voltar ao texto original não conta.
 */
export function hasChanges<T extends object>(current: T, initial: T): boolean {
  return (Object.keys(initial) as (keyof T)[]).some((key) => {
    const a = current[key];
    const b = initial[key];
    return typeof a === 'string' && typeof b === 'string' ? a.trim() !== b.trim() : a !== b;
  });
}

/** Enquanto `active`, o navegador pede confirmação antes de recarregar ou fechar a aba. */
export function useBeforeUnloadGuard(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Navegadores antigos só mostram o aviso com returnValue preenchido (o texto é ignorado).
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [active]);
}
