// =============================================================================
// Dados de demonstração do MÊS PASSADO no emulador local — SOMENTE DESENVOLVIMENTO.
// Cria sugestões, votos e uma seleção datados no mês anterior e grava o campeão
// desse mês, para ver o "Campeão do mês" no ranking sem esperar a virada do mês.
//
// Uso (com o emulador PARADO, depois de ele ter rodado com --seed ao menos uma vez):
//   node scripts/local/demo-last-month.mjs
// =============================================================================

import { createConnection } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.local-supabase');

const emulatorRunning = await new Promise((resolve) => {
  const socket = createConnection({ port: 54321, host: '127.0.0.1' });
  socket.once('connect', () => (socket.destroy(), resolve(true)));
  socket.once('error', () => resolve(false));
});
if (emulatorRunning) {
  console.error('[mês passado] pare o emulador antes (o banco local só aceita uma conexão).');
  process.exit(1);
}

const db = new PGlite(DATA_DIR);
const one = async (sql, params) => (await db.query(sql, params)).rows[0];

const { month_start: monthStart } = await one(`select month_start from private.ranking_month(1)`);
if (await one(`select 1 from public.monthly_results where month_start = $1`, [monthStart])) {
  console.log('[mês passado] o campeão desse mês já está gravado; nada a fazer.');
  process.exit(0);
}

const users = {};
for (const row of (await db.query(`select id, split_part(email, '@', 1) as key from auth.users where email like '%@hv-ideias.test'`)).rows) {
  users[row.key] = row.id;
}
const project = async (name) => (await one(`select id from public.projects where name = $1`, [name]))?.id;
const projects = {
  sql: await project('Templates de consultas SQL / Relatórios Funcionais'),
  portal: await project('Portal de Chamados'),
  elo: await project('ELO'),
};
if (!users.admin || !users.mariana || Object.values(projects).some((id) => !id)) {
  console.error('[mês passado] dados de demonstração não encontrados: rode o emulador com --seed primeiro.');
  process.exit(1);
}

// Dia e hora dentro do mês passado (horário de Brasília, como o ranking).
const at = (day, hour = 10) => `(select month_start from private.ranking_month(1)) + interval '${day - 1} days ${hour} hours'`;

const SUGGESTIONS = [
  {
    author: 'mariana', project: 'portal', type: 'nova_funcionalidade', day: 3,
    title: 'Base de conhecimento com artigos sugeridos ao abrir o chamado',
    description:
      'Enquanto a pessoa descreve o problema, o portal mostra artigos da base de conhecimento parecidos. Muitos chamados repetidos se resolveriam antes mesmo de chegar ao suporte.',
    votes: ['carlos', 'rafael', 'ana', 'bruno', 'camila', 'diego', 'elisa'],
    selectedDay: 12,
  },
  {
    author: 'mariana', project: 'sql', type: 'melhoria', day: 15,
    title: 'Agendar a execução de consultas e enviar o resultado por e-mail',
    description:
      'Permitir agendar uma consulta salva (diária, semanal ou mensal) e enviar o resultado em planilha para uma lista de e-mails, sem ninguém precisar rodar manualmente.',
    votes: ['rafael', 'ana', 'diego', 'elisa'],
  },
  {
    author: 'rafael', project: 'elo', type: 'melhoria', day: 8,
    title: 'Reprocessar webhooks que falharam com um clique',
    description: 'Listar as entregas de webhook com erro e permitir reenviar uma ou várias de uma vez, com o histórico de tentativas.',
    votes: ['carlos', 'mariana', 'bruno', 'camila'],
  },
  {
    author: 'ana', project: 'portal', type: 'melhoria', day: 20,
    title: 'Filtro por prioridade e SLA na fila de chamados',
    description: 'Na fila do suporte, filtrar e ordenar por prioridade e pelo tempo que falta para estourar o SLA.',
    votes: ['mariana', 'diego'],
  },
  {
    author: 'diego', project: 'sql', type: 'nova_funcionalidade', day: 25,
    title: 'Comparar o resultado de duas consultas lado a lado',
    description: 'Rodar duas versões de uma consulta e destacar as linhas que mudaram, para validar ajustes antes de publicar o template.',
    votes: ['ana'],
  },
];

await db.transaction(async (tx) => {
  // Sem gatilhos: os dados chegam já com as datas do mês passado e sem notificações de votos antigos.
  await tx.exec(`set local session_replication_role = replica`);
  for (const s of SUGGESTIONS) {
    const selected = s.selectedDay !== undefined;
    const { rows } = await tx.query(
      `insert into public.suggestions
         (project_id, author_id, type, title, description, status, status_changed_at, selected_at, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6,
               ${selected ? at(s.selectedDay, 15) : 'null'}, ${selected ? at(s.selectedDay, 15) : 'null'},
               ${at(s.day)}, ${at(s.day)})
       returning id`,
      [projects[s.project], users[s.author], s.type, s.title, s.description, selected ? 'planejado' : 'em_analise'],
    );
    const id = rows[0].id;
    for (const [i, voter] of s.votes.entries()) {
      await tx.query(`insert into public.votes (user_id, suggestion_id, created_at) values ($1, $2, ${at(s.day + Math.min(i, 6), 11 + i)})`, [
        users[voter],
        id,
      ]);
    }
    if (selected) {
      await tx.query(
        `insert into public.suggestion_status_history (suggestion_id, actor_id, previous_status, new_status, created_at)
         values ($1, $2, 'em_analise', 'planejado', ${at(s.selectedDay, 15)})`,
        [id, users.admin],
      );
    }
  }
});

// Fechamento do mês como o pg_cron faz no dia 1º (grava o campeão e o notifica).
await db.query(`select private.close_ranking_month(1)`);
const champion = await one(`select user_name, score from public.monthly_results where month_start = $1`, [monthStart]);
console.log(`[mês passado] campeão gravado: ${champion.user_name} (${champion.score} pts).`);
await db.close();
