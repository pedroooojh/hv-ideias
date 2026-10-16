import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ToastProvider } from '@/components/Toast';
import { NavigationProvider } from '@/lib/navigation';
import { ConfirmPage } from '../ConfirmPage';

const verifyOtp = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { verifyOtp } } }));

function Where() {
  const { pathname, search } = useLocation();
  return <p>destino: {pathname + search}</p>;
}

function renderAt(url: string) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[url]}>
        <NavigationProvider>
          <Routes>
            <Route path="/auth/confirm" element={<ConfirmPage />} />
            <Route path="*" element={<Where />} />
          </Routes>
        </NavigationProvider>
      </MemoryRouter>
    </ToastProvider>,
  );
}

afterEach(cleanup);
beforeEach(() => verifyOtp.mockReset());

describe('ConfirmPage (links dos e-mails)', () => {
  it('valida o token uma única vez e segue para o destino do link', async () => {
    verifyOtp.mockResolvedValue({ error: null });
    renderAt('/auth/confirm?token_hash=abc&type=invite&next=%2Fredefinir-senha%3Fconvite%3D1');
    expect(await screen.findByText('destino: /redefinir-senha?convite=1')).toBeInTheDocument();
    expect(verifyOtp).toHaveBeenCalledTimes(1);
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'abc', type: 'invite' });
  });

  it('nunca redireciona para outro site', async () => {
    verifyOtp.mockResolvedValue({ error: null });
    renderAt('/auth/confirm?token_hash=abc&type=email&next=%2F%2Fexemplo.com');
    expect(await screen.findByText('destino: /')).toBeInTheDocument();
  });

  it('mostra link inválido quando o token expirou ou o tipo não existe', async () => {
    verifyOtp.mockResolvedValue({ error: { message: 'Token has expired or is invalid' } });
    renderAt('/auth/confirm?token_hash=abc&type=recovery&next=%2Fredefinir-senha');
    expect(await screen.findByText('Link inválido ou expirado')).toBeInTheDocument();

    cleanup();
    renderAt('/auth/confirm?token_hash=abc&type=admin');
    expect(await screen.findByText('Link inválido ou expirado')).toBeInTheDocument();
    expect(verifyOtp).toHaveBeenCalledTimes(1);
  });
});
