import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { SuggestionInput } from '@/lib/api';
import { ToastProvider } from '../Toast';
import { SuggestionFormDialog } from '../SuggestionFormDialog';

const createSuggestion = vi.fn<(projectId: string, input: SuggestionInput) => Promise<string>>();

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      listSuggestionTypes: async () => [
        { slug: 'melhoria', label: 'Melhoria', sort_order: 1 },
        { slug: 'nova_funcionalidade', label: 'Nova funcionalidade', sort_order: 2 },
      ],
      searchSuggestions: async () => [],
      createSuggestion: (projectId: string, input: SuggestionInput) => createSuggestion(projectId, input),
    },
  };
});

const existing = {
  id: 'sug-1',
  type: 'melhoria',
  title: 'Exportar relatório em PDF',
  description: 'Hoje só dá para exportar em planilha, e o cliente pede PDF para enviar à diretoria.',
};

/** O diálogo como as páginas usam: o estado de aberto fica no pai. */
function Harness({ editing }: { editing?: typeof existing }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <p>{open ? 'aberto' : 'fechado'}</p>
      <SuggestionFormDialog open={open} onOpenChange={setOpen} projectId="proj-1" projectName="Portal" editing={editing} />
    </>
  );
}

function renderDialog(editing?: typeof existing) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <Harness editing={editing} />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const form = () => screen.getByRole('dialog', { name: /sugestão/i });
const title = () => screen.getByLabelText('Título') as HTMLInputElement;
const confirmation = () => screen.queryByRole('dialog', { name: 'Sair sem salvar?' });
const typeTitle = (value: string) => fireEvent.change(title(), { target: { value } });
const pressEscape = () => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

afterEach(cleanup);
beforeEach(() => createSuggestion.mockReset());

describe('Nova sugestão: proteção contra perder o que foi digitado', () => {
  it('fecha direto quando nada foi digitado', async () => {
    renderDialog();
    expect(form()).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(screen.getByText('fechado')).toBeInTheDocument());
    expect(confirmation()).not.toBeInTheDocument();
  });

  it('pergunta antes de fechar com Esc; continuar editando mantém o texto', async () => {
    renderDialog();
    typeTitle('Atalho para duplicar pedido');
    pressEscape();

    expect(await screen.findByRole('dialog', { name: 'Sair sem salvar?' })).toBeInTheDocument();
    expect(screen.getByText('aberto')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Continuar editando' }));
    await waitFor(() => expect(confirmation()).not.toBeInTheDocument());
    expect(screen.getByText('aberto')).toBeInTheDocument();
    expect(title().value).toBe('Atalho para duplicar pedido');
  });

  it('pergunta ao clicar fora do modal', async () => {
    renderDialog();
    typeTitle('Atalho para duplicar pedido');
    // O Radix só começa a ouvir cliques fora no tick seguinte à abertura.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    fireEvent.pointerDown(document.body);
    expect(await screen.findByRole('dialog', { name: 'Sair sem salvar?' })).toBeInTheDocument();
    expect(screen.getByText('aberto')).toBeInTheDocument();
  });

  it('descartar pelo botão Cancelar fecha o formulário', async () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('Descrição'), { target: { value: 'Uma ideia longa…' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Descartar e sair' }));
    await waitFor(() => expect(screen.getByText('fechado')).toBeInTheDocument());
    expect(confirmation()).not.toBeInTheDocument();
  });

  it('escolher só o tipo também conta como alteração', async () => {
    renderDialog();
    fireEvent.click(await screen.findByLabelText('Melhoria'));
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(await screen.findByRole('dialog', { name: 'Sair sem salvar?' })).toBeInTheDocument();
  });

  it('fecha sem perguntar depois de publicar', async () => {
    createSuggestion.mockResolvedValue('sug-nova');
    renderDialog();
    fireEvent.click(await screen.findByLabelText('Melhoria'));
    typeTitle('Atalho para duplicar pedido');
    fireEvent.change(screen.getByLabelText('Descrição'), {
      target: { value: 'Um botão na lista de pedidos que cria uma cópia com os mesmos itens e cliente.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Publicar sugestão' }));

    await waitFor(() => expect(screen.getByText('fechado')).toBeInTheDocument());
    expect(createSuggestion).toHaveBeenCalledOnce();
    expect(confirmation()).not.toBeInTheDocument();
  });

  it('avisa o navegador ao recarregar a aba só enquanto há alterações', () => {
    renderDialog();
    const reload = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(reload()).toBe(false);
    typeTitle('Atalho para duplicar pedido');
    expect(reload()).toBe(true);
    typeTitle('');
    expect(reload()).toBe(false);
  });
});

describe('Editar sugestão', () => {
  it('voltar ao texto original não conta como alteração', async () => {
    renderDialog(existing);
    typeTitle('Exportar relatório em PDF e Excel');
    typeTitle(existing.title);
    pressEscape();
    await waitFor(() => expect(screen.getByText('fechado')).toBeInTheDocument());
    expect(confirmation()).not.toBeInTheDocument();
  });

  it('pergunta quando o texto difere do salvo', async () => {
    renderDialog(existing);
    typeTitle('Exportar relatório em PDF e Excel');
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(await screen.findByRole('dialog', { name: 'Sair sem salvar?' })).toBeInTheDocument();
  });
});
