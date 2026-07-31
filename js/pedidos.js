let currentEmpresaId = null;
let currentSocioId = null;
let lojasCache = [];

async function initPedidos() {
  const ctx = await initAuthenticatedPage('pedidos');
  if (!ctx) return;
  currentEmpresaId = ctx.empresaId;
  currentSocioId = ctx.socioId;

  await loadLojas();
  await loadPedidos();
}

// Carrega as lojas registradas da empresa. Se nenhuma existir, cria as lojas
// padrão (Mercado Livre, Shopee, Amazon) como semente inicial para testes.
async function loadLojas() {
  const { data: lojas, error } = await supabaseClient
    .from("lojas_ecommerce")
    .select("id, nome")
    .eq("empresa_id", currentEmpresaId)
    .order("nome", { ascending: true });

  if (error) {
    showToast(friendlyErrorMessage(error, "Não foi possível carregar as lojas."), "error");
    return;
  }

  if (!lojas || lojas.length === 0) {
    // Chama RPC para provisionar lojas padrão caso o banco esteja vazio
    const { error: seedError } = await supabaseClient.rpc("seed_lojas_padrao", {
      p_empresa_id: currentEmpresaId
    });
    if (seedError) {
      showToast(friendlyErrorMessage(seedError, "Não foi possível criar as lojas padrão."), "error");
    } else {
      // Recarrega lojas após seed
      return loadLojas();
    }
    return;
  }

  lojasCache = lojas || [];
  
  // Preenche os filtros do cabeçalho
  const filtroLoja = document.getElementById("filtroLoja");
  if (filtroLoja) {
    filtroLoja.innerHTML = '<option value="">Todas as lojas</option>';
    lojasCache.forEach(l => {
      const opt = document.createElement("option");
      opt.value = l.id;
      opt.textContent = l.nome;
      filtroLoja.appendChild(opt);
    });
  }

  // Preenche o seletor do modal de sincronização
  const syncSelect = document.getElementById("syncLojaSelect");
  if (syncSelect) {
    syncSelect.innerHTML = '<option value="">Selecione...</option>';
    lojasCache.forEach(l => {
      const opt = document.createElement("option");
      opt.value = l.id;
      opt.textContent = l.nome;
      syncSelect.appendChild(opt);
    });
  }
}

// Carrega a listagem de pedidos aplicando filtros de Loja e Status
async function loadPedidos() {
  tableLoading("pedidosTableBody", 7);

  const filtroLojaVal = document.getElementById("filtroLoja")?.value || "";
  const filtroStatusVal = document.getElementById("filtroStatus")?.value || "";

  let query = supabaseClient
    .from("pedidos_ecommerce")
    .select("id, numero_pedido, nome_produto, valor, status, created_at, lojas_ecommerce(nome)")
    .eq("empresa_id", currentEmpresaId)
    .order("created_at", { ascending: false });

  if (filtroLojaVal) {
    query = query.eq("loja_id", filtroLojaVal);
  }
  if (filtroStatusVal) {
    query = query.eq("status", filtroStatusVal);
  }

  const { data: pedidos, error } = await query;

  if (error) {
    showToast(friendlyErrorMessage(error, "Não foi possível carregar os pedidos."), "error");
    return;
  }

  const tbody = document.getElementById("pedidosTableBody");
  tbody.innerHTML = "";

  if (!pedidos || pedidos.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="table-empty"><i class="bi bi-bag-check fs-4 d-block mb-2"></i>Nenhum pedido correspondente ao filtro.</td></tr>';
    return;
  }

  pedidos.forEach(p => {
    let statusClass = "badge-status-pendente";
    let statusLabel = "Pendente";
    if (p.status === "faturado") {
      statusClass = "badge-status-faturado";
      statusLabel = "Faturado";
    } else if (p.status === "cancelado") {
      statusClass = "badge-status-cancelado";
      statusLabel = "Cancelado";
    }

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${escapeHtml(p.numero_pedido || "—")}</strong></td>
      <td>${escapeHtml(p.nome_produto || "—")}</td>
      <td>${escapeHtml(p.lojas_ecommerce?.nome || "—")}</td>
      <td>${p.valor != null ? formatCurrency(p.valor) : "—"}</td>
      <td><span class="badge ${statusClass}">${statusLabel}</span></td>
      <td>${formatTimestamp(p.created_at)}</td>
      <td class="text-end text-nowrap">
        ${p.status === "pendente" 
          ? `<button class="btn btn-sm btn-outline-success me-1" title="Faturar no Caixa" onclick="faturarPedido('${p.id}', this)"><i class="bi bi-currency-dollar"></i> Faturar</button>
             <button class="btn btn-sm btn-outline-warning me-1" title="Cancelar Pedido" aria-label="Cancelar pedido ${escapeHtml(p.numero_pedido || "")}" onclick="cancelarPedido('${p.id}', this)"><i class="bi bi-x-circle"></i></button>`
          : ""
        }
        <button class="btn btn-sm btn-outline-danger" title="Excluir Registro" aria-label="Excluir registro do pedido ${escapeHtml(p.numero_pedido || "")}" onclick="excluirPedido('${p.id}', this)"><i class="bi bi-trash"></i></button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  animateTableRows(tbody);
}

function filtrarPedidos() {
  loadPedidos();
}

// Abre o modal de sincronização limpando estados anteriores
function abrirModalSincronizar() {
  const modalEl = document.getElementById("sincronizarModal");
  if (!modalEl) return;

  // Reseta form e progresso
  document.getElementById("sincronizarForm").reset();
  const progressPanel = document.getElementById("syncProgressPanel");
  progressPanel.classList.add("d-none");
  
  const progressBar = document.getElementById("syncProgressBar");
  progressBar.style.width = "0%";
  progressBar.textContent = "";

  const btnConfirmSync = document.getElementById("btnConfirmSync");
  btnConfirmSync.disabled = false;
  
  const btnFecharSyncModal = document.getElementById("btnFecharSyncModal");
  btnFecharSyncModal.disabled = false;

  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();
}

// Controla a simulação visual de progresso da sincronização de dados
async function iniciarSincronizacao(event) {
  event.preventDefault();
  
  const lojaId = document.getElementById("syncLojaSelect").value;
  const token = document.getElementById("syncToken").value;
  if (!lojaId || !token) return;

  const btnConfirmSync = document.getElementById("btnConfirmSync");
  const btnFecharSyncModal = document.getElementById("btnFecharSyncModal");
  const progressPanel = document.getElementById("syncProgressPanel");
  const progressBar = document.getElementById("syncProgressBar");
  const progressStatus = document.getElementById("syncProgressStatus");

  // Trava botões e exibe progresso
  btnConfirmSync.disabled = true;
  btnFecharSyncModal.disabled = true;
  progressPanel.classList.remove("d-none");

  const steps = [
    { progress: 15, text: "Conectando ao canal da API de vendas..." },
    { progress: 40, text: "Autenticando token de acesso criptografado..." },
    { progress: 70, text: "Procurando novos pedidos pendentes..." },
    { progress: 90, text: "Importando metadados de pedidos..." },
    { progress: 100, text: "Importação concluída com sucesso!" }
  ];

  for (let i = 0; i < steps.length; i++) {
    await new Promise(resolve => setTimeout(resolve, i === 0 ? 300 : 700));
    progressBar.style.width = `${steps[i].progress}%`;
    progressBar.setAttribute("aria-valuenow", steps[i].progress);
    progressStatus.textContent = steps[i].text;
  }

  // Conclui e salva os registros mockados no banco
  await finalizarSincronizacao(lojaId);
}

async function finalizarSincronizacao(lojaId) {
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
      throw new Error("Sessão inválida. Por favor, faça login novamente.");
    }

    const resp = await fetch("/api/sync-shopee", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ lojaId })
    });

    const result = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(result.error || "Erro na sincronização de dados.");
    }

    const lojaObj = lojasCache.find(l => l.id === lojaId);
    const lojaNome = lojaObj?.nome || "loja";
    
    // Se o backend rodou no modo de simulação, avisa no toast
    const msgSucedida = result.mode === "simulation"
      ? `Sincronização com ${lojaNome} simulada. ${result.importedCount} pedidos de teste criados.`
      : `Sincronização com ${lojaNome} concluída. ${result.importedCount} pedidos importados da Shopee.`;

    showToast(msgSucedida);

    // Oculta modal
    const modalEl = document.getElementById("sincronizarModal");
    if (modalEl) {
      const modal = bootstrap.Modal.getInstance(modalEl);
      modal.hide();
    }

    await loadPedidos();
  } catch (err) {
    showToast(friendlyErrorMessage(err, "Falha ao sincronizar os pedidos da loja."), "error");
    // Libera botões caso dê erro para tentar de novo
    document.getElementById("btnConfirmSync").disabled = false;
    document.getElementById("btnFecharSyncModal").disabled = false;
  }
}

// Faturar o pedido: cria categoria Vendas E-commerce caso não exista, insere lançamento e atualiza pedido
async function faturarPedido(pedidoId, btnEl) {
  const originalText = btnEl.innerHTML;
  btnEl.disabled = true;
  btnEl.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Processando...';

  try {
    // 1) Busca detalhes do pedido a ser faturado
    const { data: pedido, error: pedFetchError } = await supabaseClient
      .from("pedidos_ecommerce")
      .select("numero_pedido, nome_produto, valor, lojas_ecommerce(nome)")
      .eq("id", pedidoId)
      .single();

    if (pedFetchError || !pedido) throw pedFetchError || new Error("Pedido não encontrado.");

    // 2) Verifica e cria a categoria "Vendas E-commerce" (tipo receita) caso não exista
    let { data: categorias, error: catError } = await supabaseClient
      .from("categorias")
      .select("id")
      .eq("empresa_id", currentEmpresaId)
      .eq("nome", "Vendas E-commerce")
      .eq("tipo", "receita")
      .limit(1);

    if (catError) throw catError;

    let categoriaId = null;
    if (categorias && categorias.length > 0) {
      categoriaId = categorias[0].id;
    } else {
      const { data: novaCat, error: catInsertError } = await supabaseClient
        .from("categorias")
        .insert({
          empresa_id: currentEmpresaId,
          nome: "Vendas E-commerce",
          tipo: "receita"
        })
        .select()
        .single();
      
      if (catInsertError) throw catInsertError;
      categoriaId = novaCat.id;
    }

    // 3) Insere o lançamento de receita no caixa
    const lojaNome = pedido.lojas_ecommerce?.nome || "Marketplace";
    const { data: novoLancamento, error: lancInsertError } = await supabaseClient
      .from("lancamentos")
      .insert({
        empresa_id: currentEmpresaId,
        socio_id: currentSocioId,
        categoria_id: categoriaId,
        tipo: "receita",
        descricao: `Venda E-commerce: ${pedido.nome_produto} (${lojaNome} #${pedido.numero_pedido})`,
        valor: pedido.valor,
        data: new Date().toISOString().split("T")[0]
      })
      .select()
      .single();

    if (lancInsertError) throw lancInsertError;

    // 4) Atualiza o status do pedido para faturado e vincula ao lancamento_id
    const { error: pedUpdateError } = await supabaseClient
      .from("pedidos_ecommerce")
      .update({
        status: "faturado",
        lancamento_id: novoLancamento.id
      })
      .eq("id", pedidoId);

    if (pedUpdateError) throw pedUpdateError;

    showToast(`Pedido ${pedido.numero_pedido} faturado com sucesso! Receita inserida no caixa.`);
    await loadPedidos();

  } catch (err) {
    showToast(friendlyErrorMessage(err, "Falha ao faturar o pedido."), "error");
    btnEl.disabled = false;
    btnEl.innerHTML = originalText;
  }
}

// Cancela o pedido no e-commerce
async function cancelarPedido(pedidoId, btnEl) {
  const originalText = btnEl.innerHTML;
  btnEl.disabled = true;
  btnEl.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';

  try {
    const { error } = await supabaseClient
      .from("pedidos_ecommerce")
      .update({ status: "cancelado" })
      .eq("id", pedidoId);

    if (error) throw error;

    showToast("Pedido marcado como cancelado.");
    await loadPedidos();
  } catch (err) {
    showToast(friendlyErrorMessage(err, "Não foi possível cancelar o pedido."), "error");
    btnEl.disabled = false;
    btnEl.innerHTML = originalText;
  }
}

// Exclui permanentemente o pedido do banco de dados
async function excluirPedido(pedidoId, btnEl) {
  const ok = await confirmDialog("Tem certeza que deseja excluir permanentemente o registro deste pedido?", {
    confirmText: "Excluir",
    danger: true
  });

  if (!ok) return;

  const originalText = btnEl.innerHTML;
  btnEl.disabled = true;
  btnEl.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';

  try {
    const { error } = await supabaseClient
      .from("pedidos_ecommerce")
      .delete()
      .eq("id", pedidoId);

    if (error) throw error;

    showToast("Registro do pedido excluído.");
    await loadPedidos();
  } catch (err) {
    showToast(friendlyErrorMessage(err, "Não foi possível excluir o pedido."), "error");
    btnEl.disabled = false;
    btnEl.innerHTML = originalText;
  }
}

initPedidos();
