import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { Profile } from '@/lib/api';
import { ToastProvider } from '../Toast';
import { AccountCard, type AvatarUpload } from '../ProfileSettings';

const auth = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({ supabase: { auth } }));
vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ user: { email: 'ana@exemplo.test', new_email: undefined } }) }));

const profile: Profile = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Ana',
  role: 'user',
  status: 'active',
  created_at: '2026-10-01T12:00:00Z',
  avatar_path: null,
};
const upload: AvatarUpload = { pick: vi.fn(), remove: vi.fn(), busy: false, error: null, input: null };

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <AccountCard profile={profile} upload={upload} onSignOut={vi.fn()} />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function openPasswordForm() {
  // Linhas: nome, e-mail, senha (a foto tem botões próprios).
  fireEvent.click(screen.getAllByRole('button', { name: 'Alterar' })[2]);
}

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

afterEach(cleanup);

beforeEach(() => {
  auth.signInWithPassword.mockReset();
  auth.updateUser.mockReset();
});

describe('Configurações da conta: senha', () => {
  it('valida no navegador antes de falar com o servidor', async () => {
    renderCard();
    openPasswordForm();
    fill('Senha atual', 'senha-antiga');
    fill('Nova senha', 'curta');
    fireEvent.click(screen.getByRole('button', { name: 'Alterar senha' }));
    expect(await screen.findByText('A nova senha deve ter pelo menos 8 caracteres.')).toBeInTheDocument();

    fill('Nova senha', 'senha-nova-123');
    fill('Confirme a nova senha', 'senha-nova-124');
    fireEvent.click(screen.getByRole('button', { name: 'Alterar senha' }));
    expect(await screen.findByText('A confirmação não confere com a nova senha.')).toBeInTheDocument();
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('não troca a senha quando a senha atual está errada', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    renderCard();
    openPasswordForm();
    fill('Senha atual', 'errada-123');
    fill('Nova senha', 'senha-nova-123');
    fill('Confirme a nova senha', 'senha-nova-123');
    fireEvent.click(screen.getByRole('button', { name: 'Alterar senha' }));

    expect(await screen.findByText('Senha atual incorreta.')).toBeInTheDocument();
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'ana@exemplo.test', password: 'errada-123' });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('confere a senha atual e troca a senha', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: null });
    auth.updateUser.mockResolvedValue({ data: { user: { email: 'ana@exemplo.test' } }, error: null });
    renderCard();
    openPasswordForm();
    fill('Senha atual', 'senha-antiga');
    fill('Nova senha', 'senha-nova-123');
    fill('Confirme a nova senha', 'senha-nova-123');
    fireEvent.click(screen.getByRole('button', { name: 'Alterar senha' }));

    expect(await screen.findByText('Senha alterada.')).toBeInTheDocument();
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'senha-nova-123' });
    // O formulário fecha depois de salvar.
    expect(screen.queryByLabelText('Nova senha')).not.toBeInTheDocument();
  });
});

describe('Configurações da conta: alterações não salvas', () => {
  it('fecha direto sem nada digitado e pergunta quando há texto', async () => {
    renderCard();
    openPasswordForm();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByLabelText('Nova senha')).not.toBeInTheDocument();

    openPasswordForm();
    fill('Nova senha', 'senha-nova-123');
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(await screen.findByRole('dialog', { name: 'Sair sem salvar?' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Continuar editando' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Nova senha')).toHaveValue('senha-nova-123');

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Descartar e sair' }));
    await waitFor(() => expect(screen.queryByLabelText('Nova senha')).not.toBeInTheDocument());
  });
});
