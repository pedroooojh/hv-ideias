# Templates de e-mail do Supabase Auth

Gerados por `node scripts/email-templates.mjs` (não edite os .html à mão).

No painel do Supabase (Authentication → Emails), cole cada arquivo no template correspondente e use o assunto da tabela.

| Template no painel | Arquivo | Assunto |
|---|---|---|
| Confirm sign up | `confirmation.html` | Confirme seu e-mail no Hubvision Ideias |
| Invite user | `invite.html` | Você foi convidado para o Hubvision Ideias |
| Magic link or OTP | `magic_link.html` | Seu acesso ao Hubvision Ideias |
| Change email address | `email_change.html` | Confirme a troca de e-mail no Hubvision Ideias |
| Reset password | `recovery.html` | Redefina sua senha do Hubvision Ideias |
| Reauthentication | `reauthentication.html` | Seu código de verificação do Hubvision Ideias |

Os links levam para `{{ .SiteURL }}/auth/confirm`, então o **Site URL** do projeto precisa ser o endereço publicado do app.
