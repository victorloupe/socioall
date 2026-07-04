let currentEmpresaId = null;

async function initPedidos() {
  const ctx = await initAuthenticatedPage('pedidos');
  if (!ctx) return;
  currentEmpresaId = ctx.empresaId;

  await loadPedidos();
}

// A tabela pedidos_ecommerce já existe no banco, pronta para uma futura
// integração com os marketplaces. Por enquanto ela fica vazia — esta função
// só mostra o estado vazio (ou os pedidos que já estiverem lá, se algum dia
// forem inseridos manualmente ou por uma integração).
async function loadPedidos() {
  tableLoading("pedidosTableBody", 6);

  const { data: pedidos, error } = await supabaseClient
    .from("pedidos_ecommerce")
    .select("id, numero_pedido, nome_produto, valor, status, created_at, lojas_ecommerce(nome)")
    .eq("empresa_id", currentEmpresaId)
    .order("created_at", { ascending: false });

  if (error) {
    showToast(friendlyErrorMessage(error, "Não foi possível carregar os pedidos."), "error");
    return;
  }

  const tbody = document.getElementById("pedidosTableBody");
  tbody.innerHTML = "";

  if (!pedidos || pedidos.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty"><i class="bi bi-bag-check fs-4 d-block mb-2"></i>Nenhum pedido ainda. Assim que a integração com as lojas estiver pronta, os pedidos vão aparecer aqui automaticamente.</td></tr>';
    return;
  }

  pedidos.forEach(p => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(p.numero_pedido || "—")}</td>
      <td>${escapeHtml(p.nome_produto || "—")}</td>
      <td>${escapeHtml(p.lojas_ecommerce?.nome || "—")}</td>
      <td>${p.valor != null ? formatCurrency(p.valor) : "—"}</td>
      <td>${escapeHtml(p.status || "—")}</td>
      <td>${p.created_at ? formatDate(p.created_at.slice(0, 10)) : "—"}</td>
    `;
    tbody.appendChild(tr);
  });

  animateTableRow