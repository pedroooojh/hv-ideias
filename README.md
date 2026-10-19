# hv-ideias — Plataforma de ideias e melhorias da Hubvision

Fórum interno onde usuários sugerem melhorias e novas funcionalidades para os projetos da Hubvision, votam nas ideias de outras pessoas, comentam e acumulam pontos em um ranking. Administradores gerenciam projetos, status das sugestões, contas e moderação.

## Stack

| Camada | Tecnologia |
| --- | --- |
| Frontend | Vite + React 18 + TypeScript + Tailwind CSS 3, React Router, TanStack Query |
| Backend | Supabase: Postgres com RLS, funções RPC (`SECURITY DEFINER`) e Supabase Auth (e-mail/senha) |
| Testes | Vitest. As regras de negócio rodam contra o **schema real** em Postgres embutido ([PGlite](https://pglite.dev)) |

É a mesma base dos outros projetos da Hubvision (Portal de Chamados, SprintFlow, Hora Point).

## Estrutura

```
supabase/
  migrations/
    20261014120000_schema.sql   tabelas, restrições, triggers, RLS, view de pontuação
    20261014120100_api.sql      todas as funções RPC (leitura, escrita, votos, ranking, admin)
  config.toml                   configuração do Supabase CLI
src/
  lib/          cliente Supabase, API tipada (api.ts), erros, formatação, domínio (status, limites)
  auth/         AuthProvider (sessão + perfil)
  components/   layout, cartões, formulários, votação, comentários, diálogos
  pages/        início, projetos, projeto, sugestão, ranking, perfil, admin, login, diretrizes
tests/db/       testes das regras críticas contra o schema real (cenários A–I)
scripts/local/  emulador local do Supabase (somente desenvolvimento) + dados de demonstração
```

## Como rodar

### Opção 1: com um projeto Supabase (uso real)

1. Crie um projeto no [Supabase](https://supabase.com) (Postgres 17).
2. Aplique as migrações (as duas criam o schema completo, do zero; como o banco ainda não existe, não há migrações de correção):
   ```bash
   supabase login
   supabase link --project-ref SEU_PROJECT_REF
   supabase db push
   ```
3. Configure o frontend: copie `.env.example` para `.env.local` e preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (Project Settings → API). **Nunca** use a `service_role` key em variáveis `VITE_*`.
4. No painel do Supabase (Authentication → URL Configuration), defina o **Site URL** e adicione `https://SEU-DOMINIO/redefinir-senha` em **Redirect URLs**.
5. Rode o app:
   ```bash
   npm install
   npm run dev
   ```
6. Crie sua conta pela tela "Entrar" e promova o primeiro administrador no SQL Editor (por segurança, o papel nunca vem do cadastro):
   ```sql
   update public.profiles set role = 'admin'
   where id = (select id from auth.users where email = 'voce@hubvision.com.br');
   ```
   Depois disso, os demais administradores são promovidos em **Gestão da plataforma → Usuários** (cartão "Sugestões" da página inicial ou link no perfil).

### Visão do administrador

A página inicial é a tela principal do administrador. Os cartões **Projetos**, **Sugestões** e **Votos** viram atalhos de gestão: *Projetos* abre o cadastro de projeto; *Sugestões* abre a **Gestão da plataforma** (`/admin`), com a fila de sugestões de todos os projetos — por padrão as que aguardam análise, com troca de status —, a gestão de contas e a auditoria; *Votos* abre o ranking. Cada cartão de projeto tem a engrenagem para editar ou excluir. Usuários comuns veem a mesma página sem esses cartões e sem as engrenagens.

### Projeto conectado

O repositório está vinculado ao projeto Supabase **hv-ideias** (`ksecprrlkwxiinmermbd`). Confira com `supabase migration list` quais migrações já estão aplicadas e o `.env.local` (fora do git) aponta para ele com a chave pública. Para rodar contra o banco real: `npm run dev` (http://localhost:5173).

- Auth: Site URL `http://localhost:5173` e redirecionamento `http://localhost:5173/redefinir-senha`. Ao publicar o site, troque pelas URLs de produção (Authentication → URL Configuration).
- Confirmação de e-mail ligada. O SMTP padrão da Supabase só entrega para membros da organização e tem limite baixo de envios; para outros usuários, configure um SMTP próprio.
- `supabase/config.toml` reflete as configurações do projeto. **Antes de qualquer `supabase config push`, rode `supabase config diff --project-ref ksecprrlkwxiinmermbd`** e confira que só muda o que você quer: o push aplica todas as diferenças.

### Opção 2: emulador local (sem Docker e sem projeto Supabase)

Para desenvolvimento e testes manuais, `scripts/local/server.mjs` emula as rotas do Supabase que o app usa (`/auth/v1`, `/rest/v1/rpc` e o Storage das fotos, com links assinados e as mesmas políticas de acesso), aplicando **as mesmas migrações** num Postgres embutido. Não é um substituto de produção: não envia e-mails (a troca de e-mail é imediata), só tem login por e-mail/senha, não tem pg_cron (fecha a semana e o mês do ranking ao iniciar e de hora em hora) e guarda os dados em `./.local-supabase`.

Em dois terminais:

```bash
npm run emulador
```

```bash
npm run dev:emulador
```

`npm run emulador` cria dados de demonstração quando o banco está vazio (3 projetos, sugestões, votos e comentários, criados pelas próprias RPCs). As contas de teste e a senha estão em [scripts/local/seed.mjs](scripts/local/seed.mjs). Para recriar do zero, use `npm run emulador:reset`. Para ver a revelação do campeão do mês sem esperar a virada do mês, pare o emulador e rode `node scripts/local/demo-last-month.mjs`: ele cria sugestões e votos datados no mês passado e grava o campeão.

Na tela de login, o modo emulador mostra o bloco **Ambiente local de demonstração**, com os botões *Administrador* e *Usuário comum*. Eles fazem login de verdade no emulador com as contas de teste. O bloco só aparece quando `VITE_DEMO_LOGIN`/`VITE_DEMO_PASSWORD` estão definidos ([.env.emulator](.env.emulator)) **e** o Supabase configurado é `localhost`; no build de produção o código e as credenciais de teste não existem.

## Comandos

| Comando | O que faz |
| --- | --- |
| `npm run dev` | App em modo desenvolvimento (usa `.env.local`) |
| `npm run dev:emulador` | App apontando para o emulador local (`.env.emulator`) |
| `npm run emulador` / `emulador:reset` | Sobe o emulador local (com dados de demonstração) |
| `npm test` | Todos os testes (regras do banco + utilitários do frontend) |
| `npm run typecheck` | Verificação de tipos |
| `npm run build` | Build de produção em `dist/` |

Hospedagem: é uma SPA estática. O arquivo `public/_redirects` faz o fallback de rotas no Netlify; em outro host, configure a regra equivalente (todas as rotas → `index.html`).

## Regras de negócio

**Votos**
- Só existem votos positivos. Cada usuário pode dar no máximo um voto por sugestão (restrição `unique (user_id, suggestion_id)`).
- O autor não pode votar na própria sugestão (bloqueado na RPC **e** por trigger no banco).
- O voto pode ser retirado. A API recebe o estado desejado (`set_vote(id, true|false)`), não um "toggle": cliques repetidos ou requisições simultâneas não duplicam nem invertem o voto.
- Novos votos só são aceitos com status *Em análise*, *Planejado* ou *Em desenvolvimento*, em projeto não arquivado. Retirar o voto é sempre permitido.

**Pontuação**
- Para o autor da sugestão: **0,5 ponto** por sugestão publicada e **1 ponto** por voto positivo válido recebido.
- Ideia **selecionada** pela administração (status *Planejado*, *Em desenvolvimento* ou *Implementado*): os pontos dela dobram. No momento da seleção o autor recebe de novo o que a sugestão já tinha, e cada voto seguinte vale 2. Voltar para *Em análise* ou *Não aprovado* tira o dobro; uma nova seleção conta a nova data (`suggestions.selected_at`, mantida por trigger).
- Cada ponto tem data (publicação, voto ou seleção) e entra na semana e no mês dessa data. Tudo é calculado a partir dos dados armazenados (view `private.score_events`, regras em `private.points_per_suggestion()` e `private.points_per_vote()`). Não existe campo de pontos editável.
- Não geram pontos: comentar, votos retirados, sugestões excluídas e sugestões de projetos excluídos.
- Classificação por pontos; desempate por mais votos recebidos no período, depois quem chegou primeiro à pontuação. Exibe nome público e foto (com link para o perfil público), nunca e-mail. Contas desativadas não aparecem.

**Ranking semanal**
- A semana vai de sábado 00:00 a sexta 23:59 (horário de Brasília) e conta só os pontos ganhos nela.
- Na sexta, o botão RANKING abre o pódio do fechamento (com animação) e o modal abre sozinho uma vez no dia.
- No sábado 00:05 o `pg_cron` grava o top 10 da semana em `weekly_results`; semanas encerradas passam a vir do registro gravado (não mudam mais) e o top 3 vira medalha no perfil e notificação.

**Ranking mensal (o que vale prêmio)**
- O mês do calendário (horário de Brasília) substitui o antigo ranking geral acumulado: a página `/ranking` e a aba "Este mês" mostram a classificação parcial do mês.
- No dia 1º 00:05 o `pg_cron` grava em `monthly_results` **só o campeão** do mês que terminou (sem pódio); ele recebe notificação, ganha o título "Campeão do mês" no perfil e entra na galeria de campeões. No dia 1º o modal abre sozinho com a revelação do campeão.
- Embaixo do campeão aparecem os **"Quase lá"** (2º ao 5º do mês, com a distância até o 1º). Não são gravados: vêm calculados pela mesma regra (`get_monthly_runners_up`) e nunca repetem o campeão gravado.

**Perfil, fotos e notificações**
- Perfil público em `/pessoas/:id`: posição e pontos no mês, pontos na semana, títulos de campeão, medalhas e sugestões da pessoa.
- Foto de perfil enquadrada no navegador e reduzida para 256×256; fica no bucket **privado** `avatars` e só contas ativas a veem (links assinados de 1 hora). Administradores removem fotos impróprias (com auditoria).
- Notificações no app (sininho): votos e comentários nas suas ideias (agrupados por sugestão), mudanças de status, pódio da semana e campeão do mês. São geradas por triggers.
- Busca em todos os projetos (botão de lupa ou Ctrl+K) e aviso de ideias parecidas ao escrever uma sugestão nova.

**Sugestões**
- O autor edita e exclui a própria sugestão apenas enquanto ela está *Em análise*. Depois disso, só a administração.
- A exclusão é lógica (`deleted_at`): a sugestão some das listagens e do ranking, mas os registros são preservados.
- Status: *Em análise → Planejado → Em desenvolvimento → Implementado*, ou *Não aprovado* (com justificativa obrigatória, exibida aos usuários). Toda mudança fica no histórico da sugestão e na auditoria.

**Comentários**
- Autor edita (marcado como "editado") e exclui os próprios comentários. Administradores moderam por remoção, sem reescrever o texto de outra pessoa.
- Comentários removidos continuam na conversa como marcador ("removido pelo autor/pela moderação"), para não quebrar o contexto.

**Projetos** (somente administradores)
- Status: *Em avaliação, Planejado, Em desenvolvimento, Concluído, Arquivado*. Projeto arquivado continua visível, mas não recebe sugestões, votos nem comentários.
- A exclusão é lógica. Se houver sugestões ativas, o banco exige confirmação explícita e a interface informa quantas sugestões serão ocultadas.

**Indicadores da página inicial** (definidos em `get_platform_stats`)
- *Projetos ativos*: não excluídos e não arquivados. *Sugestões*: não excluídas, de projetos não excluídos. *Votos computados*: votos válidos nessas sugestões. *Em desenvolvimento*: sugestões com esse status. *Novos votos hoje / em 7 dias*: votos válidos criados nas últimas 24 h / 7 dias.

**Acesso**
- **Todas as telas exigem login**, exceto `/entrar` (login, cadastro e recuperação de senha) e `/redefinir-senha` (destino do link enviado por e-mail). Quem não está logado é levado para `/entrar` e, depois de entrar, volta para a página que tentou abrir.
- `/admin` (Gestão da plataforma) é exclusiva de administradores. Usuários comuns veem "Acesso restrito".
- Conta desativada não acessa nenhuma tela: aparece só o aviso de conta desativada e o botão de sair.
- A mesma regra vale no banco: o papel `anon` (sem login) não executa nenhuma função nem lê nenhuma tabela, e uma conta desativada também perde a leitura. As telas apenas refletem isso.

## Interface

- **Escala e largura:** o tamanho base acompanha a resolução (100% no celular, 93,75% no tablet e, no desktop, proporcional à largura da tela: ~14px em 1440px, ~17px em 1920px). Cabeçalho, início e rodapé ocupam ~94% da largura; as páginas internas ~78%. O hero da página inicial ocupa exatamente a primeira tela.
- **Tipografia:** Poppins nos títulos (`h1`–`h6`, títulos de cartões e números de destaque, classe `font-display`), pelas formas arredondadas que aproximam o leitor; Lato no texto corrido (descrições, comentários, formulários, botões), para leitura sem fadiga. O peso 800 da Poppins fica só no título do hero.
- **Transição:** `animate-fade-in` (opacidade 0→1, 0,3s, ease-out), a mesma do SprintFlow, em páginas, listas carregadas, itens novos, erros de formulário, edição inline e trocas de conteúdo. Modais e menus (Radix) usam `animate-presence`: entram com fade-in e saem com fade-out (entrada 0,15s, saída 0,1s); avisos também saem com fade. Desligada para quem pede menos movimento no sistema.
- **Cantos:** cards, modais e avisos com `rounded-xl`/`rounded-lg`; menus com `rounded-lg`.
- **Barra de rolagem:** a da página é desenhada por cima do conteúdo ([OverlayScrollbar.tsx](src/components/OverlayScrollbar.tsx)), na cor da marca, para não cortar os gradientes com a faixa sólida da barra nativa. A rolagem continua nativa (mouse, teclado, toque).
- **Navegação:** toda página (exceto o início e o login) tem o mesmo "Voltar", alinhado ao logo. Ele volta para a página de onde a pessoa realmente veio, dizendo qual é ("Voltar para Ranking"), com filtros e posição de rolagem preservados; aberto por link direto, sobe um nível na hierarquia (Início › Projetos › Projeto › Sugestão). Cada página define o título da aba do navegador. Ver [navigation.tsx](src/lib/navigation.tsx).
- **Filtros:** mesma barra em todas as telas ([Filters.tsx](src/components/Filters.tsx)), numa linha só: abas da dimensão principal à esquerda (contagem só quando > 0; no máximo uma linha de abas por tela) e, à direita, busca, filtros secundários em menu ("Status ▾", que vira "Status: Em análise" quando aplicado, com as contagens dentro do menu), "Ordenar ▾" e a ação principal. O resumo "N resultados · Limpar filtros" só aparece com filtro ativo. O estado fica na URL (`?tipo=…&status=…&busca=…`). Telas: projetos (abas de status, busca), projeto (abas de tipo, busca, status, ordenação), minhas sugestões (status) e gestão — onde já há a linha de seções, os filtros são só busca e menus (sugestões: status, tipo; usuários: situação, perfil; auditoria: tipo de registro).
- **Hierarquia da sugestão:** a sugestão (problemática) no mesmo formato do cartão da listagem, a discussão logo abaixo e o histórico de status por último.
- **Cache entre recargas:** os últimos dados ficam no navegador ([queryCache.ts](src/lib/queryCache.ts)) e as telas abrem na hora; em seguida são atualizados do banco. O cache pertence a um usuário: ao sair ou trocar de conta ele é descartado. A lista de usuários (com e-mails) e a auditoria não são salvas no navegador. Ao mudar o formato dos dados das RPCs, incremente `CACHE_VERSION`.

## Segurança

- **Nada é público e toda escrita passa por RPC.** O papel `anon` não tem acesso a nenhuma tabela ou função; `authenticated` não tem INSERT/UPDATE/DELETE em nenhuma tabela. RLS está habilitado em todas, com políticas só de leitura (defesa em profundidade).
- Cada RPC valida, nesta ordem: autenticação e conta ativa, permissão (papel lido do banco, nunca do cliente), limite de requisições, existência dos registros e dados de entrada. Autor, papel, contagem de votos e pontos nunca vêm do cliente.
- Funções `SECURITY DEFINER` com `search_path = ''` e consultas parametrizadas (sem SQL dinâmico), contra SQL injection. O React escapa todo o conteúdo exibido (não há `dangerouslySetInnerHTML`), contra XSS.
- Limites de requisição no banco: 10 sugestões/hora, 10 comentários/5 min, 60 votos/min por usuário.
- Erros de negócio usam códigos próprios (`HV401`, `HV403`, `HV404`, `HV409`, `HV422`, `HV429`) com mensagens para o usuário final. Qualquer outro erro vira uma mensagem genérica, sem detalhes internos.
- Auditoria (`audit_log`) de criação/edição/exclusão de projetos, edição/exclusão de sugestões por administradores, mudanças de status, moderação de comentários e alterações de contas.
- **Convites:** administradores convidam pessoas por e-mail em Gestão → Usuários → *Convidar pessoa* (ou reenviam um convite pendente). O envio passa pela Edge Function [`admin-invite`](supabase/functions/admin-invite/index.ts), que usa a chave de administrador do Supabase só depois de o banco confirmar, com o token de quem pediu, que é um administrador ativo (`admin_prepare_invite`); o convite fica na auditoria. Publicar a função: `supabase functions deploy admin-invite --use-api`.
- **Acesso à gestão:** o menu da conta (foto no cabeçalho) tem atalhos para Sugestões, Usuários e convites e Auditoria; em telas largas há também o botão de escudo no cabeçalho.
- **Administradores desativam contas** (Gestão da plataforma → Usuários): a pessoa perde a capacidade de publicar, votar e comentar e sai do ranking, mas o conteúdo publicado é preservado.
- **LGPD:** cada pessoa baixa os próprios dados em JSON e pode excluir a conta (com a senha atual). A exclusão apaga o login, os votos dados, as notificações e a foto, marca os comentários como removidos e anonimiza o perfil ("Participante removido"); as sugestões permanecem, sem nome.
- As migrações desligam os privilégios padrão do Supabase no schema `public`: tabelas e funções criadas em migrações futuras não ficam acessíveis até receberem um `grant` explícito.

## Testes

```bash
npm test
```

`tests/db/rules.test.ts` sobe um Postgres real em memória, aplica as migrações e executa as RPCs como usuários diferentes, inclusive tentando acesso direto às tabelas. Cobre os cenários de aceitação:

- **A** cadastro e validação de sugestões
- **B** filtros + ordenação combinados, desempate e paginação
- **C** pontuação, com o exemplo obrigatório: 6 votos = 3 pts, +4 votos = 5 pts, retirar 1 voto = 4,5 pts
- **D** votos duplicados (inclusive simultâneos), autovoto, sugestões inelegíveis, limite de requisições
- **E** permissões: usuário comum vs. administrador, conta desativada, visitante anônimo
- **F** exclusão lógica e seus efeitos no ranking
- **G** status e histórico
- **H** comentários e moderação
- **I** registros inexistentes e projetos arquivados

Também cobre ranking semanal e fechamento gravado, ranking mensal e campeão, dobro da seleção, fotos (Storage e moderação), notificações, perfil público, busca e privacidade (exportar e excluir conta). Em `src/**/__tests__` ficam os testes de interface (modal do ranking, troca de senha, links das fotos, confirmação ao fechar formulários com alterações). Os demais cenários de interface (incluindo **J**, responsividade) foram validados manualmente no navegador com o emulador local.

## Pendências e evolução

- **E-mails do Supabase Auth**: dependem do SMTP configurado no projeto Supabase (o padrão só entrega para membros da organização). Os templates em português com a identidade do app ficam em [supabase/templates](supabase/templates) (gerados por `node scripts/email-templates.mjs`; assuntos em `ASSUNTOS.md`). Os links apontam para `/auth/confirm` no próprio site, que valida o token no navegador: o antivírus do e-mail não consome o link, e o convite leva direto para "Crie sua senha".
- **Restrição de domínio de e-mail**: o cadastro está aberto. Se a plataforma for só para colaboradores, desative "Allow new users to sign up" ou restrinja o domínio com um Auth Hook.
- **Backup**: use os backups diários / Point-in-Time Recovery do plano Supabase. O emulador local não tem backup.
- **Termos de Uso e Privacidade**: não foram publicados (dependem de texto jurídico). O rodapé só tem links para páginas que existem.
- **Categorias** são texto livre no projeto (com sugestões no formulário). **Tipos de sugestão** são uma tabela: para criar um tipo, basta inserir uma linha em `public.suggestion_types`, sem mudar código.
- Evoluções previstas, ainda não implementadas: notificações por e-mail, ranking por projeto, favoritos, tags, relatórios administrativos e integrações internas.
