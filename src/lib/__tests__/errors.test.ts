import { describe, expect, it, vi } from 'vitest';
import { toApiError } from '../errors';

describe('toApiError', () => {
  it('usa a mensagem do banco para os códigos HVxxx', () => {
    const err = toApiError({ code: 'HV403', message: 'Você não pode votar na sua própria sugestão.' });
    expect(err.kind).toBe('forbidden');
    expect(err.message).toBe('Você não pode votar na sua própria sugestão.');
  });

  it('não expõe detalhes internos de erros inesperados', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const err = toApiError({ code: 'XX000', message: 'relation "private.segredo" does not exist' });
    expect(err.kind).toBe('unknown');
    expect(err.message).not.toContain('private');
    spy.mockRestore();
  });

  it('reconhece falhas de rede e falta de permissão', () => {
    expect(toApiError({ message: 'TypeError: Failed to fetch' }).kind).toBe('network');
    expect(toApiError({ code: '42501', message: 'permission denied for function x' }).kind).toBe('forbidden');
  });
});
