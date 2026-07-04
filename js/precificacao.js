let currentEmpresaId = null;
let currentSocioId = null;
let lojasCache = [];
let ultimoCalculo = null; // guarda o último resultado calculado, para o botão "Salvar no histórico"

async function initPrecificacao() {
  const ctx = await initAuthenticatedPage('precificacao');
  if (!ctx) return;
  currentEmpresaId = ctx.empresaId;
  currentSocioId = ctx.socioId;

  await loadLojas();
  await loadHistorico();
}

// ---------- Lojas / marketplaces ----------

async function loadLojas() {
  const { data, error } = await supabaseClient
    .from("lojas_ecommerce")
    .select("id, nome, taxa_percentual, taxa_fixa, link_referencia, observacoes, updated_at")
    .eq("empresa_id", currentEmpresaId)
    .order("nome", { ascending: true });

  if (error) {
    showToast(friendlyErrorMessage(error, "Não foi possível carregar as lojas."), "error");
    return;
  }

  if (!data || data.length === 0) {
    // Primeira visita: já deixa Mercado Livre, Shopee e Amazon cadastrados
    // com uma taxa de referência (editável), para começar mais rápido.
    const { error: seedError } = await supabaseClient.rpc("seed_lojas_padrao", {
      p_empresa_id: currentEmpresaId
    });
    if (seedError) {
      showToast(friendlyErrorMessage(seedError, "Não foi possível criar as lojas padrão."), "error");
    } else {
      return loadLojas();
    }
  }

  lojasCache = data || [];
  renderLojaTabs();
  renderLojasTable();
}

// Shopee, Mercado Livre e Amazon aparecem primeiro (nessa ordem) por padrão;
// qualquer loja extra que você cadastrar entra depois, em ordem alfabética.
const LOJA_TAB_ORDEM_PADRAO = ["shopee", "mercado livre", "amazon"];

function ordenarLojasParaAbas(lojas) {
  return [...lojas].sort((a, b) => {
    const ia = LOJA_TAB_ORDEM_PADRAO.indexOf(a.nome.trim().toLowerCase());
    const ib = LOJA_TAB_ORDEM_PADRAO.indexOf(b.nome.trim().toLowerCase());
    const pa = ia === -1 ? LOJA_TAB_ORDEM_PADRAO.length : ia;
    const pb = ib === -1 ? LOJA_TAB_ORDEM_PADRAO.length : ib;
    if (pa !== pb) return pa - pb;
    return a.nome.localeCompare(b.nome, "pt-BR");
  });
}

let selectedLojaId = "";
let lojaTabsInicializado = false;

function renderLojaTabs() {
  const container = document.getElementById("lojaTabs");
  if (!container) return;

  const lojasOrdenadas = ordenarLojasParaAbas(lojasCache);
  // "Manual" fica sempre por último.
  const abas = [
    ...lojasOrdenadas.map(l => ({ id: l.id, nome: l.nome })),
    { id: "", nome: "Manual" }
  ];

  if (!lojaTabsInicializado) {
    // Na primeira vez que as abas aparecem, já seleciona a Shopee por padrão.
    lojaTabsInicializado = true;
    const shopee = lojasCache.find(l => l.nome.trim().toLowerCase() === "shopee");
    selectedLojaId = shopee ? shopee.id : (lojasOrdenadas[0]?.id || "");
  } else if (!abas.some(a => a.id === selectedLojaId)) {
    // Se a loja selecionada não existir mais (ex: foi excluída), volta pro manual.
    selectedLojaId = "";
  }

  container.innerHTML = abas.map(a => `
    <li class="nav-item" role="presentation">
      <button type="button" class="nav-link ${a.id === selectedLojaId ? "active" : ""}" data-loja-id="${a.id}" role="tab" aria-selected="${a.id === selectedLojaId}">${escapeHtml(a.nome)}</button>
    </li>
  `).join("");

  aplicarTaxaDaLojaSelecionada();
}

function aplicarTaxaDaLojaSelecionada() {
  const loja = lojasCache.find(l => l.id === selectedLojaId);
  if (loja) {
    document.getElementById("calcTaxaPercentual").value = loja.taxa_percentual;
    document.getElementById("calcTaxaFixa").value = loja.taxa_fixa;
  }
  document.getElementById("calcLojaId").value = selectedLojaId;
}

document.getElementById("lojaTabs")?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-loja-id]");
  if (!btn) return;

  selectedLojaId = btn.dataset.lojaId;
  document.querySelectorAll("#lojaTabs .nav-link").forEach(b => {
    const active = b === btn;
    b.classList.toggle("active", active);
    b.setAttribute("aria-selected", active ? "true" : "false");
  });
  aplicarTaxaDaLojaSelecionada();
  atualizarResultado();
});

function renderLojasTable() {
  const tbody = document.getElementById("lojasTableBody");
  tbody.innerHTML = "";

  if (lojasCache.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="table-empty">Nenhuma loja cadastrada ainda.</td></tr>';
    return;
  }

  // Taxas de marketplace mudam com frequência — se faz muito tempo que a taxa
  // dessa loja não é revisada, mostra um lembrete visual em vez de deixar a
  // pessoa confiar num número que pode estar desatualizado.
  const DIAS_PARA_REVISAR = 180;

  lojasCache.forEach(l => {
    const tr = document.createElement("tr");
    const atualizadoEm = l.updated_at || l.created_at;
    const dias = atualizadoEm ? Math.floor((Date.now() - new Date(atualizadoEm).getTime()) / 86400000) : null;
    const desatualizada = dias !== null && dias > DIAS_PARA_REVISAR;
    const atualizadoTexto = atualizadoEm ? formatDate(atualizadoEm.slice(0, 10)) : "—";

    tr.innerHTML = `
      <td>${escapeHtml(l.nome)}</td>
      <td>${Number(l.taxa_percentual).toFixed(2)}%</td>
      <td>${formatCurrency(l.taxa_fixa)}</td>
      <td class="small text-muted">${escapeHtml(l.observacoes || "—")}</td>
      <td class="small ${desatualizada ? "text-danger" : "text-muted"}">
        ${atualizadoTexto}
        ${desatualizada ? '<br><i class="bi bi-exclamation-triangle-fill"></i> revisar taxa' : ""}
      </td>
      <td class="text-end text-nowrap">
        <button type="button" class="btn btn-sm btn-outline-secondary" aria-label="Editar loja ${escapeHtml(l.nome)}" onclick="editarLoja('${l.id}')"><i class="bi bi-pencil"></i></button>
        <button type="button" class="btn btn-sm btn-outline-danger" aria-label="Excluir loja ${escapeHtml(l.nome)}" onclick="excluirLoja('${l.id}')"><i class="bi bi-trash"></i></button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  animateTableRows(tbody);
}

function editarLoja(id) {
  const loja = lojasCache.find(l => l.id === id);
  if (!loja) return;

  document.getElementById("lojaEditId").value = loja.id;
  document.getElementById("lojaNome").value = loja.nome;
  document.getElementById("lojaTaxaPercentual").value = loja.taxa_percentual;
  document.getElementById("lojaTaxaFixa").value = loja.taxa_fixa;
  document.getElementById("lojaLinkReferencia").value = loja.link_referencia || "";
  document.getElementById("lojaObservacoes").value = loja.observacoes || "";

  document.getElementById("lojaFormTitulo").textContent = `Editar ${loja.nome}`;
  document.getElementById("lojaSubmitBtn").innerHTML = '<i class="bi bi-check-lg me-1"></i>Salvar alterações';
  document.getElementById("lojaCancelEditBtn").classList.remove("d-none");
  document.getElementById("lojaNome").focus();
}

function cancelarEdicaoLoja() {
  document.getElementById("novaLojaForm").reset();
  document.getElementById("lojaEditId").value = "";
  document.getElementById("lojaTaxaPercentual").value = 0;
  document.getElementById("lojaTaxaFixa").value = 0;
  document.getElementById("lojaFormTitulo").textContent = "Adicionar loja";
  document.getElementById("lojaSubmitBtn").innerHTML = '<i class="bi bi-plus-lg me-1"></i>Adicionar loja';
  document.getElementById("lojaCancelEditBtn").classList.add("d-none");
}

document.getElementById("lojaCancelEditBtn")?.addEventListener("click", cancelarEdicaoLoja);

const novaLojaForm = document.getElementById("novaLojaForm");
if (novaLojaForm) {
  novaLojaForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = document.getElementById("lojaSubmitBtn");

    const editId = document.getElementById("lojaEditId").value;

    await withLoadingButton(submitBtn, editId ? "Salvando..." : "Adicionando...", async () => {
      const nome = document.getElementById("lojaNome").value.trim();
      const taxaPercentual = Number(document.getElementById("lojaTaxaPercentual").value);
      const taxaFixa = Number(document.getElementById("lojaTaxaFixa").value);
      const linkReferencia = document.getElementById("lojaLinkReferencia").value.trim();
      const observacoes = document.getElementById("lojaObservacoes").value.trim();

      const payload = {
        nome,
        taxa_percentual: taxaPercentual,
        taxa_fixa: taxaFixa,
        link_referencia: linkReferencia || null,
        observacoes: observacoes || null
      };

      const { error } = editId
        ? await supabaseClient.from("lojas_ecommerce").update(payload).eq("id", editId)
        : await supabaseClient.from("lojas_ecommerce").insert({ empresa_id: currentEmpresaId, ...payload });

      if (error) {
        showToast(friendlyErrorMessage(error, editId ? "Não foi possível salvar a loja." : "Não foi possível adicionar a loja."), "error");
        return;
      }

      cancelarEdicaoLoja();
      showToast(editId ? "Taxa da loja atualizada." : "Loja adicionada.");
      await loadLojas();
    });
  });
}

async function excluirLoja(id) {
  const ok = await confirmDialog("Excluir esta loja? Cálculos já salvos com ela continuam no histórico, só perdem a referência da loja.", { confirmText: "Excluir" });
  if (!ok) return;

  const { error } = await supabaseClient.from("lojas_ecommerce").delete().eq("id", id);
  if (error) {
    showToast(friendlyErrorMessage(error, "Não foi possível excluir a loja."), "error");
    return;
  }
  showToast("Loja excluída.");
  await loadLojas();
}

// ---------- Calculadora ----------
// Fórmula: se a loja cobra uma taxa percentual (t) + uma taxa fixa (F) por
// venda, e queremos que sobre exatamente (custo + embalagem + operacional +
// lucro) depois de descontada a taxa, o preço de venda tem que ser:
//   precoVenda = (custoTotal + F) / (1 - t/100)
// Conferência: precoVenda - F - precoVenda*(t/100) deve bater com custoTotal.
function calcularPrecoVenda({ custoProduto, custoEmbalagem, custoOperacional, lucro, taxaPercentual, taxaFixa }) {
  const custoTotal = custoProduto + custoEmbalagem + custoOperacional + lucro;
  const t = taxaPercentual / 100;
  const precoVenda = (custoTotal + taxaFixa) / (1 - t);
  const valorTaxaPercentual = precoVenda * t;
  const liquido = precoVenda - taxaFixa - valorTaxaPercentual;
  return { custoTotal, precoVenda, valorTaxaPercentual, liquido };
}

// Lê os campos e recalcula o resultado — chamada tanto ao enviar o formulário
// quanto a cada tecla digitada, para o resultado aparecer em tempo real.
function atualizarResultado() {
  const custoProduto = Number(document.getElementById("calcCustoProduto").value) || 0;
  const custoEmbalagem = Number(document.getElementById("calcCustoEmbalagem").value) || 0;
  const custoOperacional = Number(document.getElementById("calcCustoOperacional").value) || 0;
  const lucroInput = Number(document.getElementById("calcLucro").value) || 0;
  const lucroTipo = document.getElementById("calcLucroTipo").value;
  const taxaPercentual = Number(document.getElementById("calcTaxaPercentual").value) || 0;
  const taxaFixa = Number(document.getElementById("calcTaxaFixa").value) || 0;

  // Lucro em % incide sobre o custo do pro