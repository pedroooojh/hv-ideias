import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'supabase', 'migrations');

const SUPABASE_STUB = readFileSync(join(__dirname, '..', '..', 'scripts', 'local', 'supabase-stub.sql'), 'utf8');

export type Row = Record<string, unknown>;

export interface Actor {
  id: string | null;
  /** Chama uma função RPC do schema public com argumentos nomeados, como o PostgREST faz. */
  rpc<T = Row>(fn: string, args?: Record<string, unknown>): Promise<T[]>;
  /** Executa SQL arbitrário com o papel e o JWT deste ator (simula acesso direto às tabelas). */
  sql<T = Row>(query: string, params?: unknown[]): Promise<T[]>;
}

export interface TestDb {
  db: PGlite;
  createUser(name: string, opts?: { admin?: boolean; email?: string }): Promise<Actor>;
  anon: Actor;
  /** Consulta como superusuário (fora das regras da API), para inspecionar o estado real. */
  raw<T = Row>(query: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }

  // PGlite tem uma única conexão: serializamos as chamadas para que a troca de
  // papel/JWT de um ator nunca vaze para a consulta de outro.
  let queue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(task: () => Promise<T>): Promise<T> => {
    const next = queue.then(task, task);
    queue = next.catch(() => undefined);
    return next;
  };

  const runAs = <T>(id: string | null, role: 'anon' | 'authenticated', query: string, params: unknown[]) =>
    serialize(async () => {
      const claims = JSON.stringify(id ? { sub: id, role } : { role });
      await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims]);
      await db.exec(`set role ${role}`);
      try {
        const res = await db.query<T>(query, params);
        return res.rows;
      } finally {
        await db.exec('reset role');
        await db.query(`select set_config('request.jwt.claims', '', false)`);
      }
    });

  const makeActor = (id: string | null): Actor => {
    const role = id ? 'authenticated' : 'anon';
    return {
      id,
      rpc: (fn, args = {}) => {
        if (!/^[a-z_]+$/.test(fn)) throw new Error(`Nome de função inválido: ${fn}`);
        const keys = Object.keys(args);
        const named = keys.map((k, i) => `${k} => $${i + 1}`).join(', ');
        return runAs(id, role, `select * from public.${fn}(${named})`, keys.map((k) => args[k]));
      },
      sql: (query, params = []) => runAs(id, role, query, params),
    };
  };

  const raw = <T>(query: string, params: unknown[] = []) =>
    serialize(async () => (await db.query<T>(query, params)).rows);

  return {
    db,
    anon: makeActor(null),
    raw,
    async createUser(name, opts = {}) {
      const id = randomUUID();
      const email = opts.email ?? `${id.slice(0, 8)}@exemplo.test`;
      await raw(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
        id,
        email,
        JSON.stringify({ name }),
      ]);
      if (opts.admin) await raw(`update public.profiles set role = 'admin' where id = $1`, [id]);
      return makeActor(id);
    },
    close: () => db.close(),
  };
}

/** Captura o erro de uma promessa para verificar o código SQLSTATE. */
export async function errorOf(promise: Promise<unknown>): Promise<{ code?: string; message: string }> {
  try {
    await promise;
  } catch (err) {
    const e = err as { code?: string; message: string };
    return { code: e.code, message: e.message };
  }
  throw new Error('Era esperado que a operação falhasse, mas ela foi concluída.');
}
