import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, errorOf, type Actor, type Row, type TestDb } from './harness';

let t: TestDb;
let admin: Actor;
let projectId: string;

beforeEach(async () => {
  t = await createTestDb();
  admin = await t.createUser('Admin Hubvision', { admin: true });
  const [row] = await admin.rpc<{ create_project: string }>('create_project', {
    p_name: 'Templates de consultas SQL',
    p_description: 'Biblioteca de consultas SQL reutilizáveis.',
    p_category: 'SQL & Relatórios',
    p_status: 'em_desenvolvimento',
  });
  projectId = row.create_project;
});

afterEach(async () => {
  await t.close();
});

async function suggest(author: Actor, title: string, type = 'melhoria'): Promise<string> {
  const [row] = await author.rpc<{ create_suggestion: string }>('create_suggestion', {
    p_project_id: projectId,
    p_type: type,
    p_title: title,
    p_description: `Descrição detalhada de ${title}.`,
  });
  return row.create_suggestion;
}

async function voters(n: number, prefix = 'Votante'): Promise<Actor[]> {
  const list: Actor[] = [];
  for (let i = 0; i < n; i++) list.push(await t.createUser(`${prefix} ${i + 1}`));
  return list;
}

async function vote(actor: Actor, suggestionId: string, value = true) {
  const [row] = await actor.rpc<{ vote_count: number; has_voted: boolean }>('set_vote', {
    p_suggestion_id: suggestionId,
    p_vote: value,
  });
  return { vote_count: Number(row.vote_count), has_voted: row.has_voted };
}

async function scoreOf(actor: Actor) {
  const [row] = await actor.rpc<Row>('get_my_score');
  return { score: Number(row.score), votes: Number(row.votes_received), suggestions: Number(row.suggestion_count) };
}

describe('Cenário A — cadastro de sugestão', () => {
  it('associa a sugestão ao projeto e ao autor autenticado e a lista no projeto', async () => {
    const ana = await t.createUser('Ana');
    const id = await suggest(ana, 'Exportar relatório em PDF');

    const [stored] = await t.raw<Row>('select project_id, author_id, status from public.suggestions where id = $1', [id]);
    expect(stored).toMatchObject({ project_id: projectId, author_id: ana.id, status: 'em_analise' });

    const list = await ana.rpc<Row>('list_suggestions', { p_project_id: projectId });
    expect(list.map((s) => s.id)).toEqual([id]);
    expect(list[0]).toMatchObject({ author_name: 'Ana', is_author: true, has_voted: false });
  });

  it('valida campos obrigatórios, tamanhos, tipo e existência do projeto', async () => {
    const ana = await t.createUser('Ana');
    const base = { p_project_id: projectId, p_type: 'melhoria', p_title: 'Título válido', p_description: 'Descrição suficiente.' };

    expect((await errorOf(ana.rpc('create_suggestion', { ...base, p_title: '   ' }))).code).toBe('HV422');
    expect((await errorOf(ana.rpc('create_suggestion', { ...base, p_title: 'abc' }))).code).toBe('HV422');
    expect((await errorOf(ana.rpc('create_suggestion', { ...base, p_description: 'x'.repeat(5001) }))).code).toBe('HV422');
    expect((await errorOf(ana.rpc('create_suggestion', { ...base, p_type: 'bug_inexistente' }))).code).toBe('HV422');
    expect(
      (await errorOf(ana.rpc('create_suggestion', { ...base, p_project_id: '00000000-0000-0000-0000-000000000000' }))).code,
    ).toBe('HV404');
  });

  it('exige login para publicar', async () => {
    const err = await errorOf(
      t.anon.rpc('create_suggestion', {
        p_project_id: projectId,
        p_type: 'melhoria',
        p_title: 'Sem login',
        p_description: 'Tentativa anônima de publicar.',
      }),
    );
    expect(err.code).toBe('42501'); // anon não tem permissão de execução
  });
});

describe('Cenário B — filtros e ordenação', () => {
  it('combina filtro por tipo com ordenação por ranking e por recentes', async () => {
    const [ana, bia] = [await t.createUser('Ana'), await t.createUser('Bia')];
    const m1 = await suggest(ana, 'Melhoria antiga', 'melhoria');
    const n1 = await suggest(ana, 'Funcionalidade nova', 'nova_funcionalidade');
    const m2 = await suggest(bia, 'Melhoria recente', 'melhoria');
    await t.raw(`update public.suggestions set created_at = now() - interval '3 days' where id = $1`, [m1]);
    await t.raw(`update public.suggestions set created_at = now() - interval '2 days' where id = $1`, [n1]);

    for (const v of await voters(3)) await vote(v, m1);
    const [v4] = await voters(1, 'Extra');
    await vote(v4, m2);

    const ids = async (args: Record<string, unknown>) =>
      (await ana.rpc<Row>('list_suggestions', { p_project_id: projectId, ...args })).map((s) => s.id);

    expect(await ids({ p_sort: 'ranking' })).toEqual([m1, m2, n1]);
    expect(await ids({ p_sort: 'recentes' })).toEqual([m2, n1, m1]);
    expect(await ids({ p_type: 'melhoria', p_sort: 'ranking' })).toEqual([m1, m2]);
    expect(await ids({ p_type: 'melhoria', p_sort: 'recentes' })).toEqual([m2, m1]);
    expect(await ids({ p_type: 'nova_funcionalidade', p_sort: 'ranking' })).toEqual([n1]);
  });

  it('desempata votos iguais pela publicação mais recente', async () => {
    const ana = await t.createUser('Ana');
    const older = await suggest(ana, 'Mais antiga');
    const newer = await suggest(ana, 'Mais recente');
    await t.raw(`update public.suggestions set created_at = now() - interval '1 day' where id = $1`, [older]);
    const list = await ana.rpc<Row>('list_suggestions', { p_project_id: projectId, p_sort: 'ranking' });
    expect(list.map((s) => s.id)).toEqual([newer, older]);
  });

  it('pagina e informa o total', async () => {
    const ana = await t.createUser('Ana');
    for (let i = 0; i < 5; i++) await suggest(ana, `Sugestão número ${i}`);
    const page = await ana.rpc<Row>('list_suggestions', { p_project_id: projectId, p_limit: 2, p_offset: 2 });
    expect(page).toHaveLength(2);
    expect(Number(page[0].total_count)).toBe(5);
    expect((await errorOf(ana.rpc('list_suggestions', { p_project_id: projectId, p_sort: 'drop table' }))).code).toBe('HV422');
  });
});

describe('Cenário C — votação e pontuação (0,5 ponto por voto válido)', () => {
  it('reproduz o exemplo obrigatório: 6 votos = 3 pontos; +4 votos = 5 pontos; retirar 1 voto = -0,5', async () => {
    const autor = await t.createUser('Autor');
    const a = await suggest(autor, 'Sugestão A');
    const b = await suggest(autor, 'Sugestão B');
    const c = await suggest(autor, 'Sugestão C');
    const pool = await voters(6);

    for (const v of pool) await vote(v, a);
    expect(await scoreOf(autor)).toEqual({ score: 3, votes: 6, suggestions: 3 });

    const mine = await autor.rpc<Row>('list_my_suggestions');
    const points = Object.fromEntries(mine.map((s) => [s.id as string, Number(s.points)]));
    expect(points).toEqual({ [a]: 3, [b]: 0, [c]: 0 });

    for (const v of pool.slice(0, 4)) await vote(v, c);
    expect((await scoreOf(autor)).score).toBe(5);

    await vote(pool[0], c, false);
    expect((await scoreOf(autor)).score).toBe(4.5);
  });

  it('criar sugestões sem votos não gera pontos', async () => {
    const autor = await t.createUser('Autor');
    await suggest(autor, 'Sem votos 1');
    await suggest(autor, 'Sem votos 2');
    expect(await scoreOf(autor)).toEqual({ score: 0, votes: 0, suggestions: 2 });
  });

  it('ordena o ranking por pontos, depois votos e participação mais antiga, sem expor e-mails', async () => {
    const [ana, bia, caio] = [await t.createUser('Ana'), await t.createUser('Bia'), await t.createUser('Caio')];
    const sa = await suggest(ana, 'Ideia da Ana');
    const sb = await suggest(bia, 'Ideia da Bia');
    await suggest(caio, 'Ideia do Caio');
    await t.raw(`update public.suggestions set created_at = now() - interval '5 days' where id = $1`, [sb]);
    const pool = await voters(3);
    for (const v of pool) await vote(v, sa);
    for (const v of pool.slice(0, 1)) await vote(v, sb);
    await vote(pool[1], sb);
    await vote(pool[2], sb);

    const ranking = await caio.rpc<Row>('get_ranking');
    // Ana e Bia empatam em 1,5 ponto/3 votos; Bia participa há mais tempo.
    expect(ranking.map((r) => [Number(r.rank_position), r.user_name, Number(r.score)])).toEqual([
      [1, 'Bia', 1.5],
      [2, 'Ana', 1.5],
      [3, 'Caio', 0],
    ]);
    expect(ranking.find((r) => r.user_name === 'Caio')?.is_me).toBe(true);
    for (const r of ranking) {
      expect(Object.keys(r).sort()).toEqual(
        ['is_me', 'rank_position', 'score', 'suggestion_count', 'total_count', 'user_avatar', 'user_id', 'user_name', 'votes_received'].sort(),
      );
    }
  });

  it('não aceita pontuação vinda do cliente: não há escrita direta nas tabelas', async () => {
    const ana = await t.createUser('Ana');
    const id = await suggest(ana, 'Tentativa de fraude');
    const insert = await errorOf(ana.sql(`insert into public.votes (user_id, suggestion_id) values ($1, $2)`, [ana.id, id]));
    expect(insert.code).toBe('42501');
    const update = await errorOf(ana.sql(`update public.profiles set role = 'admin' where id = $1`, [ana.id]));
    expect(update.code).toBe('42501');
  });
});

describe('Cenário D — prevenção de votos duplicados', () => {
  it('mantém um único voto por usuário e sugestão, mesmo com tentativas repetidas e simultâneas', async () => {
    const autor = await t.createUser('Autor');
    const id = await suggest(autor, 'Votar várias vezes');
    const [eleitor] = await voters(1);

    await Promise.all(Array.from({ length: 5 }, () => vote(eleitor, id)));
    const again = await vote(eleitor, id);
    expect(again).toEqual({ vote_count: 1, has_voted: true });

    const [{ n }] = await t.raw<{ n: number }>('select count(*)::int as n from public.votes where suggestion_id = $1', [id]);
    expect(n).toBe(1);
    expect((await scoreOf(autor)).score).toBe(0.5);
  });

  it('o banco rejeita duplicatas mesmo fora da API', async () => {
    const autor = await t.createUser('Autor');
    const id = await suggest(autor, 'Restrição única');
    const [eleitor] = await voters(1);
    await vote(eleitor, id);
    const err = await errorOf(
      t.raw('insert into public.votes (user_id, suggestion_id) values ($1, $2)', [eleitor.id, id]),
    );
    expect(err.code).toBe('23505');
  });

  it('impede o autor de votar na própria sugestão (API e banco)', async () => {
    const autor = await t.createUser('Autor');
    const id = await suggest(autor, 'Autovoto proibido');
    expect((await errorOf(vote(autor, id))).code).toBe('HV403');
    const direct = await errorOf(
      t.raw('insert into public.votes (user_id, suggestion_id) values ($1, $2)', [autor.id, id]),
    );
    expect(direct.code).toBe('HV403');
    expect((await scoreOf(autor)).score).toBe(0);
  });

  it('retirar o voto é idempotente e mostra se o usuário votou', async () => {
    const autor = await t.createUser('Autor');
    const id = await suggest(autor, 'Retirar voto');
    const [eleitor] = await voters(1);
    expect(await vote(eleitor, id)).toEqual({ vote_count: 1, has_voted: true });
    const [detail] = await eleitor.rpc<Row>('get_suggestion', { p_id: id });
    expect(detail.has_voted).toBe(true);
    expect(await vote(eleitor, id, false)).toEqual({ vote_count: 0, has_voted: false });
    expect(await vote(eleitor, id, false)).toEqual({ vote_count: 0, has_voted: false });
  });

  it('recusa votos em sugestões inexistentes, excluídas ou com votação encerrada', async () => {
    const autor = await t.createUser('Autor');
    const [eleitor] = await voters(1);
    expect((await errorOf(vote(eleitor, '00000000-0000-0000-0000-000000000000'))).code).toBe('HV404');

    const removida = await suggest(autor, 'Será removida');
    await autor.rpc('delete_suggestion', { p_id: removida });
    expect((await errorOf(vote(eleitor, removida))).code).toBe('HV404');

    const recusada = await suggest(autor, 'Será recusada');
    await admin.rpc('set_suggestion_status', { p_id: recusada, p_status: 'nao_aprovado', p_reason: 'Fora do escopo.' });
    expect((await errorOf(vote(eleitor, recusada))).code).toBe('HV409');
  });

  it('limita requisições abusivas de votação', async () => {
    const autor = await t.createUser('Autor');
    const id = await suggest(autor, 'Muitos cliques');
    const [eleitor] = await voters(1);
    for (let i = 0; i < 60; i++) await vote(eleitor, id, i % 2 === 0);
    expect((await errorOf(vote(eleitor, id))).code).toBe('HV429');
  });
});

describe('Cenário E — permissões', () => {
  it('usuário comum não acessa operações administrativas por requisição direta', async () => {
    const ana = await t.createUser('Ana');
    const id = await suggest(ana, 'Minha sugestão');
    const calls: Array<[string, Record<string, unknown>]> = [
      ['create_project', { p_name: 'Projeto pirata', p_description: 'Não deveria existir.', p_category: 'Teste' }],
      ['update_project', { p_id: projectId, p_name: 'Renomeado', p_description: 'Descrição alterada.', p_category: 'X1', p_status: 'arquivado' }],
      ['delete_project', { p_id: projectId, p_confirm_with_suggestions: true }],
      ['set_suggestion_status', { p_id: id, p_status: 'implementado' }],
      ['admin_list_users', {}],
      ['admin_update_user', { p_user_id: ana.id, p_role: 'admin', p_status: 'active' }],
      ['admin_list_audit_log', {}],
    ];
    for (const [fn, args] of calls) {
      expect((await errorOf(ana.rpc(fn, args))).code, fn).toBe('HV403');
    }
    const audit = await ana.sql('select * from public.audit_log');
    expect(audit).toEqual([]);
  });

  it('fila de sugestões do administrador filtra por status e é negada a usuários comuns', async () => {
    const ana = await t.createUser('Ana');
    const a = await suggest(ana, 'Aguardando análise');
    const b = await suggest(ana, 'Já planejada');
    await admin.rpc('set_suggestion_status', { p_id: b, p_status: 'planejado' });
    const removida = await suggest(ana, 'Removida pela autora');
    await ana.rpc('delete_suggestion', { p_id: removida });

    const pending = await admin.rpc<Row>('admin_list_suggestions', { p_status: 'em_analise' });
    expect(pending.map((s) => s.id)).toEqual([a]);
    expect(Number(pending[0].total_count)).toBe(1);
    expect((await admin.rpc<Row>('admin_list_suggestions')).map((s) => s.id).sort()).toEqual([a, b].sort());
    expect((await errorOf(admin.rpc('admin_list_suggestions', { p_status: 'qualquer' }))).code).toBe('HV422');
    expect((await errorOf(ana.rpc('admin_list_suggestions'))).code).toBe('HV403');
    expect((await errorOf(t.anon.rpc('admin_list_suggestions'))).code).toBe('42501');
  });

  it('autor edita e exclui a própria sugestão apenas enquanto em análise', async () => {
    const ana = await t.createUser('Ana');
    const bia = await t.createUser('Bia');
    const id = await suggest(ana, 'Editável');
    const edit = { p_id: id, p_type: 'nova_funcionalidade', p_title: 'Título editado', p_description: 'Descrição editada pela autora.' };

    expect((await errorOf(bia.rpc('update_suggestion', edit))).code).toBe('HV403');
    expect((await errorOf(bia.rpc('delete_suggestion', { p_id: id }))).code).toBe('HV403');

    await ana.rpc('update_suggestion', edit);
    const [after] = await ana.rpc<Row>('get_suggestion', { p_id: id });
    expect(after).toMatchObject({ title: 'Título editado', type: 'nova_funcionalidade', can_edit: true });

    await admin.rpc('set_suggestion_status', { p_id: id, p_status: 'em_desenvolvimento' });
    expect((await errorOf(ana.rpc('update_suggestion', edit))).code).toBe('HV409');
    expect((await errorOf(ana.rpc('delete_suggestion', { p_id: id }))).code).toBe('HV409');
    const [locked] = await ana.rpc<Row>('get_suggestion', { p_id: id });
    expect(locked).toMatchObject({ can_edit: false, can_delete: false });
  });

  it('administrador gerencia projetos e sugestões de outros usuários, com auditoria', async () => {
    const ana = await t.createUser('Ana');
    const id = await suggest(ana, 'Ajuste do admin');
    await admin.rpc('set_suggestion_status', { p_id: id, p_status: 'em_desenvolvimento' });
    await admin.rpc('update_suggestion', {
      p_id: id, p_type: 'melhoria', p_title: 'Ajustada pelo admin', p_description: 'Texto revisado pela administração.',
    });
    await admin.rpc('update_project', {
      p_id: projectId, p_name: 'Templates SQL', p_description: 'Nova descrição do projeto.', p_category: 'SQL', p_status: 'planejado',
    });
    const [project] = await admin.rpc<Row>('get_project', { p_id: projectId });
    expect(project).toMatchObject({ name: 'Templates SQL', status: 'planejado' });

    const log = await admin.rpc<Row>('admin_list_audit_log');
    expect(log.map((l) => l.action)).toEqual(
      expect.arrayContaining(['project.create', 'project.update', 'suggestion.update', 'suggestion.status_change']),
    );
  });

  it('conta desativada não consegue publicar, votar ou comentar', async () => {
    const ana = await t.createUser('Ana');
    const bia = await t.createUser('Bia');
    const id = await suggest(bia, 'Sugestão da Bia');
    await admin.rpc('admin_update_user', { p_user_id: ana.id, p_role: 'user', p_status: 'disabled' });

    expect((await errorOf(vote(ana, id))).code).toBe('HV403');
    expect((await errorOf(ana.rpc('create_comment', { p_suggestion_id: id, p_content: 'Oi' }))).code).toBe('HV403');
    const [me] = await ana.rpc<Row>('get_my_profile');
    expect(me.status).toBe('disabled');
  });

  it('administrador não remove o próprio acesso por engano', async () => {
    const err = await errorOf(admin.rpc('admin_update_user', { p_user_id: admin.id, p_role: 'user', p_status: 'active' }));
    expect(err.code).toBe('HV409');
  });

  it('sem login nada é acessível: nenhuma função e nenhuma tabela', async () => {
    const ana = await t.createUser('Ana');
    await suggest(ana, 'Visível só logado');
    const { rows } = await t.db.query<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`,
    );
    expect(rows.length).toBeGreaterThan(20);
    for (const { proname } of rows) {
      const allowed = await t.raw<{ ok: boolean }>(
        `select bool_or(has_function_privilege('anon', p.oid, 'execute')) as ok
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = $1`,
        [proname],
      );
      expect(allowed[0].ok, proname).toBe(false);
    }
    expect((await errorOf(t.anon.rpc('list_projects'))).code).toBe('42501');
    expect((await errorOf(t.anon.rpc('get_platform_stats'))).code).toBe('42501');
    for (const table of ['projects', 'suggestions', 'suggestion_types', 'profiles', 'votes', 'comments', 'audit_log']) {
      expect((await errorOf(t.anon.sql(`select * from public.${table}`))).code, table).toBe('42501');
    }
  });

  it('usuário logado vê projetos e indicadores (com destaque)', async () => {
    const ana = await t.createUser('Ana');
    await suggest(ana, 'Visível só logado');
    expect(await ana.rpc('list_projects')).toHaveLength(1);
    const [{ get_platform_stats: stats }] = await ana.rpc<Row>('get_platform_stats');
    expect(stats).toMatchObject({ active_projects: 1, total_suggestions: 1 });
  });

  it('conta desativada também perde a leitura', async () => {
    const ana = await t.createUser('Ana');
    await admin.rpc('admin_update_user', { p_user_id: ana.id, p_role: 'user', p_status: 'disabled' });
    expect((await errorOf(ana.rpc('list_projects'))).code).toBe('HV403');
    expect((await errorOf(ana.rpc('get_platform_stats'))).code).toBe('HV403');
  });
});

describe('Cenário F — exclusão de sugestão', () => {
  it('some das listagens públicas, deixa de pontuar e preserva o registro', async () => {
    const autor = await t.createUser('Autor');
    const id = await suggest(autor, 'Será excluída');
    for (const v of await voters(4)) await vote(v, id);
    expect((await scoreOf(autor)).score).toBe(2);

    await autor.rpc('delete_suggestion', { p_id: id });

    expect(await autor.rpc('list_suggestions', { p_project_id: projectId })).toEqual([]);
    expect((await errorOf(autor.rpc('get_suggestion', { p_id: id }))).code).toBe('HV404');
    expect(await scoreOf(autor)).toEqual({ score: 0, votes: 0, suggestions: 0 });
    expect(await autor.rpc('get_ranking')).toEqual([]);

    const [stored] = await t.raw<Row>('select deleted_at, deleted_by from public.suggestions where id = $1', [id]);
    expect(stored.deleted_at).not.toBeNull();
    expect(stored.deleted_by).toBe(autor.id);
    const [{ n }] = await t.raw<{ n: number }>('select count(*)::int as n from public.votes where suggestion_id = $1', [id]);
    expect(n).toBe(4);
  });

  it('excluir projeto com sugestões exige confirmação explícita', async () => {
    const autor = await t.createUser('Autor');
    await suggest(autor, 'Sugestão vinculada');
    const err = await errorOf(admin.rpc('delete_project', { p_id: projectId }));
    expect(err.code).toBe('HV409');
    expect(err.message).toContain('1 sugestão');

    await admin.rpc('delete_project', { p_id: projectId, p_confirm_with_suggestions: true });
    expect(await admin.rpc('list_projects')).toEqual([]);
    expect((await errorOf(admin.rpc('get_project', { p_id: projectId }))).code).toBe('HV404');
  });
});

describe('Cenário G — status', () => {
  it('persiste a mudança, registra histórico e não altera a pontuação', async () => {
    const autor = await t.createUser('Autor');
    const id = await suggest(autor, 'Muda de status');
    for (const v of await voters(2)) await vote(v, id);

    for (const status of ['planejado', 'em_desenvolvimento', 'implementado']) {
      await admin.rpc('set_suggestion_status', { p_id: id, p_status: status });
      expect((await scoreOf(autor)).score).toBe(1);
    }

    const [detail] = await autor.rpc<Row>('get_suggestion', { p_id: id });
    expect(detail).toMatchObject({ status: 'implementado', voting_open: false });
    const [listed] = await autor.rpc<Row>('list_suggestions', { p_project_id: projectId });
    expect(listed.status).toBe('implementado');

    const history = await autor.rpc<Row>('list_status_history', { p_suggestion_id: id });
    expect(history.map((h) => [h.previous_status, h.new_status, h.actor_name])).toEqual([
      ['em_desenvolvimento', 'implementado', 'Admin Hubvision'],
      ['planejado', 'em_desenvolvimento', 'Admin Hubvision'],
      ['em_analise', 'planejado', 'Admin Hubvision'],
    ]);
  });

  it('exige justificativa para não aprovação e a exibe aos usuários', async () => {
    const autor = await t.createUser('Autor');
    const id = await suggest(autor, 'Será avaliada');
    expect((await errorOf(admin.rpc('set_suggestion_status', { p_id: id, p_status: 'nao_aprovado' }))).code).toBe('HV422');
    await admin.rpc('set_suggestion_status', { p_id: id, p_status: 'nao_aprovado', p_reason: 'Já existe no roadmap do ERP.' });
    const [detail] = await autor.rpc<Row>('get_suggestion', { p_id: id });
    expect(detail).toMatchObject({ status: 'nao_aprovado', status_reason: 'Já existe no roadmap do ERP.' });
  });
});

describe('Cenário H — comentários', () => {
  it('publica na sugestão correta, atualiza a contagem e não gera pontos', async () => {
    const autor = await t.createUser('Autor');
    const leitor = await t.createUser('Leitor');
    const id = await suggest(autor, 'Com discussão');
    const outra = await suggest(autor, 'Sem discussão');

    await leitor.rpc('create_comment', { p_suggestion_id: id, p_content: '  Ótima ideia!  ' });
    await autor.rpc('create_comment', { p_suggestion_id: id, p_content: 'Obrigado.' });

    const comments = await leitor.rpc<Row>('list_comments', { p_suggestion_id: id });
    expect(comments.map((c) => [c.author_name, c.content])).toEqual([
      ['Leitor', 'Ótima ideia!'],
      ['Autor', 'Obrigado.'],
    ]);
    expect(await leitor.rpc('list_comments', { p_suggestion_id: outra })).toEqual([]);

    const list = await leitor.rpc<Row>('list_suggestions', { p_project_id: projectId });
    const counts = Object.fromEntries(list.map((s) => [s.id as string, Number(s.comment_count)]));
    expect(counts).toEqual({ [id]: 2, [outra]: 0 });
    expect((await scoreOf(autor)).score).toBe(0);
    expect((await scoreOf(leitor)).score).toBe(0);
  });

  it('valida conteúdo, permite editar o próprio e moderar com marcador e auditoria', async () => {
    const autor = await t.createUser('Autor');
    const leitor = await t.createUser('Leitor');
    const id = await suggest(autor, 'Moderação');

    expect((await errorOf(leitor.rpc('create_comment', { p_suggestion_id: id, p_content: '   ' }))).code).toBe('HV422');
    expect((await errorOf(leitor.rpc('create_comment', { p_suggestion_id: id, p_content: 'x'.repeat(2001) }))).code).toBe('HV422');

    const [{ create_comment: cid }] = await leitor.rpc<{ create_comment: string }>('create_comment', {
      p_suggestion_id: id, p_content: 'Primeira versão',
    });
    expect((await errorOf(autor.rpc('update_comment', { p_id: cid, p_content: 'Hackeado' }))).code).toBe('HV403');
    expect((await errorOf(autor.rpc('delete_comment', { p_id: cid }))).code).toBe('HV403');

    await leitor.rpc('update_comment', { p_id: cid, p_content: 'Versão corrigida' });
    let [c] = await leitor.rpc<Row>('list_comments', { p_suggestion_id: id });
    expect(c.content).toBe('Versão corrigida');
    expect(c.edited_at).not.toBeNull();

    await admin.rpc('delete_comment', { p_id: cid });
    [c] = await leitor.rpc<Row>('list_comments', { p_suggestion_id: id });
    expect(c).toMatchObject({ is_deleted: true, deletion_reason: 'moderation', content: null, author_name: null });
    const [detail] = await leitor.rpc<Row>('get_suggestion', { p_id: id });
    expect(Number(detail.comment_count)).toBe(0);
    const log = await admin.rpc<Row>('admin_list_audit_log', { p_entity_type: 'comment' });
    expect(log[0].action).toBe('comment.moderate');
  });
});

describe('Cenário I — registros ausentes e projetos arquivados', () => {
  it('retorna HV404 para registros inexistentes', async () => {
    const ana = await t.createUser('Ana');
    const missing = '00000000-0000-0000-0000-000000000000';
    expect((await errorOf(ana.rpc('get_suggestion', { p_id: missing }))).code).toBe('HV404');
    expect((await errorOf(ana.rpc('get_project', { p_id: missing }))).code).toBe('HV404');
    expect((await errorOf(ana.rpc('list_comments', { p_suggestion_id: missing }))).code).toBe('HV404');
    expect((await errorOf(ana.rpc('create_comment', { p_suggestion_id: missing, p_content: 'Oi' }))).code).toBe('HV404');
  });

  it('projeto arquivado não recebe novas sugestões nem votos, mas mantém a pontuação', async () => {
    const autor = await t.createUser('Autor');
    const id = await suggest(autor, 'Antes do arquivamento');
    const [eleitor, outro] = await voters(2);
    await vote(eleitor, id);
    await admin.rpc('update_project', {
      p_id: projectId, p_name: 'Templates SQL', p_description: 'Projeto arquivado.', p_category: 'SQL', p_status: 'arquivado',
    });
    expect((await errorOf(suggest(autor, 'Depois do arquivamento'))).code).toBe('HV409');
    expect((await errorOf(vote(outro, id))).code).toBe('HV409');
    expect((await scoreOf(autor)).score).toBe(0.5);
  });
});

describe('Indicadores da página inicial', () => {
  it('contam apenas dados válidos', async () => {
    const autor = await t.createUser('Autor');
    const viva = await suggest(autor, 'Sugestão ativa');
    const morta = await suggest(autor, 'Sugestão excluída');
    const pool = await voters(3);
    for (const v of pool) await vote(v, viva);
    await vote(pool[0], morta);
    await autor.rpc('delete_suggestion', { p_id: morta });
    await admin.rpc('set_suggestion_status', { p_id: viva, p_status: 'em_desenvolvimento' });

    const [{ get_platform_stats: stats }] = await autor.rpc<{ get_platform_stats: Row }>('get_platform_stats');
    expect(stats).toMatchObject({
      active_projects: 1,
      total_suggestions: 1,
      total_votes: 3,
      in_development: 1,
      votes_last_24h: 3,
    });
    expect((stats.top_projects as Row[])[0]).toMatchObject({ name: 'Templates de consultas SQL', vote_count: 3, share: 100 });
    expect(stats.highlight).toMatchObject({ suggestion_id: viva, status: 'em_desenvolvimento', vote_count: 3 });
  });
});

describe('Filtros padronizados', () => {
  it('lista de projetos filtra por busca e status, com contagem por status', async () => {
    const ana = await t.createUser('Ana');
    await admin.rpc('create_project', {
      p_name: 'Portal de Chamados', p_description: 'Abertura e triagem de chamados.', p_category: 'Helpdesk', p_status: 'planejado',
    });
    const names = async (args: Record<string, unknown>) => (await ana.rpc<Row>('list_projects', args)).map((p) => p.name);
    expect(await names({ p_search: 'chamad' })).toEqual(['Portal de Chamados']);
    expect(await names({ p_search: 'SQL' })).toEqual(['Templates de consultas SQL']);
    expect(await names({ p_status: 'planejado' })).toEqual(['Portal de Chamados']);
    // % e _ são texto literal, não curinga
    expect(await names({ p_search: '%' })).toEqual([]);
    expect(await names({ p_search: '_' })).toEqual([]);
    const [{ project_status_counts: counts }] = await ana.rpc<Row>('project_status_counts');
    expect(counts).toEqual({ em_desenvolvimento: 1, planejado: 1 });
    expect((await errorOf(ana.rpc('list_projects', { p_status: 'qualquer' }))).code).toBe('HV422');
    expect((await errorOf(ana.rpc('list_projects', { p_search: 'x'.repeat(101) }))).code).toBe('HV422');
  });

  it('sugestões do projeto combinam tipo, status, busca e ordenação; get_project traz contagens por status', async () => {
    const ana = await t.createUser('Ana');
    const a = await suggest(ana, 'Exportar relatório em PDF', 'nova_funcionalidade');
    const b = await suggest(ana, 'Filtro por filial', 'melhoria');
    await suggest(ana, 'Exportar planilha XLSX', 'nova_funcionalidade');
    await admin.rpc('set_suggestion_status', { p_id: a, p_status: 'planejado' });
    await admin.rpc('set_suggestion_status', { p_id: b, p_status: 'planejado' });

    const ids = async (args: Record<string, unknown>) =>
      (await ana.rpc<Row>('list_suggestions', { p_project_id: projectId, ...args })).map((s) => s.id);
    expect(await ids({ p_status: 'planejado', p_type: 'nova_funcionalidade' })).toEqual([a]);
    expect((await ids({ p_search: 'exportar' })).length).toBe(2);
    expect(await ids({ p_search: 'exportar', p_status: 'planejado' })).toEqual([a]);

    const [project] = await ana.rpc<Row>('get_project', { p_id: projectId });
    expect(project.status_counts).toEqual({ planejado: 2, em_analise: 1 });
    expect((await errorOf(ana.rpc('list_suggestions', { p_project_id: projectId, p_status: 'x' }))).code).toBe('HV422');
  });

  it('minhas sugestões filtram por status', async () => {
    const ana = await t.createUser('Ana');
    const a = await suggest(ana, 'Primeira sugestão');
    await suggest(ana, 'Segunda sugestão');
    await admin.rpc('set_suggestion_status', { p_id: a, p_status: 'implementado' });
    const mine = await ana.rpc<Row>('list_my_suggestions', { p_status: 'implementado' });
    expect(mine.map((s) => s.id)).toEqual([a]);
  });

  it('gestão: fila e usuários filtram e contam; usuário comum não acessa', async () => {
    const ana = await t.createUser('Ana Paula', { email: 'ana.paula@exemplo.test' });
    const bia = await t.createUser('Bia');
    await suggest(ana, 'Exportar relatório', 'nova_funcionalidade');
    const x = await suggest(bia, 'Atalho de teclado', 'melhoria');
    await admin.rpc('set_suggestion_status', { p_id: x, p_status: 'planejado' });
    await admin.rpc('admin_update_user', { p_user_id: bia.id, p_role: 'user', p_status: 'disabled' });

    const queue = await admin.rpc<Row>('admin_list_suggestions', { p_search: 'ana paula' });
    expect(queue.map((s) => s.title)).toEqual(['Exportar relatório']);
    expect((await admin.rpc<Row>('admin_list_suggestions', { p_type: 'melhoria' })).map((s) => s.id)).toEqual([x]);
    const [{ admin_suggestion_status_counts: sc }] = await admin.rpc<Row>('admin_suggestion_status_counts');
    expect(sc).toEqual({ em_analise: 1, planejado: 1 });

    const users = async (args: Record<string, unknown>) => (await admin.rpc<Row>('admin_list_users', args)).map((u) => u.name);
    expect(await users({ p_search: 'ana.paula@' })).toEqual(['Ana Paula']);
    expect(await users({ p_status: 'disabled' })).toEqual(['Bia']);
    expect(await users({ p_role: 'admin' })).toEqual(['Admin Hubvision']);
    const [{ admin_user_status_counts: uc }] = await admin.rpc<Row>('admin_user_status_counts');
    expect(uc).toEqual({ active: 2, disabled: 1 });

    for (const fn of ['admin_suggestion_status_counts', 'admin_user_status_counts']) {
      expect((await errorOf(ana.rpc(fn))).code, fn).toBe('HV403');
    }
  });
});

describe('Ranking semanal (fechamento às sextas)', () => {
  async function weekly(actor: Actor, weeksAgo = 0) {
    const [{ get_weekly_ranking: w }] = await actor.rpc<{ get_weekly_ranking: Row }>('get_weekly_ranking', {
      p_weeks_ago: weeksAgo,
    });
    return w as {
      week_start: string;
      week_end: string;
      is_closing_day: boolean;
      total_count: number;
      entries: Row[];
      me: { rank_position: number | null; score: number; votes_received: number };
    };
  }

  it('conta só os votos recebidos na semana e mantém o ranking geral acumulado', async () => {
    const [ana, bia, caio] = [await t.createUser('Ana'), await t.createUser('Bia'), await t.createUser('Caio')];
    const sa = await suggest(ana, 'Ideia da Ana');
    const sb = await suggest(bia, 'Ideia da Bia');
    await suggest(caio, 'Ideia do Caio');
    const pool = await voters(4);
    for (const v of pool) await vote(v, sa);
    for (const v of pool.slice(0, 2)) await vote(v, sb);
    // Três votos da Ana foram dados na semana passada: contam no geral, não na semana atual.
    await t.raw(
      `update public.votes set created_at = (select week_start from private.ranking_week(1)) + interval '1 day'
       where suggestion_id = $1 and user_id = any($2::uuid[])`,
      [sa, pool.slice(0, 3).map((v) => v.id)],
    );

    const current = await weekly(caio);
    expect(current.entries.map((r) => [r.rank_position, r.user_name, Number(r.score)])).toEqual([
      [1, 'Bia', 1],
      [2, 'Ana', 0.5],
    ]);
    expect(current.total_count).toBe(2);
    expect(current.me).toEqual({ rank_position: null, score: 0, votes_received: 0 });
    expect(new Date(current.week_end).getTime() - new Date(current.week_start).getTime()).toBe(7 * 86_400_000);

    const last = await weekly(ana, 1);
    expect(last.is_closing_day).toBe(false);
    expect(last.entries.map((r) => [r.user_name, Number(r.score), r.is_me])).toEqual([['Ana', 1.5, true]]);
    expect(last.me.rank_position).toBe(1);
    expect(new Date(last.week_end).getTime()).toBe(new Date(current.week_start).getTime());

    expect((await caio.rpc<Row>('get_ranking')).map((r) => [r.user_name, Number(r.score)])).toEqual([
      ['Ana', 2],
      ['Bia', 1],
      ['Caio', 0],
    ]);
  });

  it('a semana começa no sábado e o fechamento é na sexta (horário de Brasília)', async () => {
    const [w] = await t.raw<{ dow: number; hour: number }>(
      `select extract(dow from week_start at time zone 'America/Sao_Paulo')::int as dow,
              extract(hour from week_start at time zone 'America/Sao_Paulo')::int as hour
       from private.ranking_week(0)`,
    );
    expect(w).toEqual({ dow: 6, hour: 0 });
    const [{ friday }] = await t.raw<{ friday: boolean }>(
      `select extract(dow from now() at time zone 'America/Sao_Paulo') = 5 as friday`,
    );
    const ana = await t.createUser('Ana');
    expect((await weekly(ana)).is_closing_day).toBe(friday);
  });

  it('valida parâmetros e exige login', async () => {
    const ana = await t.createUser('Ana');
    expect((await errorOf(ana.rpc('get_weekly_ranking', { p_weeks_ago: -1 }))).code).toBe('HV422');
    expect((await errorOf(ana.rpc('get_weekly_ranking', { p_limit: 51 }))).code).toBe('HV422');
    expect((await errorOf(t.anon.rpc('get_weekly_ranking'))).code).toBe('42501');
  });
});

describe('Foto de perfil', () => {
  const upload = (actor: Actor, name: string) =>
    actor.sql(`insert into storage.objects (bucket_id, name, owner) values ('avatars', $1, $2)`, [name, actor.id]);

  it('aparece para todos nas sugestões, comentários e rankings', async () => {
    const ana = await t.createUser('Ana');
    const bia = await t.createUser('Bia');
    const path = `${ana.id}/foto-1.webp`;
    await upload(ana, path);
    await ana.rpc('set_my_avatar', { p_path: path });

    const id = await suggest(ana, 'Ideia com foto');
    await vote(bia, id);
    await ana.rpc('create_comment', { p_suggestion_id: id, p_content: 'Comentário da Ana' });

    const [profile] = await ana.rpc<Row>('get_my_profile');
    expect(profile.avatar_path).toBe(path);
    const [listed] = await bia.rpc<Row>('list_suggestions', { p_project_id: projectId });
    expect(listed.author_avatar).toBe(path);
    const [detail] = await bia.rpc<Row>('get_suggestion', { p_id: id });
    expect(detail.author_avatar).toBe(path);
    const [comment] = await bia.rpc<Row>('list_comments', { p_suggestion_id: id });
    expect(comment.author_avatar).toBe(path);
    const ranking = await bia.rpc<Row>('get_ranking');
    expect(ranking.find((r) => r.user_name === 'Ana')?.user_avatar).toBe(path);
    const [{ get_weekly_ranking: weekly }] = await bia.rpc<{ get_weekly_ranking: { entries: Row[] } }>('get_weekly_ranking');
    expect(weekly.entries[0].user_avatar).toBe(path);

    await ana.rpc('set_my_avatar', { p_path: null });
    const [cleared] = await bia.rpc<Row>('get_suggestion', { p_id: id });
    expect(cleared.author_avatar).toBeNull();
  });

  it('só aceita arquivo na própria pasta, com formato válido', async () => {
    const ana = await t.createUser('Ana');
    const bia = await t.createUser('Bia');
    for (const p of [`${bia.id}/foto.webp`, `${ana.id}/../x.webp`, `${ana.id}/foto.gif`, 'foto.webp']) {
      expect((await errorOf(ana.rpc('set_my_avatar', { p_path: p }))).code, p).toBe('HV422');
    }
    expect((await errorOf(ana.sql(`update public.profiles set avatar_path = null where id = $1`, [ana.id]))).code).toBe('42501');
  });

  it('o Storage só deixa enviar e apagar na própria pasta, e só com conta ativa', async () => {
    const ana = await t.createUser('Ana');
    const bia = await t.createUser('Bia');
    await upload(ana, `${ana.id}/a.webp`);
    expect((await errorOf(upload(ana, `${bia.id}/intrusa.webp`))).code).toBe('42501');
    expect((await errorOf(t.anon.sql(`insert into storage.objects (bucket_id, name) values ('avatars', 'x/y.webp')`))).code).toBe('42501');

    const deleted = await bia.sql(`delete from storage.objects where name = $1 returning name`, [`${ana.id}/a.webp`]);
    expect(deleted).toEqual([]);
    expect(await ana.sql(`delete from storage.objects where name = $1 returning name`, [`${ana.id}/a.webp`])).toHaveLength(1);

    await admin.rpc('admin_update_user', { p_user_id: bia.id, p_role: 'user', p_status: 'disabled' });
    expect((await errorOf(upload(bia, `${bia.id}/b.webp`))).code).toBe('42501');
  });
});

describe('Moderação de fotos', () => {
  it('administrador remove a foto de qualquer pessoa, apaga o arquivo e registra na auditoria', async () => {
    const ana = await t.createUser('Ana');
    const bia = await t.createUser('Bia');
    const path = `${ana.id}/foto.webp`;
    await ana.sql(`insert into storage.objects (bucket_id, name, owner) values ('avatars', $1, $2)`, [path, ana.id]);
    await ana.rpc('set_my_avatar', { p_path: path });

    expect((await errorOf(bia.rpc('admin_remove_avatar', { p_user_id: ana.id }))).code).toBe('HV403');
    expect(await bia.sql(`delete from storage.objects where name = $1 returning name`, [path])).toEqual([]);

    const [{ admin_remove_avatar: old }] = await admin.rpc<{ admin_remove_avatar: string }>('admin_remove_avatar', { p_user_id: ana.id });
    expect(old).toBe(path);
    expect(await admin.sql(`delete from storage.objects where name = $1 returning name`, [path])).toHaveLength(1);
    const [profile] = await ana.rpc<Row>('get_my_profile');
    expect(profile.avatar_path).toBeNull();

    const [entry] = await admin.rpc<Row>('admin_list_audit_log', { p_entity_type: 'user' });
    expect(entry.action).toBe('user.avatar_remove');
    // Sem foto, não há o que remover nem o que auditar.
    const [{ admin_remove_avatar: again }] = await admin.rpc<{ admin_remove_avatar: string | null }>('admin_remove_avatar', { p_user_id: ana.id });
    expect(again).toBeNull();
  });
});

describe('Fechamento semanal gravado', () => {
  async function lastWeek(actor: Actor) {
    const [{ get_weekly_ranking: w }] = await actor.rpc<{ get_weekly_ranking: Row }>('get_weekly_ranking', { p_weeks_ago: 1 });
    return w as { is_final: boolean; entries: Row[]; me: { rank_position: number | null } };
  }

  it('grava o top da semana encerrada, não muda depois e conta medalhas', async () => {
    const [ana, bia] = [await t.createUser('Ana'), await t.createUser('Bia')];
    const sa = await suggest(ana, 'Ideia da Ana');
    const sb = await suggest(bia, 'Ideia da Bia');
    const pool = await voters(3);
    for (const v of pool) await vote(v, sa);
    await vote(pool[0], sb);
    await t.raw(`update public.votes set created_at = (select week_start from private.ranking_week(1)) + interval '2 days'`);

    expect((await lastWeek(ana)).is_final).toBe(false);
    expect((await errorOf(t.raw(`select private.close_ranking_week(0)`))).code).toBe('HV422');
    const [{ n }] = await t.raw<{ n: number }>(`select private.close_ranking_week(1) as n`);
    expect(n).toBe(2);
    const [{ n: again }] = await t.raw<{ n: number }>(`select private.close_ranking_week(1) as n`);
    expect(again).toBe(0);

    // Excluir a sugestão da Ana depois do fechamento não altera o pódio gravado.
    await ana.rpc('delete_suggestion', { p_id: sa });
    const closed = await lastWeek(bia);
    expect(closed.is_final).toBe(true);
    expect(closed.entries.map((r) => [r.rank_position, r.user_name, Number(r.score)])).toEqual([
      [1, 'Ana', 1.5],
      [2, 'Bia', 0.5],
    ]);
    expect(closed.me.rank_position).toBe(2);

    const [{ medals }] = await t.raw<{ medals: Row }>(`select private.user_medals($1) as medals`, [ana.id]);
    expect(medals).toEqual({ gold: 1, silver: 0, bronze: 0 });
  });

  it('a tabela de fechamentos não é acessível diretamente', async () => {
    const ana = await t.createUser('Ana');
    expect((await errorOf(ana.sql(`select * from public.weekly_results`))).code).toBe('42501');
    expect((await errorOf(ana.sql(`select private.close_ranking_week(1)`))).code).toBe('42501');
  });
});

describe('Notificações', () => {
  const list = (actor: Actor) => actor.rpc<Row>('list_my_notifications');
  const unread = async (actor: Actor) =>
    Number((await actor.rpc<{ count_unread_notifications: number }>('count_unread_notifications'))[0].count_unread_notifications);

  it('avisa o autor de votos e comentários agrupando por sugestão, sem avisar a própria pessoa', async () => {
    const ana = await t.createUser('Ana');
    const id = await suggest(ana, 'Ideia notificada');
    const [bia, caio] = await voters(2);
    await vote(bia, id);
    await vote(caio, id);
    await vote(caio, id, false);
    await vote(caio, id);
    await bia.rpc('create_comment', { p_suggestion_id: id, p_content: 'Gostei' });
    await ana.rpc('create_comment', { p_suggestion_id: id, p_content: 'Obrigada!' });

    const items = await list(ana);
    expect(items.map((n) => [n.kind, n.event_count, n.suggestion_title, n.is_read])).toEqual([
      ['comment', 1, 'Ideia notificada', false],
      ['vote', 2, 'Ideia notificada', false],
    ]);
    expect(items[1].actor_name).toBe('Votante 2');
    expect(await unread(ana)).toBe(2);
    expect(await list(bia)).toEqual([]);

    // Depois de lida, um novo voto abre outra notificação.
    await ana.rpc('mark_notifications_read', { p_ids: [items[1].id] });
    expect(await unread(ana)).toBe(1);
    const [dani] = await voters(1, 'Dani');
    await vote(dani, id);
    expect((await list(ana)).filter((n) => n.kind === 'vote').map((n) => [n.event_count, n.is_read])).toEqual([
      [1, false],
      [2, true],
    ]);
    await ana.rpc('mark_notifications_read');
    expect(await unread(ana)).toBe(0);
  });

  it('avisa mudança de status feita pela administração e pódio da semana', async () => {
    const ana = await t.createUser('Ana');
    const id = await suggest(ana, 'Ideia com status');
    await admin.rpc('set_suggestion_status', { p_id: id, p_status: 'planejado' });
    const [status] = await list(ana);
    expect(status.kind).toBe('status');
    expect(status.data).toMatchObject({ previous_status: 'em_analise', new_status: 'planejado' });
    expect(status.actor_name).toBe('Admin Hubvision');

    const [v] = await voters(1);
    await vote(v, id);
    await t.raw(`update public.votes set created_at = (select week_start from private.ranking_week(1)) + interval '1 day'`);
    await t.raw(`select private.close_ranking_week(1)`);
    const podium = (await list(ana)).find((n) => n.kind === 'podium');
    expect(podium?.data).toMatchObject({ rank_position: 1 });
  });

  it('cada um só vê e marca as próprias notificações', async () => {
    const ana = await t.createUser('Ana');
    const bia = await t.createUser('Bia');
    await vote(bia, await suggest(ana, 'Ideia privada'));
    const [mine] = await list(ana);
    await bia.rpc('mark_notifications_read', { p_ids: [mine.id] });
    expect(await unread(ana)).toBe(1);
    expect((await errorOf(bia.sql(`select * from public.notifications`))).code).toBe('42501');
    expect((await errorOf(t.anon.rpc('count_unread_notifications'))).code).toBe('42501');
  });
});

describe('Perfil público', () => {
  it('mostra posição, pontos, medalhas e sugestões da pessoa, sem e-mail', async () => {
    const ana = await t.createUser('Ana', { email: 'ana@exemplo.test' });
    const bia = await t.createUser('Bia');
    const a1 = await suggest(ana, 'Primeira ideia da Ana');
    const a2 = await suggest(ana, 'Segunda ideia da Ana');
    await vote(bia, a1);
    await t.raw(`update public.votes set created_at = (select week_start from private.ranking_week(1)) + interval '1 day'`);
    await t.raw(`select private.close_ranking_week(1)`);
    await vote(bia, a2);

    const [{ get_public_profile: p }] = await bia.rpc<{ get_public_profile: Row }>('get_public_profile', { p_user_id: ana.id });
    expect(p).toMatchObject({
      id: ana.id,
      name: 'Ana',
      is_me: false,
      rank_position: 1,
      score: 1,
      votes_received: 2,
      weekly_rank_position: 1,
      weekly_score: 0.5,
      suggestion_count: 2,
      medals: { gold: 1, silver: 0, bronze: 0 },
    });
    expect(JSON.stringify(p)).not.toContain('exemplo.test');

    const list = await bia.rpc<Row>('list_user_suggestions', { p_user_id: ana.id });
    expect(list.map((s) => [s.title, Number(s.vote_count)])).toEqual([
      ['Segunda ideia da Ana', 1],
      ['Primeira ideia da Ana', 1],
    ]);

    // Autores e comentários levam o id para o link do perfil.
    const [card] = await bia.rpc<Row>('list_suggestions', { p_project_id: projectId, p_search: 'Primeira' });
    expect(card.author_id).toBe(ana.id);
    await bia.rpc('create_comment', { p_suggestion_id: a1, p_content: 'Boa!' });
    const [comment] = await ana.rpc<Row>('list_comments', { p_suggestion_id: a1 });
    expect(comment.author_id).toBe(bia.id);

    const [{ get_public_profile: mine }] = await bia.rpc<{ get_public_profile: Row }>('get_public_profile', { p_user_id: bia.id });
    expect(mine).toMatchObject({ is_me: true, rank_position: null, score: 0, suggestion_count: 0 });
  });

  it('conta desativada ou inexistente não tem perfil público', async () => {
    const ana = await t.createUser('Ana');
    const bia = await t.createUser('Bia');
    await admin.rpc('admin_update_user', { p_user_id: ana.id, p_role: 'user', p_status: 'disabled' });
    expect((await errorOf(bia.rpc('get_public_profile', { p_user_id: ana.id }))).code).toBe('HV404');
    expect((await errorOf(bia.rpc('list_user_suggestions', { p_user_id: ana.id }))).code).toBe('HV404');
    expect((await errorOf(bia.rpc('get_public_profile', { p_user_id: '00000000-0000-0000-0000-000000000000' }))).code).toBe('HV404');
  });
});

describe('Busca', () => {
  it('encontra em todos os projetos exigindo todas as palavras, ignorando maiúsculas e excluídas', async () => {
    const ana = await t.createUser('Ana');
    const [row] = await admin.rpc<{ create_project: string }>('create_project', {
      p_name: 'Portal de Chamados',
      p_description: 'Atendimento interno da Hubvision.',
      p_category: 'Atendimento',
      p_status: 'em_desenvolvimento',
    });
    const outro = row.create_project;
    const a = await suggest(ana, 'Exportar relatório em PDF');
    const [{ create_suggestion: b }] = await ana.rpc<{ create_suggestion: string }>('create_suggestion', {
      p_project_id: outro,
      p_type: 'melhoria',
      p_title: 'Notificar por e-mail',
      p_description: 'Enviar o relatório do chamado por e-mail ao solicitante.',
    });
    const gone = await suggest(ana, 'Relatório antigo removido');
    await ana.rpc('delete_suggestion', { p_id: gone });

    const search = async (args: Record<string, unknown>) => (await ana.rpc<Row>('search_suggestions', args)).map((s) => s.id);
    // Título vem antes de descrição; a excluída nunca aparece.
    expect(await search({ p_search: 'RELATÓRIO' })).toEqual([a, b]);
    expect(await search({ p_search: 'relatório e-mail' })).toEqual([b]);
    expect(await search({ p_search: 'relatório', p_project_id: outro })).toEqual([b]);
    expect(await search({ p_search: 'pdf planilha', p_match_any: true })).toEqual([a]);
    expect(await search({ p_search: 'de a' })).toEqual([]);
    const [first] = await ana.rpc<Row>('search_suggestions', { p_search: 'relatório' });
    expect(first).toMatchObject({ project_name: 'Templates de consultas SQL', author_name: 'Ana' });
    expect((await errorOf(t.anon.rpc('search_suggestions', { p_search: 'pdf' }))).code).toBe('42501');
  });
});

describe('Privacidade (LGPD)', () => {
  it('exporta os próprios dados, incluindo e-mail, e só os de quem pede', async () => {
    const ana = await t.createUser('Ana', { email: 'ana@exemplo.test' });
    const bia = await t.createUser('Bia');
    const id = await suggest(ana, 'Ideia exportada');
    await vote(bia, id);
    await bia.rpc('create_comment', { p_suggestion_id: id, p_content: 'Comentário da Bia' });

    const [{ export_my_data: data }] = await ana.rpc<{ export_my_data: Row }>('export_my_data');
    const d = data as { profile: Row; suggestions: Row[]; comments: Row[]; votes_given: Row[]; notifications: Row[] };
    expect(d.profile).toMatchObject({ name: 'Ana', email: 'ana@exemplo.test' });
    expect(d.suggestions.map((s) => [s.title, s.votes_received])).toEqual([['Ideia exportada', 1]]);
    expect(d.comments).toEqual([]);
    expect(d.notifications.length).toBe(2);
    const [{ export_my_data: other }] = await bia.rpc<{ export_my_data: Row }>('export_my_data');
    expect((other as { votes_given: Row[] }).votes_given.map((v) => v.suggestion)).toEqual(['Ideia exportada']);
    expect((await errorOf(t.anon.rpc('export_my_data'))).code).toBe('42501');
  });

  it('excluir a conta apaga login, votos e foto, anonimiza o perfil e mantém as sugestões', async () => {
    const ana = await t.createUser('Ana', { email: 'ana@exemplo.test' });
    const bia = await t.createUser('Bia');
    const sa = await suggest(ana, 'Ideia que fica');
    const sb = await suggest(bia, 'Ideia da Bia');
    await vote(bia, sa);
    await vote(ana, sb);
    await ana.rpc('create_comment', { p_suggestion_id: sb, p_content: 'Comentário que some' });
    const path = `${ana.id}/foto.webp`;
    await ana.sql(`insert into storage.objects (bucket_id, name, owner) values ('avatars', $1, $2)`, [path, ana.id]);
    await ana.rpc('set_my_avatar', { p_path: path });

    const [{ delete_my_account: old }] = await ana.rpc<{ delete_my_account: string }>('delete_my_account');
    expect(old).toBe(path);
    // O token ainda vale alguns minutos: dá para apagar a própria foto logo depois.
    expect(await ana.sql(`delete from storage.objects where name = $1 returning name`, [path])).toHaveLength(1);

    expect(await t.raw(`select 1 from auth.users where id = $1`, [ana.id])).toEqual([]);
    expect(await t.raw(`select 1 from public.votes where user_id = $1`, [ana.id])).toEqual([]);
    const [profile] = await t.raw<Row>(`select name, status, avatar_path, deleted_at from public.profiles where id = $1`, [ana.id]);
    expect(profile).toMatchObject({ name: 'Participante removido', status: 'disabled', avatar_path: null });
    expect(profile.deleted_at).not.toBeNull();

    const [kept] = await bia.rpc<Row>('get_suggestion', { p_id: sa });
    expect(kept.author_name).toBe('Participante removido');
    const [comment] = await bia.rpc<Row>('list_comments', { p_suggestion_id: sb });
    expect([comment.is_deleted, comment.content, comment.author_name]).toEqual([true, null, null]);
    expect((await bia.rpc<Row>('get_ranking')).map((r) => r.user_name)).toEqual(['Bia']);
    expect((await errorOf(bia.rpc('get_public_profile', { p_user_id: ana.id }))).code).toBe('HV404');
    expect(Number((await bia.rpc<Row>('get_suggestion', { p_id: sb }))[0].vote_count)).toBe(0);
  });

  it('o único administrador não exclui a própria conta', async () => {
    expect((await errorOf(admin.rpc('delete_my_account'))).code).toBe('HV409');
    const outro = await t.createUser('Outro admin');
    await admin.rpc('admin_update_user', { p_user_id: outro.id, p_role: 'admin', p_status: 'active' });
    await admin.rpc('delete_my_account');
    expect(await t.raw(`select 1 from auth.users where id = $1`, [admin.id])).toEqual([]);
  });

  it('fotos só podem ser lidas por contas ativas', async () => {
    const ana = await t.createUser('Ana');
    const bia = await t.createUser('Bia');
    await ana.sql(`insert into storage.objects (bucket_id, name, owner) values ('avatars', $1, $2)`, [`${ana.id}/a.webp`, ana.id]);
    const [bucket] = await t.raw<Row>(`select public from storage.buckets where id = 'avatars'`);
    expect(bucket.public).toBe(false);
    expect(await bia.sql(`select name from storage.objects where bucket_id = 'avatars'`)).toHaveLength(1);
    expect((await errorOf(t.anon.sql(`select name from storage.objects`))).code).toBe('42501');
    await admin.rpc('admin_update_user', { p_user_id: bia.id, p_role: 'user', p_status: 'disabled' });
    expect(await bia.sql(`select name from storage.objects where bucket_id = 'avatars'`)).toEqual([]);
  });
});

describe('Convites', () => {
  it('só administrador prepara convites, com e-mail válido e sem conta ativa', async () => {
    const ana = await t.createUser('Ana', { email: 'ana@exemplo.test' });
    expect((await errorOf(ana.rpc('admin_prepare_invite', { p_email: 'novo@exemplo.test' }))).code).toBe('HV403');
    for (const bad of ['', 'sem-arroba', 'a@b', 'com espaco@x.test']) {
      expect((await errorOf(admin.rpc('admin_prepare_invite', { p_email: bad }))).code, bad).toBe('HV422');
    }
    expect((await errorOf(admin.rpc('admin_prepare_invite', { p_email: ' ANA@exemplo.test ' }))).code).toBe('HV409');
    const [{ admin_prepare_invite: email }] = await admin.rpc<{ admin_prepare_invite: string }>('admin_prepare_invite', {
      p_email: '  Novo@Exemplo.test ',
    });
    expect(email).toBe('novo@exemplo.test');
  });

  it('convite pendente pode ser reenviado, aparece na lista e fica na auditoria', async () => {
    // O que a Edge Function faz com a chave de administrador: cria o usuário convidado.
    const id = '11111111-1111-4111-8111-111111111111';
    await t.raw(
      `insert into auth.users (id, email, raw_user_meta_data, invited_at) values ($1, 'convidado@exemplo.test', '{"name":"Convidado Novo"}', now())`,
      [id],
    );
    const [{ admin_prepare_invite: again }] = await admin.rpc<{ admin_prepare_invite: string }>('admin_prepare_invite', {
      p_email: 'convidado@exemplo.test',
    });
    expect(again).toBe('convidado@exemplo.test');

    const [{ admin_record_invite: recorded }] = await admin.rpc<{ admin_record_invite: string }>('admin_record_invite', {
      p_email: 'convidado@exemplo.test',
    });
    expect(recorded).toBe(id);
    const [entry] = await admin.rpc<Row>('admin_list_audit_log', { p_entity_type: 'user' });
    expect([entry.action, (entry.new_value as Row).name]).toEqual(['user.invite', 'Convidado Novo']);

    const users = await admin.rpc<Row>('admin_list_users', { p_search: 'convidado' });
    expect(users.map((u) => [u.name, u.invite_pending])).toEqual([['Convidado Novo', true]]);

    // Depois de aceitar, o convite deixa de estar pendente e não pode ser reenviado.
    await t.raw(`update auth.users set email_confirmed_at = now() where id = $1`, [id]);
    expect((await admin.rpc<Row>('admin_list_users', { p_search: 'convidado' }))[0].invite_pending).toBe(false);
    expect((await errorOf(admin.rpc('admin_prepare_invite', { p_email: 'convidado@exemplo.test' }))).code).toBe('HV409');
    expect((await errorOf(admin.rpc('admin_record_invite', { p_email: 'ninguem@exemplo.test' }))).code).toBe('HV404');
  });
});
