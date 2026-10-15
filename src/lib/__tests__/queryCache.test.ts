import { describe, expect, it } from 'vitest';
import type { Query } from '@tanstack/react-query';
import { getCacheOwner, persistOptions, setCacheOwner } from '../queryCache';

const query = (key: unknown[], status: 'success' | 'error' | 'pending' = 'success') =>
  ({ queryKey: key, state: { status } }) as unknown as Query;

describe('cache persistido', () => {
  const shouldPersist = persistOptions.dehydrateOptions!.shouldDehydrateQuery!;

  it('salva dados de leitura bem-sucedidos', () => {
    expect(shouldPersist(query(['projects', 'home']))).toBe(true);
    expect(shouldPersist(query(['suggestions', 'abc', null, 'ranking']))).toBe(true);
  });

  it('não salva erros nem dados administrativos com informação pessoal', () => {
    expect(shouldPersist(query(['projects'], 'error'))).toBe(false);
    expect(shouldPersist(query(['admin-users', '']))).toBe(false);
    expect(shouldPersist(query(['audit-log', null]))).toBe(false);
  });

  it('registra e limpa o dono do cache', () => {
    setCacheOwner('user-1');
    expect(getCacheOwner()).toBe('user-1');
    setCacheOwner(null);
    expect(getCacheOwner()).toBeNull();
  });
});
