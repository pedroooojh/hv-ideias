// =============================================================================
// Dados de demonstração do emulador local — SOMENTE DESENVOLVIMENTO.
// Nunca aplicar em produção. Os dados são criados chamando as mesmas funções RPC
// usadas pelo app, então passam pelas mesmas validações e regras.
//
// Contas criadas (todas com a senha DEMO_PASSWORD abaixo):
//   admin@hv-ideias.test  → administrador
//   carlos@, mariana@, rafael@, ana@, bruno@, camila@, diego@, elisa@ hv-ideias.test → usuários
// =============================================================================

export const DEMO_PASSWORD = 'hv-demo-local-2026';

const USERS = [
  ['admin', 'Equipe Hubvision', true],
  ['carlos', 'Carlos E.'],
  ['mariana', 'Mariana S.'],
  ['rafael', 'Rafael T.'],
  ['ana', 'Ana P.'],
  ['bruno', 'Bruno L.'],
  ['camila', 'Camila R.'],
  ['diego', 'Diego M.'],
  ['elisa', 'Elisa F.'],
];

export async function seedDemoData({ db, createUser, handleRpc }) {
  console.log('[emulador] criando dados de demonstração…');
  const users = {};
  for (const [key, name, admin] of USERS) {
    const row = await createUser(`${key}@hv-ideias.test`, DEMO_PASSWORD, name);
    if (admin) await db.query(`update public.profiles set role = 'admin' where id = $1`, [row.id]);
    users[key] = { sub: row.id, role: 'authenticated' };
  }

  const call = async (who, fn, args) => {
    const result = await handleRpc(fn, args, users[who]);
    if (result.status !== 200) throw new Error(`${fn} falhou: ${JSON.stringify(result.body)}`);
    return result.body;
  };

  const sql = await call('admin', 'create_project', {
    p_name: 'Templates de consultas SQL / Relatórios Funcionais',
    p_category: 'SQL & Relatórios',
    p_status: 'em_desenvolvimento',
    p_description:
      'Como evolução da ferramenta de consulta SQL já disponível no pacote Protheus desenvolvido pela Hubvision, sugerimos a criação de uma funcionalidade para salvar consultas como templates reutilizáveis.',
  });
  const portal = await call('admin', 'create_project', {
    p_name: 'Portal de Chamados',
    p_category: 'Helpdesk & Suporte',
    p_status: 'em_desenvolvimento',
    p_description:
      'Plataforma unificada para abertura, triagem automatizada e acompanhamento do status de chamados técnicos internos e externos.',
  });
  const elo = await call('admin', 'create_project', {
    p_name: 'ELO',
    p_category: 'Integração API',
    p_status: 'planejado',
    p_description:
      'Ferramenta para gestão de conexão centralizada entre plataformas, orquestração de webhooks e controle de credenciais seguras de APIs.',
  });

  const suggest = (who, project, type, title, description) =>
    call(who, 'create_suggestion', { p_project_id: project, p_type: type, p_title: title, p_description: description });

  const s1 = await suggest(
    'carlos', sql, 'melhoria', 'Melhoria da ferramenta consulta SQL - dev relatorios',
    'Como evolução da ferramenta de consulta SQL já disponível no pacote Protheus desenvolvido pela Hubvision, sugiro a criação de uma funcionalidade para salvar consultas como templates reutilizáveis. A ideia seria permitir a criação de uma biblioteca de consultas padronizadas, que possam funcionar como relatórios funcionais para os clientes, evitando que cada analista reescreva as mesmas consultas.\n\nOs templates poderiam ter parâmetros, versionamento e permissões por perfil, além de um catálogo pesquisável.',
  );
  const s2 = await suggest(
    'mariana', sql, 'nova_funcionalidade', 'Exportação direta dos relatórios gerados para XLSX e PDF formatado',
    'Permitir que os usuários definam cabeçalho corporativo e exportem os resultados de consultas complexas diretamente em PDF ou Excel com colunas ajustadas automaticamente.',
  );
  const s3 = await suggest(
    'rafael', sql, 'melhoria', 'Parâmetros dinâmicos com autocomplete para campos de data e filial',
    'Facilitar a inserção de tag `:data_ini` e `:data_fim` apresentando um seletor visual em vez de obrigar digitação de string manual.',
  );
  const s4 = await suggest(
    'ana', portal, 'nova_funcionalidade', 'Notificar o solicitante por e-mail quando o chamado mudar de status',
    'Hoje é preciso entrar no portal para saber se o chamado andou. Um e-mail automático a cada mudança de status reduziria as ligações para o suporte.',
  );
  const s5 = await suggest(
    'bruno', portal, 'melhoria', 'Anexar prints colando direto da área de transferência',
    'Permitir Ctrl+V de imagens no formulário de abertura do chamado, sem precisar salvar o arquivo antes.',
  );
  const s6 = await suggest(
    'carlos', elo, 'nova_funcionalidade', 'Integração SSO & Webhooks',
    'Autenticação única com o provedor corporativo e disparo de webhooks configuráveis por evento para os sistemas integrados.',
  );
  await suggest(
    'carlos', elo, 'melhoria', 'Painel de saúde das integrações',
    'Exibir em um painel o status de cada conexão, a última sincronização bem-sucedida e os erros recentes.',
  );

  const vote = (who, suggestion) => call(who, 'set_vote', { p_suggestion_id: suggestion, p_vote: true });
  for (const who of ['mariana', 'rafael', 'ana', 'bruno', 'camila', 'diego']) await vote(who, s1);
  for (const who of ['carlos', 'ana', 'elisa']) await vote(who, s2);
  for (const who of ['carlos', 'mariana']) await vote(who, s3);
  for (const who of ['carlos', 'mariana', 'rafael', 'bruno', 'elisa']) await vote(who, s4);
  for (const who of ['ana']) await vote(who, s5);
  for (const who of ['mariana', 'rafael', 'ana', 'bruno']) await vote(who, s6);

  await call('admin', 'set_suggestion_status', { p_id: s2, p_status: 'planejado', p_reason: null });
  await call('admin', 'set_suggestion_status', { p_id: s6, p_status: 'em_desenvolvimento', p_reason: null });
  await call('admin', 'set_suggestion_status', {
    p_id: s5, p_status: 'nao_aprovado', p_reason: 'O navegador já permite arrastar arquivos; vamos priorizar outras melhorias do formulário.',
  });

  const comment = (who, suggestion, content) => call(who, 'create_comment', { p_suggestion_id: suggestion, p_content: content });
  await comment('mariana', s1, 'Isso ajudaria muito o time de implantação. Hoje cada cliente tem uma cópia diferente da mesma consulta.');
  await comment('rafael', s1, 'Seria ótimo ter versionamento, para saber quem alterou o template e quando.');
  await comment('carlos', s1, 'Concordo! Coloquei o versionamento na descrição.');
  await comment('ana', s2, 'O PDF com o cabeçalho da empresa resolveria a maior parte dos pedidos dos clientes.');

  console.log('[emulador] dados de demonstração criados (contas em scripts/local/seed.mjs).');
}
