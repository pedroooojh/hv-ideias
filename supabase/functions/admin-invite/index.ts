// =============================================================================
// Edge Function: convite de novas pessoas pela Gestão da plataforma.
//
// Enviar convite exige a chave de administrador do Supabase (service_role), que
// nunca vai para o navegador. A regra fica no banco: com o token de quem pediu,
// `admin_prepare_invite` confere que é administrador ativo, valida o e-mail e o
// limite de convites; só então a função envia o convite e registra na auditoria
// (`admin_record_invite`). O e-mail usa o template "Invite user", que leva a
// pessoa para /auth/confirm → "Crie sua senha".
//
// Deploy: supabase functions deploy admin-invite
// (SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY já existem no ambiente.)
// =============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2.49.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const STATUS: Record<string, number> = { HV401: 401, HV403: 403, HV404: 404, HV409: 409, HV422: 422, HV429: 429 };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { code: 'HV405', message: 'Método não permitido.' });

  const authorization = req.headers.get('Authorization');
  if (!authorization) return json(401, { code: 'HV401', message: 'Faça login para continuar.' });

  let body: { email?: unknown; name?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { code: 'HV422', message: 'Requisição inválida.' });
  }

  const url = Deno.env.get('SUPABASE_URL')!;
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Regras no banco, como quem pediu (administrador ativo, e-mail, limite).
  const { data: email, error: prepareError } = await caller.rpc('admin_prepare_invite', { p_email: body.email });
  if (prepareError) {
    const known = prepareError.code?.startsWith('HV');
    return json(STATUS[prepareError.code ?? ''] ?? (prepareError.code === '42501' ? 403 : 400), {
      code: known ? prepareError.code : 'HV403',
      message: known ? prepareError.message : 'Você não tem permissão para convidar pessoas.',
    });
  }

  // 2. Envio com a chave de administrador.
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
  const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: inviteError } = await service.auth.admin.inviteUserByEmail(email as string, {
    data: name.length >= 2 ? { name } : undefined,
  });
  if (inviteError) {
    console.error('[admin-invite] falha ao enviar', inviteError);
    const rateLimited = inviteError.status === 429 || /rate limit/i.test(inviteError.message);
    return json(rateLimited ? 429 : 502, {
      code: rateLimited ? 'HV429' : 'HV502',
      message: rateLimited
        ? 'Muitos e-mails enviados em pouco tempo. Aguarde alguns minutos e tente novamente.'
        : 'Não foi possível enviar o convite agora. Verifique a configuração de e-mail (SMTP) e tente de novo.',
    });
  }

  // 3. Auditoria (como quem pediu). Falhar aqui não desfaz o convite já enviado.
  const { data: userId, error: auditError } = await caller.rpc('admin_record_invite', { p_email: email });
  if (auditError) console.error('[admin-invite] convite enviado, mas sem auditoria', auditError);

  return json(200, { email, user_id: userId ?? null });
});
