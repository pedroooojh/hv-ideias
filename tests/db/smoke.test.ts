import { describe, it, expect } from 'vitest';
import { createTestDb } from './harness';

describe('migrações', () => {
  it('aplicam sem erros e criam o perfil no cadastro', async () => {
    const t = await createTestDb();
    const ana = await t.createUser('Ana');
    const [profile] = await ana.rpc('get_my_profile');
    expect(profile).toMatchObject({ name: 'Ana', role: 'user', status: 'active' });
    await t.close();
  });
});
