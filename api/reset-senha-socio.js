// Função serverless (Vercel) — reset de senha entre sócios.
//
// Como o login do SócioAll é por usuário (e-mail sintético @socioall.local),
// não existe recuperação de senha por e-mail de verdade. Em vez disso, um
// sócio já logado pode resetar a senha de outro sócio DA MESMA EMPRESA.
//
// Isso exige a Service Role Key do Supabase, que NUNCA pode ir para o
// front-end (ela ignora todo o RLS). Por isso mora aqui, numa função que só
// roda no servidor da Vercel. Configure a variável de ambiente
// SUPABASE_SERVICE_ROLE_KEY no painel da Vercel (Project Settings >
// Environment Variables) — veja o README para o passo a passo.

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://jgazcgtrkqbuzticrktr.supabase.co";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método não permitido." });
    return;
  }

  if (!SERVICE_ROLE_KEY) {
    res.status(500).json({
      error: "SUPABASE_SERVICE_ROLE_KEY não está configurada no servidor. Veja o README (seção 'Reset de senha entre sócios')."
    });
    return;
  }

  const authHeader = req.headers.authorization || "";
  const callerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!callerToken) {
    res.status(401).json({ error: "Sessão inválida. Faça login novamente." });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const { targetSocioId, novaSenha } = body || {};

  if (!targetSocioId || !novaSenha) {
    res.status(400).json({ error: "Dados incompletos." });
    return;
  }
  if (String(novaSenha).length < 6) {
    res.status(400).json({ error: "A nova senha precisa ter pelo menos 6 caracteres." });
    return;
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // 1) Identifica quem está chamando, a partir do token da sessão dele.
  const { data: callerData, error: callerError } = await supabaseAdmin.auth.getUser(callerToken);
  if (callerError || !callerData?.user) {
    res.status(401).json({ error: "Sessão inválida. Faça login novamente." });
    return;
  }
  const callerUserId = callerData.user.id;

  // 2) Empresa de quem está chamando.
  const { data: callerSocio, error: callerSocioError } = await supabaseAdmin
    .from("socios")
    .select("id, empresa_id")
    .eq("user_id", callerUserId)
    .limit(1)
    .single();

  if (callerSocioError || !callerSocio) {
    res.status(403).json({ error: "Você não está vinculado a nenhuma empresa." });
    return;
  }

  // 2.1) Rate limit: no máximo 5 resets de senha por hora por quem chama,
  // evitando abuso (um sócio travando a conta de outro repetidamente).
  const umaHoraAtras = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: tentativasRecentes, error: rateLimitError } = await supabaseAdmin
    .from("reset_senha_logs")
    .select("id", { count: "exact", head: true })
    .eq("caller_user_id", callerUserId)
    .gte("created_at", umaHoraAtras);

  if (!rateLimitError && tentativasRecentes >= 5) {
    res.status(429).json({ error: "Muitas tentativas de reset de senha. Aguarde um pouco e tente novamente." });
    return;
  }

  // 3) Sócio alvo precisa ser da mesma empresa e já ter login (user_id preenchido).
  const { data: targetSocio, error: targetSocioError } = await supabaseAdmin
    .from("socios")
    .select("id, empresa_id, user_id, nome")
    .eq("id", targetSocioId)
    .single();

  if (targetSocioError || !targetSocio) {
    res.status(404).json({ error: "Sócio não encontrado." });
    return;
  }

  if (targetSocio.empresa_id !== callerSocio.empresa_id) {
    res.status(403).json({ error: "Esse sócio não é da sua empresa." });
    return;
  }

  if (!targetSocio.user_id) {
    res.status(400).json({ error: "Esse sócio ainda não criou login — não há senha para resetar." });
    return;
  }

  // 4) Reseta a senha via API administrativa (só possível com a service role key).
  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(targetSocio.user_id, {
    password: String(novaSenha)
  });

  if (updateError) {
    // O detalhe técnico fica só no log do servidor (Vercel), não é exposto
    // ao usuário final, para não vazar detalhes internos do Supabase/Postgres.
    console.error("Erro ao redefinir senha do sócio:", updateError);
    res.status(500).json({ error: "Não foi possível redefinir a senha. Tente novamente em instantes." });
    return;
  }

  // 5) Log de auditoria: registra quem resetou a senha de quem e quando.
  // Falha aqui não deve impedir a resposta de sucesso ao usuário.
  const { error: logError } = await supabaseAdmin.from("reset_senha_logs").insert({
    empresa_id: callerSocio.empresa_id,
    caller_user_id: callerUserId,
    caller_socio_id: callerSocio.id,
    target_socio_id: targetSocio.id
  });
  if (logError) {
    console.error("Falha ao registrar log de auditoria do reset de senha:", logError);
  }

  res.status(200).json({ ok: true });
};
