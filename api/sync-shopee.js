// Função serverless (Vercel) — Sincronização real de pedidos da Shopee.
//
// Esta API executa a integração com a Shopee API v2, lidando com autenticação OAuth,
// assinatura criptográfica (HMAC-SHA256) e upsert de dados no Supabase.
// Caso as credenciais da Shopee não estejam cadastradas no banco, ela executa em modo
// simulado (mock) para desenvolvimento, fornecendo dados de teste realistas.

const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://jgazcgtrkqbuzticrktr.supabase.co";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Chaves do aplicativo de desenvolvedor da Shopee (configuradas no painel da Vercel)
const SHOPEE_PARTNER_ID = Number(process.env.SHOPEE_PARTNER_ID) || null;
const SHOPEE_PARTNER_KEY = process.env.SHOPEE_PARTNER_KEY || null;
const SHOPEE_BASE_URL = process.env.SHOPEE_BASE_URL || "https://partner.shopeemobile.com"; // URL de Produção

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método não permitido." });
    return;
  }

  if (!SERVICE_ROLE_KEY) {
    res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY não está configurada no servidor." });
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
  const { lojaId } = body || {};

  if (!lojaId) {
    res.status(400).json({ error: "O ID da loja é obrigatório." });
    return;
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // 1) Identifica quem está chamando
  const { data: callerData, error: callerError } = await supabaseAdmin.auth.getUser(callerToken);
  if (callerError || !callerData?.user) {
    res.status(401).json({ error: "Sessão inválida. Faça login novamente." });
    return;
  }
  const callerUserId = callerData.user.id;

  // 2) Verifica empresa e sócio correspondente
  const { data: callerSocio, error: callerSocioError } = await supabaseAdmin
    .from("socios")
    .select("empresa_id")
    .eq("user_id", callerUserId)
    .limit(1)
    .single();

  if (callerSocioError || !callerSocio) {
    res.status(403).json({ error: "Você não possui permissão para acessar esta empresa." });
    return;
  }
  const empresaId = callerSocio.empresa_id;

  // 3) Busca os dados da loja e as credenciais da Shopee cadastradas no banco
  const { data: loja, error: lojaError } = await supabaseAdmin
    .from("lojas_ecommerce")
    .select("id, nome, shopee_shop_id, shopee_access_token, shopee_refresh_token, shopee_token_expires_at")
    .eq("id", lojaId)
    .eq("empresa_id", empresaId)
    .single();

  if (lojaError || !loja) {
    res.status(404).json({ error: "Loja não encontrada ou não pertence à sua empresa." });
    return;
  }

  const hasShopeeCredentials = !!(loja.shopee_shop_id && loja.shopee_access_token && loja.shopee_refresh_token);

  // MODO SIMULADO / TESTE (Caso o usuário ainda não tenha cadastrado as chaves de integração da Shopee)
  if (!hasShopeeCredentials || !SHOPEE_PARTNER_ID || !SHOPEE_PARTNER_KEY) {
    console.log("Credenciais da Shopee ausentes ou parciais. Rodando em Modo de Simulação.");
    const simulatedOrders = generateSimulatedShopeeOrders(empresaId, lojaId);
    
    // Insere com upsert para evitar duplicados
    const { error: upsertError } = await supabaseAdmin
      .from("pedidos_ecommerce")
      .upsert(simulatedOrders, { onConflict: "numero_pedido" });

    if (upsertError) {
      res.status(500).json({ error: "Falha ao gravar os pedidos simulados no banco: " + upsertError.message });
      return;
    }

    res.status(200).json({
      ok: true,
      mode: "simulation",
      importedCount: simulatedOrders.length,
      message: "Sincronização simulada concluída! (Configure as credenciais reais no banco para ativar a API da Shopee)."
    });
    return;
  }

  // MODO REAL (Integração oficial com a API da Shopee)
  try {
    let accessToken = loja.shopee_access_token;
    let expiresAt = new Date(loja.shopee_token_expires_at);

    // Se o token estiver perto de expirar (menos de 10 minutos), faz o refresh automático
    if (expiresAt.getTime() - Date.now() < 10 * 60 * 1000) {
      console.log("Renovando access_token da Shopee...");
      const refreshResult = await refreshShopeeToken(loja.shopee_refresh_token, loja.shopee_shop_id);
      if (refreshResult.error) {
        throw new Error("Erro ao renovar token da Shopee: " + refreshResult.error);
      }
      accessToken = refreshResult.accessToken;

      // Salva os novos tokens atualizados de volta no banco de dados
      await supabaseAdmin
        .from("lojas_ecommerce")
        .update({
          shopee_access_token: refreshResult.accessToken,
          shopee_refresh_token: refreshResult.refreshToken,
          shopee_token_expires_at: new Date(Date.now() + refreshResult.expireIn * 1000).toISOString()
        })
        .eq("id", lojaId);
    }

    // 4) Busca lista de pedidos recentes na API da Shopee (v2.order.get_order_list)
    const orderListPath = "/api/v2/order/get_order_list";
    const timestamp = Math.floor(Date.now() / 1000);
    const shopId = Number(loja.shopee_shop_id);

    // Filtra pedidos dos últimos 3 dias
    const timeFrom = Math.floor((Date.now() - 3 * 24 * 60 * 60 * 1000) / 1000);
    const timeTo = timestamp;

    const sign = generateSignature(orderListPath, timestamp, accessToken, shopId);
    const url = `${SHOPEE_BASE_URL}${orderListPath}?partner_id=${SHOPEE_PARTNER_ID}&timestamp=${timestamp}&access_token=${accessToken}&shop_id=${shopId}&sign=${sign}&time_range_field=create_time&time_from=${timeFrom}&time_to=${timeTo}&page_size=20`;

    const listResp = await fetch(url);
    const listData = await listResp.json();

    if (listData.error) {
      throw new Error(`Erro na API da Shopee (get_order_list): ${listData.message || listData.error}`);
    }

    const shopeeOrders = listData.response?.order_list || [];
    if (shopeeOrders.length === 0) {
      res.status(200).json({ ok: true, mode: "real", importedCount: 0 });
      return;
    }

    // 5) Para cada ID retornado, busca os detalhes (v2.order.get_order_detail)
    const orderDetailPath = "/api/v2/order/get_order_detail";
    const detailSign = generateSignature(orderDetailPath, timestamp, accessToken, shopId);
    const detailUrl = `${SHOPEE_BASE_URL}${orderDetailPath}?partner_id=${SHOPEE_PARTNER_ID}&timestamp=${timestamp}&access_token=${accessToken}&shop_id=${shopId}&sign=${detailSign}`;

    const orderSnList = shopeeOrders.map(o => o.order_sn);
    const detailResp = await fetch(detailUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order_sn_list: orderSnList,
        response_optional_fields: "item_list,total_amount,buyer_user_id"
      })
    });
    const detailData = await detailResp.json();

    if (detailData.error) {
      throw new Error(`Erro na API da Shopee (get_order_detail): ${detailData.message || detailData.error}`);
    }

    const orderDetails = detailData.response?.order_list || [];

    // 6) Mapeia e grava os dados reais no Supabase usando upsert
    const ordersToInsert = orderDetails.map(order => {
      const nomeProduto = order.item_list?.[0]?.item_name || "Produto Shopee";
      // Mapeamento simples de status: COMPLETED ou READY_TO_SHIP fica como pendente de faturar no caixa;
      // CANCELLED ou IN_CANCEL vira cancelado.
      let status = "pendente";
      const statusShopee = (order.order_status || "").toUpperCase();
      if (statusShopee.includes("CANCEL")) {
        status = "cancelado";
      }

      return {
        empresa_id: empresaId,
        loja_id: lojaId,
        numero_pedido: `SH-${order.order_sn}`,
        nome_produto: nomeProduto,
        valor: Number(order.total_amount) || 0,
        status: status,
        created_at: new Date(order.create_time * 1000).toISOString()
      };
    });

    const { error: upsertError } = await supabaseAdmin
      .from("pedidos_ecommerce")
      .upsert(ordersToInsert, { onConflict: "numero_pedido" });

    if (upsertError) throw upsertError;

    res.status(200).json({ ok: true, mode: "real", importedCount: ordersToInsert.length });

  } catch (err) {
    console.error("Erro na integração com a Shopee:", err);
    res.status(500).json({ error: "Falha na sincronização real da Shopee: " + err.message });
  }
};

// Gera a assinatura HMAC-SHA256 exigida pela API da Shopee
function generateSignature(path, timestamp, accessToken = "", shopId = "") {
  let baseString = `${SHOPEE_PARTNER_ID}${path}${timestamp}`;
  if (accessToken) baseString += accessToken;
  if (shopId) baseString += shopId;
  return crypto.createHmac("sha256", SHOPEE_PARTNER_KEY).update(baseString).digest("hex");
}

// Renova o token de acesso utilizando o refresh_token
async function refreshShopeeToken(refreshToken, shopId) {
  const path = "/api/v2/public/get_refresh_token";
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = generateSignature(path, timestamp);
  const url = `${SHOPEE_BASE_URL}${path}?partner_id=${SHOPEE_PARTNER_ID}&timestamp=${timestamp}&sign=${sign}`;

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        refresh_token: refreshToken,
        partner_id: SHOPEE_PARTNER_ID,
        shop_id: Number(shopId)
      })
    });
    const data = await resp.json();
    if (data.error) {
      return { error: data.message || data.error };
    }
    return {
      accessToken: data.response?.access_token,
      refreshToken: data.response?.refresh_token,
      expireIn: data.response?.expire_in // Segundos de validade
    };
  } catch (err) {
    return { error: err.message };
  }
}

// Auxiliar: Gera pedidos simulados idênticos aos mockados na versão antiga,
// mas de forma automatizada no servidor para garantir dados de teste funcionais
function generateSimulatedShopeeOrders(empresaId, lojaId) {
  const templates = [
    { nome_produto: "Garrafa Térmica Inox 1L com Sensor", base_valor: 59 },
    { nome_produto: "Kit 3 Camisetas Masculinas Dry Fit", base_valor: 79 },
    { nome_produto: "Mini Liquidificador Portátil USB", base_valor: 45 },
    { nome_produto: "Organizador de Cabos de Silicone", base_valor: 15 }
  ];

  // Gera 3 a 4 pedidos aleatórios dos templates
  const orders = [];
  const selectedCount = 3 + Math.floor(Math.random() * 2);
  const shuffled = templates.sort(() => 0.5 - Math.random());

  for (let i = 0; i < selectedCount; i++) {
    const t = shuffled[i];
    const orderSn = `SH-${Math.floor(100000000 + Math.random() * 900000000)}`;
    const valor = parseFloat((t.base_valor + (Math.random() - 0.5) * (t.base_valor * 0.1)).toFixed(2));
    const dataOffset = Math.floor(Math.random() * 3);
    const dataStr = new Date(Date.now() - dataOffset * 24 * 60 * 60 * 1000).toISOString();

    orders.push({
      empresa_id: empresaId,
      loja_id: lojaId,
      numero_pedido: orderSn,
      nome_produto: t.nome_produto,
      valor: valor,
      status: "pendente",
      created_at: dataStr
    });
  }

  return orders;
}
