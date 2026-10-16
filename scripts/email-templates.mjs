#!/usr/bin/env node
// =============================================================================
// Gera os templates de e-mail do Supabase Auth (supabase/templates/*.html) a
// partir de um layout único com a identidade do Hubvision Ideias.
//
// Uso:  node scripts/email-templates.mjs            → grava os templates
//       node scripts/email-templates.mjs --preview  → também gera previews com
//                                                      dados de exemplo em dist-emails/
//
// Os links não usam {{ .ConfirmationURL }}: apontam para /auth/confirm no
// próprio site com o token ({{ .TokenHash }}). A validação acontece no
// navegador, então o antivírus do e-mail (que abre os links antes da pessoa)
// não consome o token, e cada fluxo segue para a tela certa (ConfirmPage.tsx).
// =============================================================================

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FONT = "'Segoe UI', Roboto, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const C = {
  page: '#f4f1ee',
  card: '#ffffff',
  ink: '#1b2333',
  muted: '#5c6575',
  soft: '#8a919e',
  line: '#e5e2de',
  subtle: '#f1f3f6',
  brand: '#2350c8',
  navy: '#24408f',
};

const link = (type, next) =>
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=${type}&amp;next=${encodeURIComponent(next)}`;

const p = (html) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${C.muted};">${html}</p>`;

const button = (href, label) => `
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 24px;">
              <tr>
                <td style="border-radius:12px;background-color:${C.brand};">
                  <a href="${href}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:15px;font-weight:700;line-height:1;color:#ffffff;text-decoration:none;border-radius:12px;">${label}</a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 4px;font-size:12px;line-height:1.5;color:${C.soft};">Se o botão não funcionar, copie e cole este endereço no navegador:</p>
            <p style="margin:0 0 24px;font-size:12px;line-height:1.5;word-break:break-all;"><a href="${href}" target="_blank" style="color:${C.brand};text-decoration:underline;">${href}</a></p>`;

const code = (value) => `
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
              <tr>
                <td style="border-radius:12px;background-color:${C.subtle};border:1px solid ${C.line};padding:16px 28px;font-family:Consolas, 'Courier New', monospace;font-size:30px;font-weight:700;letter-spacing:8px;color:${C.ink};">${value}</td>
              </tr>
            </table>`;

const note = (html) => `
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 0;">
              <tr>
                <td style="border-radius:12px;background-color:${C.subtle};padding:14px 16px;font-size:13px;line-height:1.55;color:${C.muted};">${html}</td>
              </tr>
            </table>`;

function layout({ title, preheader, heading, body, reason }) {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light only" />
    <meta name="supported-color-schemes" content="light" />
    <title>${title}</title>
  </head>
  <body style="margin:0;padding:0;background-color:${C.page};">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preheader}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.page};">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;font-family:${FONT};">
            <tr>
              <td style="background-color:${C.navy};background-image:linear-gradient(135deg, ${C.navy} 0%, ${C.ink} 100%);border-radius:16px 16px 0 0;padding:24px 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="vertical-align:middle;">
                      <img src="{{ .SiteURL }}/simbolo-hv-branco.png" width="40" height="40" alt="Hubvision" style="display:block;border:0;outline:none;" />
                    </td>
                    <td style="vertical-align:middle;padding-left:14px;font-family:${FONT};">
                      <div style="font-size:18px;font-weight:700;line-height:1.2;color:#ffffff;">Hubvision Ideias</div>
                      <div style="font-size:12px;line-height:1.4;color:#c7d2fe;">Painel de melhorias e ideias de produto</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="background-color:${C.card};border-radius:0 0 16px 16px;padding:36px 32px 32px;font-family:${FONT};">
                <h1 style="margin:0 0 16px;font-size:24px;line-height:1.3;font-weight:700;color:${C.ink};">${heading}</h1>
${body}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 24px 0;text-align:center;font-family:${FONT};font-size:12px;line-height:1.6;color:${C.soft};">
                ${reason}<br />
                Hubvision Inovação e Negócios · <a href="{{ .SiteURL }}" target="_blank" style="color:${C.soft};text-decoration:underline;">Hubvision Ideias</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;
}

const IGNORE = 'Se não foi você, pode ignorar este e-mail com segurança: nada muda na sua conta.';

// Nome do arquivo = nome do template no config.toml ([auth.email.template.<nome>]).
const TEMPLATES = {
  confirmation: {
    dashboard: 'Confirm sign up',
    subject: 'Confirme seu e-mail no Hubvision Ideias',
    title: 'Confirme seu e-mail',
    preheader: 'Falta só um clique para você começar a sugerir e votar em ideias.',
    heading: 'Confirme seu e-mail',
    body: [
      p('Que bom ter você no <strong style="color:' + C.ink + ';">Hubvision Ideias</strong>! Para ativar sua conta e começar a sugerir melhorias, votar e comentar nas ideias dos projetos, confirme que este e-mail é seu.'),
      button(link('email', '/'), 'Confirmar meu e-mail'),
      note('O link vale por 24 horas e só pode ser usado uma vez.'),
    ].join(''),
    reason: `Você recebeu este e-mail porque alguém se cadastrou no Hubvision Ideias com {{ .Email }}. ${IGNORE}`,
  },
  invite: {
    dashboard: 'Invite user',
    subject: 'Você foi convidado para o Hubvision Ideias',
    title: 'Convite para o Hubvision Ideias',
    preheader: 'Crie sua senha e comece a participar do painel de ideias da Hubvision.',
    heading: 'Você foi convidado!',
    body: [
      p('A equipe Hubvision convidou você para o <strong style="color:' + C.ink + ';">Hubvision Ideias</strong>, o espaço onde sugerimos melhorias para os nossos produtos, votamos nas melhores ideias e acompanhamos o que entra em desenvolvimento.'),
      p('Para aceitar, crie sua senha de acesso:'),
      button(link('invite', '/redefinir-senha?convite=1'), 'Aceitar convite e criar senha'),
      note('O convite vale por 24 horas. Se expirar, peça um novo à administração da plataforma.'),
    ].join(''),
    reason: `Você recebeu este e-mail porque {{ .Email }} foi convidado para o Hubvision Ideias. Se não esperava este convite, pode ignorá-lo.`,
  },
  magic_link: {
    dashboard: 'Magic link or OTP',
    subject: 'Seu acesso ao Hubvision Ideias',
    title: 'Seu link de acesso',
    preheader: 'Use o link ou o código para entrar no Hubvision Ideias sem senha.',
    heading: 'Entre no Hubvision Ideias',
    body: [
      p('Recebemos um pedido para entrar na sua conta sem senha. Use o botão abaixo:'),
      button(link('email', '/'), 'Entrar na plataforma'),
      p('Ou, se preferir, digite este código na tela de login:'),
      code('{{ .Token }}'),
      note('O link e o código valem por poucos minutos e só podem ser usados uma vez.'),
    ].join(''),
    reason: `Você recebeu este e-mail porque alguém pediu acesso à conta {{ .Email }}. ${IGNORE}`,
  },
  email_change: {
    dashboard: 'Change email address',
    subject: 'Confirme a troca de e-mail no Hubvision Ideias',
    title: 'Confirme a troca de e-mail',
    preheader: 'Confirme para trocar o e-mail da sua conta no Hubvision Ideias.',
    heading: 'Confirme a troca de e-mail',
    body: [
      p('Recebemos um pedido para trocar o e-mail da sua conta no Hubvision Ideias:'),
      `
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 8px;">
              <tr>
                <td style="padding:10px 0;border-top:1px solid ${C.line};font-size:13px;color:${C.soft};width:90px;">De</td>
                <td style="padding:10px 0;border-top:1px solid ${C.line};font-size:15px;font-weight:600;color:${C.ink};word-break:break-all;">{{ .Email }}</td>
              </tr>
              <tr>
                <td style="padding:10px 0;border-top:1px solid ${C.line};border-bottom:1px solid ${C.line};font-size:13px;color:${C.soft};">Para</td>
                <td style="padding:10px 0;border-top:1px solid ${C.line};border-bottom:1px solid ${C.line};font-size:15px;font-weight:600;color:${C.ink};word-break:break-all;">{{ .NewEmail }}</td>
              </tr>
            </table>`,
      button(link('email_change', '/perfil'), 'Confirmar troca de e-mail'),
      note('Por segurança, enviamos esta confirmação para os dois endereços. A troca só vale depois que os dois forem confirmados.'),
    ].join(''),
    reason: `Você recebeu este e-mail porque foi pedida a troca do e-mail de uma conta do Hubvision Ideias. Se não foi você, ignore este e-mail e troque sua senha.`,
  },
  recovery: {
    dashboard: 'Reset password',
    subject: 'Redefina sua senha do Hubvision Ideias',
    title: 'Redefina sua senha',
    preheader: 'Use o link para criar uma nova senha de acesso.',
    heading: 'Redefina sua senha',
    body: [
      p('Recebemos um pedido para redefinir a senha da sua conta no Hubvision Ideias. Clique no botão abaixo para escolher uma nova senha:'),
      button(link('recovery', '/redefinir-senha'), 'Criar nova senha'),
      note('O link vale por 1 hora e só pode ser usado uma vez. Sua senha atual continua valendo até você criar a nova.'),
    ].join(''),
    reason: `Você recebeu este e-mail porque foi pedida a redefinição de senha da conta {{ .Email }}. ${IGNORE}`,
  },
  reauthentication: {
    dashboard: 'Reauthentication',
    subject: 'Seu código de verificação do Hubvision Ideias',
    title: 'Código de verificação',
    preheader: 'Use este código para confirmar uma ação na sua conta.',
    heading: 'Confirme que é você',
    body: [
      p('Para continuar uma ação sensível na sua conta (como trocar a senha), digite este código na plataforma:'),
      code('{{ .Token }}'),
      note('O código vale por poucos minutos e só pode ser usado uma vez. Nunca compartilhe este código com ninguém, nem com a equipe Hubvision.'),
    ].join(''),
    reason: `Você recebeu este e-mail porque uma ação na conta {{ .Email }} pediu confirmação. Se não foi você, troque sua senha.`,
  },
};

const outDir = join(ROOT, 'supabase', 'templates');
mkdirSync(outDir, { recursive: true });
for (const [name, t] of Object.entries(TEMPLATES)) {
  writeFileSync(join(outDir, `${name}.html`), layout(t));
}
writeFileSync(
  join(outDir, 'ASSUNTOS.md'),
  `# Templates de e-mail do Supabase Auth\n\nGerados por \`node scripts/email-templates.mjs\` (não edite os .html à mão).\n\n` +
    `No painel do Supabase (Authentication → Emails), cole cada arquivo no template correspondente e use o assunto da tabela.\n\n` +
    `| Template no painel | Arquivo | Assunto |\n|---|---|---|\n` +
    Object.entries(TEMPLATES)
      .map(([name, t]) => `| ${t.dashboard} | \`${name}.html\` | ${t.subject} |`)
      .join('\n') +
    `\n\nOs links levam para \`{{ .SiteURL }}/auth/confirm\`, então o **Site URL** do projeto precisa ser o endereço publicado do app.\n`,
);
console.log(`[templates] ${Object.keys(TEMPLATES).length} templates gravados em supabase/templates/`);

if (process.argv.includes('--preview')) {
  const sample = {
    '{{ .SiteURL }}': 'https://hv-ideias.vercel.app',
    '{{ .TokenHash }}': 'pkce_exemplo123',
    '{{ .Token }}': '482913',
    '{{ .Email }}': 'ana.paula@hubvision.com.br',
    '{{ .NewEmail }}': 'ana@hubvision.com.br',
  };
  const previewDir = join(ROOT, 'dist-emails');
  mkdirSync(previewDir, { recursive: true });
  const cards = [];
  for (const [name, t] of Object.entries(TEMPLATES)) {
    let html = layout(t);
    for (const [k, v] of Object.entries(sample)) html = html.split(k).join(v);
    writeFileSync(join(previewDir, `${name}.html`), html);
    cards.push(`<section><h2>${t.dashboard} — <small>${t.subject}</small></h2><iframe src="${name}.html"></iframe></section>`);
  }
  writeFileSync(
    join(previewDir, 'index.html'),
    `<!doctype html><meta charset="utf-8"><title>Prévia dos e-mails</title><style>body{font-family:system-ui;background:#ddd;margin:0;padding:24px;display:grid;gap:24px;grid-template-columns:repeat(auto-fill,minmax(620px,1fr))}h2{font-size:15px;margin:0 0 8px}small{font-weight:400;color:#555}iframe{width:100%;height:760px;border:0;border-radius:12px;background:#fff}</style>${cards.join('')}`,
  );
  console.log('[templates] prévias em dist-emails/index.html');
}
