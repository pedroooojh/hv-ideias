#!/usr/bin/env node
// =============================================================================
// Emulador local do Supabase — SOMENTE PARA DESENVOLVIMENTO E TESTES MANUAIS.
//
// Roda as migrações reais (supabase/migrations) em Postgres embutido (PGlite) e
// expõe o subconjunto da API do Supabase que o frontend usa:
//   * /auth/v1  — cadastro, login, refresh, usuário atual, logout (e-mail/senha)
//   * /rest/v1/rpc/<função> — chamadas RPC com os papéis anon/authenticated
//
// Serve para validar a aplicação sem Docker e sem um projeto Supabase. Não é um
// substituto do Supabase em produção: não envia e-mails, não tem OAuth, não tem
// limites de taxa do Auth e guarda os dados em ./.local-supabase.
//
// Uso:  node scripts/local/server.mjs [--reset] [--seed] [--port 54321]
// =============================================================================

import http from 'node:http';
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { seedDemoData } from './seed.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA_DIR = join(ROOT, '.local-supabase');
const args = process.argv.slice(2);
const PORT = Number(args.includes('--port') ? args[args.indexOf('--port') + 1] : 54321);
const ACCESS_TOKEN_TTL = 3600;
const MIN_PASSWORD = 8;

if (args.includes('--reset') && existsSync(DATA_DIR)) {
  rmSync(DATA_DIR, { recursive: true, force: true });
  console.log('[emulador] banco local apagado (--reset)');
}

const db = new PGlite(DATA_DIR);

// PGlite tem uma única conexão: todas as operações passam por esta fila para
// que papel/JWT de uma requisição nunca vazem para outra.
let queue = Promise.resolve();
function serialize(task) {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
}

const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');

async function bootstrap() {
  const { rows } = await db.query(`select to_regclass('auth.users') is not null as ready`);
  const fresh = !rows[0].ready;
  if (fresh) {
    console.log('[emulador] criando banco…');
    await db.exec(readFileSync(join(ROOT, 'scripts', 'local', 'supabase-stub.sql'), 'utf8'));
    // Tabelas exclusivas do emulador (credenciais, sessões e migrações aplicadas), fora do schema exposto.
    await db.exec(`
      create schema emulator;
      create table emulator.meta (key text primary key, value text not null);
      create table emulator.credentials (
        user_id uuid primary key references auth.users (id) on delete cascade,
        password_hash text not null
      );
      create table emulator.refresh_tokens (
        token text primary key,
        user_id uuid not null references auth.users (id) on delete cascade,
        created_at timestamptz not null default now()
      );
      revoke all on schema emulator from public;
    `);
    await db.query(`insert into emulator.meta values ('jwt_secret', $1)`, [randomBytes(32).toString('hex')]);
  }
  await applyPendingMigrations(fresh);
  return fresh;
}

// Aplica, em ordem, as migrações que este banco local ainda não recebeu
// (como o `supabase db push` faz no projeto real).
async function applyPendingMigrations(fresh) {
  const { rows } = await db.query(`select to_regclass('emulator.migrations') is not null as tracked`);
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  if (!rows[0].tracked) {
    await db.exec(`create table emulator.migrations (name text primary key, applied_at timestamptz not null default now())`);
    if (!fresh) {
      // Banco criado antes do controle de migrações: as duas iniciais já estavam aplicadas.
      for (const name of ['20261014120000_schema.sql', '20261014120100_api.sql']) {
        await db.query(`insert into emulator.migrations (name) values ($1)`, [name]);
      }
    }
  }
  const applied = new Set((await db.query(`select name from emulator.migrations`)).rows.map((r) => r.name));
  for (const file of files.filter((f) => !applied.has(f))) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
    await db.query(`insert into emulator.migrations (name) values ($1)`, [file]);
    console.log(`[emulador]   ✓ migração ${file}`);
  }
}

// ---------------------------------------------------------------------------
// Senhas e JWT
// ---------------------------------------------------------------------------

function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [saltHex, hashHex] = stored.split(':');
  const hash = scryptSync(password, Buffer.from(saltHex, 'hex'), 32);
  return timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

let jwtSecret = '';
const b64url = (input) => Buffer.from(input).toString('base64url');

function signJwt(payload) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', jwtSecret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyJwt(token) {
  const parts = (token ?? '').split('.');
  if (parts.length !== 3) return null;
  const expected = createHmac('sha256', jwtSecret).update(`${parts[0]}.${parts[1]}`).digest('base64url');
  if (expected.length !== parts[2].length || !timingSafeEqual(Buffer.from(expected), Buffer.from(parts[2]))) return null;
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function userJson(row) {
  const created = new Date(row.created_at).toISOString();
  return {
    id: row.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: row.email,
    email_confirmed_at: created,
    confirmed_at: created,
    phone: '',
    last_sign_in_at: new Date().toISOString(),
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: row.raw_user_meta_data ?? {},
    identities: [],
    created_at: created,
    updated_at: created,
  };
}

async function issueSession(userRow) {
  const now = Math.floor(Date.now() / 1000);
  const access = signJwt({
    sub: userRow.id,
    email: userRow.email,
    role: 'authenticated',
    aud: 'authenticated',
    iat: now,
    exp: now + ACCESS_TOKEN_TTL,
    session_id: randomUUID(),
  });
  const refresh = randomBytes(24).toString('hex');
  await db.query(`insert into emulator.refresh_tokens (token, user_id) values ($1, $2)`, [refresh, userRow.id]);
  return {
    access_token: access,
    token_type: 'bearer',
    expires_in: ACCESS_TOKEN_TTL,
    expires_at: now + ACCESS_TOKEN_TTL,
    refresh_token: refresh,
    user: userJson(userRow),
  };
}

const authError = (status, code, msg) => ({ status, body: { code: status, error_code: code, msg, message: msg } });

async function findUserByEmail(email) {
  const { rows } = await db.query(`select * from auth.users where lower(email) = lower($1)`, [email]);
  return rows[0];
}

/** Cria usuário com senha (usado pelo cadastro e pelo seed). */
export async function createUser(email, password, name) {
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
    id,
    email.toLowerCase(),
    JSON.stringify({ name }),
  ]);
  await db.query(`insert into emulator.credentials (user_id, password_hash) values ($1, $2)`, [id, hashPassword(password)]);
  const { rows } = await db.query(`select * from auth.users where id = $1`, [id]);
  return rows[0];
}

async function handleAuth(method, path, query, body, claims) {
  if (method === 'POST' && path === '/signup') {
    const email = String(body.email ?? '').trim();
    const password = String(body.password ?? '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return authError(400, 'validation_failed', 'Unable to validate email address: invalid format');
    if (password.length < MIN_PASSWORD) return authError(422, 'weak_password', `Password should be at least ${MIN_PASSWORD} characters.`);
    if (await findUserByEmail(email)) return authError(422, 'user_already_exists', 'User already registered');
    const user = await createUser(email, password, String(body.data?.name ?? ''));
    return { status: 200, body: await issueSession(user) };
  }

  if (method === 'POST' && path === '/token') {
    if (query.get('grant_type') === 'password') {
      const user = await findUserByEmail(String(body.email ?? ''));
      const cred = user && (await db.query(`select password_hash from emulator.credentials where user_id = $1`, [user.id])).rows[0];
      if (!cred || !verifyPassword(String(body.password ?? ''), cred.password_hash)) {
        return { status: 400, body: { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials' } };
      }
      return { status: 200, body: await issueSession(user) };
    }
    if (query.get('grant_type') === 'refresh_token') {
      const { rows } = await db.query(
        `delete from emulator.refresh_tokens where token = $1 returning user_id`,
        [String(body.refresh_token ?? '')],
      );
      if (!rows[0]) return authError(400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
      const user = (await db.query(`select * from auth.users where id = $1`, [rows[0].user_id])).rows[0];
      return { status: 200, body: await issueSession(user) };
    }
    return authError(400, 'unsupported_grant_type', 'unsupported grant type');
  }

  if (path === '/user') {
    if (!claims) return authError(401, 'no_authorization', 'This endpoint requires a valid Bearer token');
    if (method === 'PUT') {
      if (body.password !== undefined) {
        if (String(body.password).length < MIN_PASSWORD) return authError(422, 'weak_password', `Password should be at least ${MIN_PASSWORD} characters.`);
        await db.query(`update emulator.credentials set password_hash = $2 where user_id = $1`, [claims.sub, hashPassword(String(body.password))]);
      }
    }
    const user = (await db.query(`select * from auth.users where id = $1`, [claims.sub])).rows[0];
    if (!user) return authError(404, 'user_not_found', 'User not found');
    return { status: 200, body: userJson(user) };
  }

  if (method === 'POST' && path === '/logout') {
    if (claims) await db.query(`delete from emulator.refresh_tokens where user_id = $1`, [claims.sub]);
    return { status: 204, body: null };
  }

  if (method === 'POST' && path === '/recover') {
    console.log(`[emulador] recuperação de senha solicitada para ${body.email} (o emulador não envia e-mails)`);
    return { status: 200, body: {} };
  }

  return authError(404, 'not_found', 'Rota de autenticação não suportada pelo emulador');
}

// ---------------------------------------------------------------------------
// RPC (equivalente ao PostgREST para POST /rest/v1/rpc/<fn>)
// ---------------------------------------------------------------------------

async function handleRpc(fn, body, claims) {
  if (!/^[a-z_]+$/.test(fn)) return { status: 404, body: { code: 'PGRST202', message: 'Função não encontrada' } };
  const { rows: procs } = await db.query(
    `select p.proretset, t.typname
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       join pg_type t on t.oid = p.prorettype
      where n.nspname = 'public' and p.proname = $1`,
    [fn],
  );
  if (procs.length === 0) return { status: 404, body: { code: 'PGRST202', message: `Could not find the function public.${fn}` } };

  const keys = Object.keys(body ?? {});
  if (keys.some((k) => !/^p_[a-z_]+$/.test(k))) return { status: 400, body: { code: 'PGRST100', message: 'Parâmetro inválido' } };
  const named = keys.map((k, i) => `${k} => $${i + 1}`).join(', ');
  const params = keys.map((k) => body[k]);
  const { proretset, typname } = procs[0];
  const sql = proretset
    ? `select coalesce(json_agg(t), '[]'::json) as r from public.${fn}(${named}) t`
    : typname === 'void'
      ? `select null::json as r from public.${fn}(${named})`
      : `select to_json(public.${fn}(${named})) as r`;

  const role = claims ? 'authenticated' : 'anon';
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims ?? { role: 'anon' })]);
  await db.exec(`set role ${role}`);
  try {
    const { rows } = await db.query(sql, params);
    return { status: 200, body: rows[0]?.r ?? null };
  } catch (err) {
    const code = err.code ?? 'XX000';
    const status = code === '42501' ? (claims ? 403 : 401) : code.startsWith('HV') || code.startsWith('22') || code.startsWith('23') || code === 'P0001' ? 400 : 500;
    if (status === 500) console.error('[emulador] erro interno', err);
    return { status, body: { code, message: status === 500 ? 'Erro interno' : err.message, details: err.detail ?? null, hint: err.hint ?? null } };
  } finally {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claims', '', false)`);
  }
}

// ---------------------------------------------------------------------------
// Servidor HTTP
// ---------------------------------------------------------------------------

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, apikey, content-type, x-client-info, accept-profile, content-profile, prefer, x-supabase-api-version, x-retry-count',
};

function send(res, status, body) {
  res.writeHead(status, { ...CORS, ...(body === null ? {} : { 'Content-Type': 'application/json; charset=utf-8' }) });
  res.end(body === null ? undefined : JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, null);
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let body;
  try {
    body = await readBody(req);
  } catch {
    return send(res, 400, { code: 'PGRST102', message: 'JSON inválido' });
  }
  const bearer = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const claims = verifyJwt(bearer);

  try {
    const result = await serialize(async () => {
      if (url.pathname.startsWith('/auth/v1')) {
        return handleAuth(req.method, url.pathname.slice('/auth/v1'.length), url.searchParams, body, claims);
      }
      const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/([^/]+)$/);
      if (rpc && req.method === 'POST') return handleRpc(rpc[1], body, claims);
      return { status: 404, body: { message: 'Rota não suportada pelo emulador (apenas /auth/v1 e /rest/v1/rpc).' } };
    });
    if (process.env.EMULATOR_LOG) console.log(`${req.method} ${url.pathname} → ${result.status}`);
    send(res, result.status, result.body);
  } catch (err) {
    console.error('[emulador] falha inesperada', err);
    send(res, 500, { message: 'Erro interno do emulador' });
  }
});

const fresh = await serialize(bootstrap);
jwtSecret = (await db.query(`select value from emulator.meta where key = 'jwt_secret'`)).rows[0].value;
if (args.includes('--seed')) {
  const { rows } = await db.query(`select count(*)::int as n from public.projects`);
  if (rows[0].n === 0) {
    await serialize(() => seedDemoData({ db, createUser, handleRpc, issueSession }));
  } else {
    console.log('[emulador] --seed ignorado: o banco já possui projetos (use --reset --seed para recriar).');
  }
}
server.listen(PORT, () => {
  console.log(`[emulador] Supabase local em http://localhost:${PORT}${fresh ? ' (banco novo)' : ''}`);
  console.log('[emulador] apenas para desenvolvimento — dados em ./.local-supabase');
});
