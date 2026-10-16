import { beforeEach, describe, expect, it, vi } from 'vitest';

const createSignedUrls = vi.hoisted(() =>
  vi.fn(async (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://cdn.test/${p}?token=t` })) })),
);
vi.mock('../supabase', () => ({ supabase: { storage: { from: () => ({ createSignedUrls }) } } }));

const { clearAvatarUrls, getAvatarUrl } = await import('../avatarUrls');

beforeEach(() => {
  createSignedUrls.mockClear();
  clearAvatarUrls();
});

describe('links assinados das fotos', () => {
  it('agrupa os pedidos da mesma tela numa única chamada e reaproveita o cache', async () => {
    const urls = await Promise.all([getAvatarUrl('a/1.webp'), getAvatarUrl('b/2.webp'), getAvatarUrl('a/1.webp')]);
    expect(urls).toEqual(['https://cdn.test/a/1.webp?token=t', 'https://cdn.test/b/2.webp?token=t', 'https://cdn.test/a/1.webp?token=t']);
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(createSignedUrls).toHaveBeenCalledWith(['a/1.webp', 'b/2.webp'], 3600);

    await getAvatarUrl('b/2.webp');
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
  });

  it('sem acesso à foto devolve null (o avatar mostra as iniciais)', async () => {
    createSignedUrls.mockResolvedValueOnce({ data: [{ path: 'x/y.webp', signedUrl: null as unknown as string }] });
    expect(await getAvatarUrl('x/y.webp')).toBeNull();
  });
});
