let currentEmpresaId = null;
let currentSocioId = null;
let lojasCache = [];
let ultimoCalculo = null;
let ultimoCalculosArray = [];
let groupedCalculosCache = {};
let historicoCache = [];
let selectedLojasIds = [];
let selectedLojaId = "";
let historicoPaginaAtual = 0;
let historicoItensPorPagina = 10;
let historicoGruposOrdenados = [];
let historicoBuscaTermo = "";
let filtroApenasKits = false;

async function initPrecificacao() {
  const ctx = await initAuthenticatedPage('precificacao');
  if (!ctx) return;
  currentEmpresaId = ctx.empresaId;
  currentSocioId = ctx.socioId;

  document.getElementById("filtroHistoricoLoja")?.addEventListener("change", () => {
    // O filtro de loja é aplicado na tela (client-side): o cache completo
    // continua intacto para as sugestões e o aviso de produto duplicado.
    historicoPaginaAtual = 0;
    renderHistoricoPagina();
  });

  document.getElementById("historicoBusca")?.addEventListener("input", (e) => {
    historicoBuscaTermo = e.target.value.trim().toLowerCase();
    historicoPaginaAtual = 0;
    renderHistoricoPagina();
  });

  document.getElementById("btnFiltroKits")?.addEventListener("click", (e) => {
    filtroApenasKits = !filtroApenasKits;
    const btn = e.currentTarget;
    if (filtroApenasKits) {
      btn.classList.remove("btn-outline-secondary");
      btn.classList.add("btn-primary", "text-white");
    } else {
      btn.classList.remove("btn-primary", "text-white");
      btn.classList.add("btn-outline-secondary");
    }
    historicoPaginaAtual = 0;
    renderHistoricoPagina();
  });

  document.querySelectorAll('input[name="calcTipoProduto"]').forEach(radio => {
    radio.addEventListener("change", (e) => {
      const tipo = e.target.value;
      const compWrapper = document.getElementById("calcKitComponentesWrapper");

      if (tipo === "kit") {
        compWrapper?.classList.remove("d-none");
        const lista = document.getElementById("kitComponentesLista");
        if (lista && lista.children.length === 0) {
          adicionarLinhaComponente();
          adicionarLinhaComponente();
        }
      } else {
        compWrapper?.classList.add("d-none");
        const lista = document.getElementById("kitComponentesLista");
        if (lista) lista.innerHTML = "";
      }
    });
  });

  let nomeProdutoBuscaTimeout;
  document.getElementById("calcNomeProduto")?.addEventListener("input", (e) => {
    clearTimeout(nomeProdutoBuscaTimeout);
    nomeProdutoBuscaTimeout = setTimeout(() => {
      const termo = e.target.value.trim().toLowerCase();
      atualizarHintProdutoExistente(termo);
    }, 300);
  });

  // Fecha as sugestões ao clicar fora do campo
  document.addEventListener("click", (e) => {
    document.querySelectorAll(".comp-row").forEach(row => {
      if (!row.contains(e.target)) {
        row.querySelector(".comp-sugestoes-box")?.classList.remove("show");
      }
    });
  });

  document.getElementById("btnAdicionarComp")?.addEventListener("click", () => {
    adicionarLinhaComponente();
  });

  document.getElementById("historicoItensPorPagina")?.addEventListener("change", (e) => {
    historicoItensPorPagina = Number(e.target.value);
    historicoPaginaAtual = 0;
    renderHistoricoPagina();
  });

  document.getElementById("btnPaginaAnterior")?.addEventListener("click", () => {
    if (historicoPaginaAtual > 0) {
      historicoPaginaAtual--;
      renderHistoricoPagina();
    }
  });

  document.getElementById("btnPaginaProxima")?.addEventListener("click", () => {
    const totalPaginas = Math.ceil(getGruposFiltrados().length / historicoItensPorPagina);
    if (historicoPaginaAtual < totalPaginas - 1) {
      historicoPaginaAtual++;
      renderHistoricoPagina();
    }
  });

  document.getElementById("calcCompararCanais")?.addEventListener("change", (e) => {
    const comparar = e.target.checked;
    if (!comparar) {
      selectedLojasIds = [selectedLojaId];
    }
    renderLojaTabs();
    atualizarResultado();
  });

  const simularPromoCheckbox = document.getElementById("calcSimularPromo");
  const promoFields = document.getElementById("calcPromoFields");
  const inputPromoDesconto = document.getElementById("calcPromoDesconto");
  const inputPromoPreco = document.getElementById("calcPromoPreco");

  simularPromoCheckbox?.addEventListener("change", (e) => {
    const ativa = e.target.checked;
    if (ativa) {
      promoFields?.classList.remove("d-none");
    } else {
      promoFields?.classList.add("d-none");
      if (inputPromoDesconto) inputPromoDesconto.value = "";
      if (inputPromoPreco) inputPromoPreco.value = "";
    }
    atualizarResultado();
  });

  let promoSincronizando = false;
  inputPromoDesconto?.addEventListener("input", (e) => {
    if (promoSincronizando) return;
    promoSincronizando = true;
    const desconto = Number(e.target.value) || 0;
    const precoSugerido = obterPrecoSugeridoSemPromo();
    if (precoSugerido > 0) {
      const precoPromocional = precoSugerido * (1 - desconto / 100);
      if (inputPromoPreco) inputPromoPreco.value = precoPromocional > 0 ? precoPromocional.toFixed(2) : "0";
    }
    promoSincronizando = false;
    atualizarResultado();
  });

  inputPromoPreco?.addEventListener("input", (e) => {
    if (promoSincronizando) return;
    promoSincronizando = true;
    const precoPromocional = Number(e.target.value) || 0;
    const precoSugerido = obterPrecoSugeridoSemPromo();
    if (precoSugerido > 0) {
      const desconto = ((precoSugerido - precoPromocional) / precoSugerido) * 100;
      if (inputPromoDesconto) inputPromoDesconto.value = desconto > 0 ? desconto.toFixed(1) : "0";
    }
    promoSincronizando = false;
    atualizarResultado();
  });

  await loadLojas();
  await loadHistorico();
}

function obterPrecoSugeridoSemPromo() {
  const custoProduto = Number(document.getElementById("calcCustoProduto").value) || 0;
  const custoEmbalagem = Number(document.getElementById("calcCustoEmbalagem").value) || 0;
  const custoOperacional = Number(document.getElementById("calcCustoOperacional").value) || 0;
  const lucroInput = Number(document.getElementById("calcLucro").value) || 0;
  const lucroTipo = document.getElementById("calcLucroTipo").value;

  const custoBase = custoProduto + custoEmbalagem + custoOperacional;
  const lucro = lucroTipo === "percentual" ? custoBase * (lucroInput / 100) : lucroInput;

  const taxaPercentual = Number(document.getElementById("calcTaxaPercentual").value) || 0;
  const taxaFixa = Number(document.getElementById("calcTaxaFixa").value) || 0;

  if (taxaPercentual >= 100) return 0;

  const res = calcularPrecoVenda({ custoProduto, custoEmbalagem, custoOperacional, lucro, taxaPercentual, taxaFixa });
  return res.precoVenda;
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

  // Se já há lojas mas o TikTok Shop (nova loja padrão) não está inserido para esta empresa,
  // fazemos a inserção automática dele.
  const temTikTok = data && data.some(l => l.nome.trim().toLowerCase() === "tiktok shop");
  if (data && data.length > 0 && !temTikTok) {
    const { error: insertError } = await supabaseClient.from("lojas_ecommerce").insert({
      empresa_id: currentEmpresaId,
      nome: 'TikTok Shop',
      taxa_percentual: 12,
      taxa_fixa: 6,
      observacoes: 'Taxa por faixa de preço: até R$49,99 = 16% (sem taxa fixa); a partir de R$50,00 = 12%+R$6,00. Valores já incluem 6% do programa de frete grátis. Ajuste conforme a sua conta.'
    });
    if (!insertError) {
      return loadLojas();
    }
  }

  lojasCache = data || [];
  renderLojaTabs();
  renderLojasTable();
  populateFiltroHistoricoLoja();
}

// Shopee, TikTok Shop, Mercado Livre e Amazon aparecem primeiro (nessa ordem) por padrão;
// qualquer loja extra que você cadastrar entra depois, em ordem alfabética.
const LOJA_TAB_ORDEM_PADRAO = ["shopee", "tiktok shop", "mercado livre", "amazon"];

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

let lojaTabsInicializado = false;

function renderLojaTabs() {
  const container = document.getElementById("lojaTabs");
  if (!container) return;

  const lojasOrdenadas = ordenarLojasParaAbas(lojasCache);
  const abas = [
    ...lojasOrdenadas.map(l => ({ id: l.id, nome: l.nome })),
    { id: "", nome: "Manual" }
  ];

  const comparar = document.getElementById("calcCompararCanais")?.checked || false;
  if (!comparar && selectedLojasIds.length > 1) {
    selectedLojasIds = [selectedLojaId];
  }

  if (!lojaTabsInicializado) {
    lojaTabsInicializado = true;
    const shopee = lojasCache.find(l => l.nome.trim().toLowerCase() === "shopee");
    selectedLojaId = shopee ? shopee.id : (lojasOrdenadas[0]?.id || "");
    selectedLojasIds = [selectedLojaId];
  } else if (!abas.some(a => a.id === selectedLojaId)) {
    selectedLojaId = "";
  }

  container.innerHTML = abas.map(a => {
    const isSelected = comparar ? selectedLojasIds.includes(a.id) : (a.id === selectedLojaId);
    const isActive = a.id === selectedLojaId;

    let btnClass = "btn btn-sm btn-outline-secondary"; // Não selecionado
    if (isActive || (isSelected && comparar)) {
      const nameLower = a.nome.toLowerCase().trim();
      if (nameLower.includes("shopee")) {
        btnClass = "btn btn-sm btn-store-shopee shadow-sm";
      } else if (nameLower.includes("tiktok")) {
        btnClass = "btn btn-sm btn-store-tiktok shadow-sm";
      } else if (nameLower.includes("amazon")) {
        btnClass = "btn btn-sm btn-store-amazon shadow-sm";
      } else if (nameLower.includes("mercado livre") || nameLower.includes("mercado_livre")) {
        btnClass = "btn btn-sm btn-store-mercadolivre shadow-sm";
      } else if (a.id === "") { // Manual
        btnClass = "btn btn-sm btn-store-manual shadow-sm";
      } else {
        btnClass = "btn btn-sm btn-store-generic shadow-sm";
      }

      if (isSelected && !isActive && comparar) {
        btnClass += " opacity-75";
      }
    }

    return `
      <button type="button" class="${btnClass} py-1.5 px-3 rounded-pill fw-semibold" data-loja-id="${a.id}" style="transition: all 0.2s; font-size: 0.8rem;">
        ${escapeHtml(a.nome)}
      </button>
    `;
  }).join("");

  // Vincula os listeners de click nos botões para a seleção
  container.querySelectorAll("button[data-loja-id]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const id = e.currentTarget.dataset.lojaId;

      if (!comparar) {
        // Seleção simples (padrão): apenas um ativo por vez
        selectedLojaId = id;
        selectedLojasIds = [id];
      } else {
        // Seleção múltipla (comparação de canais)
        const isSelected = selectedLojasIds.includes(id);
        const isActive = id === selectedLojaId;

        if (!isSelected) {
          selectedLojasIds.push(id);
          selectedLojaId = id;
        } else if (isSelected && !isActive) {
          selectedLojaId = id;
        } else if (isSelected && isActive) {
          selectedLojasIds = selectedLojasIds.filter(x => x !== id);
          if (selectedLojasIds.length > 0) {
            selectedLojaId = selectedLojasIds[selectedLojasIds.length - 1];
          } else {
            selectedLojaId = "";
            selectedLojasIds = [""];
          }
        }
      }

      renderLojaTabs();
      atualizarResultado();
    });
  });

  aplicarTaxaDaLojaSelecionada();
}

const LOJAS_FAIXAS = {
  "shopee": [
    { nome: "Faixa 1 (Até R$79,99)", min: 0, max: 79.99, taxaPercentual: 20, taxaFixa: 4 },
    { nome: "Faixa 2 (R$80,00 a R$99,99)", min: 80.00, max: 99.99, taxaPercentual: 14, taxaFixa: 16 },
    { nome: "Faixa 3 (R$100,00 a R$199,99)", min: 100.00, max: 199.99, taxaPercentual: 14, taxaFixa: 20 },
    { nome: "Faixa 4 (A partir de R$200,00)", min: 200.00, max: Infinity, taxaPercentual: 14, taxaFixa: 26 }
  ],
  "tiktok shop": [
    { nome: "Faixa 1 (Até R$49,99)", min: 0, max: 49.99, taxaPercentual: 10, taxaFixa: 4 },
    { nome: "Faixa 2 (A partir de R$50,00)", min: 50.00, max: Infinity, taxaPercentual: 6, taxaFixa: 6 }
  ],
  "mercado livre": [
    { nome: "Faixa 1 (Até R$78,99)", min: 0, max: 78.99, taxaPercentual: 12, taxaFixa: 6 },
    { nome: "Faixa 2 (A partir de R$79,00)", min: 79.00, max: Infinity, taxaPercentual: 12, taxaFixa: 0 }
  ]
};

function obterFaixaConsistente(lojaNome, custoTotal) {
  const faixas = LOJAS_FAIXAS[lojaNome.trim().toLowerCase()];
  if (!faixas) return null;

  for (const f of faixas) {
    const t = f.taxaPercentual / 100;
    const p = (custoTotal + f.taxaFixa) / (1 - t);
    if (p >= f.min && p <= f.max) {
      return f;
    }
  }
  return faixas[0]; // Retorna a faixa 1 de preferência
}

function renderFaixas(lojaNome, faixaAtiva) {
  const container = document.getElementById("lojaFaixasContainer");
  if (!container) return;

  const faixas = LOJAS_FAIXAS[lojaNome.trim().toLowerCase()];
  if (!faixas) {
    container.innerHTML = `
      <div class="d-flex flex-column justify-content-center h-100 text-muted small py-2" style="min-height: 95px;">
        <span class="opacity-75"><i class="bi bi-info-circle me-1"></i> Esta loja não possui faixas de comissão baseadas em preço. As taxas configuradas são fixas.</span>
      </div>
    `;
    return;
  }
  
  const faixasHtml = faixas.map((f, idx) => {
    const isActive = faixaAtiva && faixaAtiva.nome === f.nome;
    return `
      <button type="button" 
              class="btn btn-sm faixas-item-btn py-1 px-2 text-start d-flex flex-column ${isActive ? 'active' : ''}" 
              style="font-size: 0.75rem; min-width: 120px;" 
              data-faixa-idx="${idx}">
        <span class="fw-semibold text-nowrap">${escapeHtml(f.nome)}</span>
        <span class="small opacity-75">${f.taxaPercentual}% + ${formatCurrency(f.taxaFixa)}</span>
      </button>
    `;
  }).join("");

  container.innerHTML = `
    <div class="d-flex flex-column gap-1">
      <span class="text-muted small fw-semibold">Faixas recomendadas (clique para fixar):</span>
      <div class="d-flex flex-wrap gap-2 mt-1">
        ${faixasHtml}
      </div>
    </div>
  `;

  container.querySelectorAll("[data-faixa-idx]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const idx = Number(e.currentTarget.dataset.faixaIdx);
      const f = faixas[idx];
      if (f) {
        const autoCheckbox = document.getElementById("calcAutoAjustarTaxa");
        if (autoCheckbox) autoCheckbox.checked = false;
        
        document.getElementById("calcTaxaPercentual").value = f.taxaPercentual;
        document.getElementById("calcTaxaFixa").value = f.taxaFixa;
        
        atualizarResultado(f);
      }
    });
  });
}

function aplicarTaxaDaLojaSelecionada() {
  const loja = lojasCache.find(l => l.id === selectedLojaId);
  const lojaNome = loja ? loja.nome : "Manual";

  // Se a loja tem faixas de preço, marca o checkbox de ajuste automático por padrão
  const faixas = LOJAS_FAIXAS[lojaNome.trim().toLowerCase()];
  const autoCheckbox = document.getElementById("calcAutoAjustarTaxa");
  if (autoCheckbox) {
    autoCheckbox.checked = !!faixas;
  }

  if (loja) {
    document.getElementById("calcTaxaPercentual").value = loja.taxa_percentual;
    document.getElementById("calcTaxaFixa").value = loja.taxa_fixa;
  } else {
    document.getElementById("calcTaxaPercentual").value = 0;
    document.getElementById("calcTaxaFixa").value = 0;
  }
  document.getElementById("calcLojaId").value = selectedLojaId;
}


function renderLojasTable() {
  const tbody = document.getElementById("lojasTableBody");
  tbody.innerHTML = "";

  if (lojasCache.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Nenhuma loja cadastrada ainda.</td></tr>';
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
    const atualizadoTexto = formatTimestamp(atualizadoEm);

    // data-label alimenta o rótulo de cada campo quando a tabela vira "cards"
    // empilhados no mobile (.table-stack-mobile, ver css/style.css) — no
    // desktop esses atributos não fazem nada, a tabela renderiza normal.
    tr.innerHTML = `
      <td data-label="Nome">${escapeHtml(l.nome)}</td>
      <td data-label="Taxa %">${Number(l.taxa_percentual).toFixed(2)}%</td>
      <td data-label="Taxa fixa (R$)">${formatCurrency(l.taxa_fixa)}</td>
      <td class="small text-muted td-stack-full" data-label="Observações">${escapeHtml(l.observacoes || "—")}</td>
      <td class="small ${desatualizada ? "text-danger" : "text-muted"}" data-label="Atualizado em">
        ${atualizadoTexto}
        ${desatualizada ? '<br><i class="bi bi-exclamation-triangle-fill"></i> revisar taxa' : ""}
      </td>
      <td class="text-end text-nowrap" data-label="Ações">
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
function atualizarResultado(faixaForcada) {
  const activeEl = document.activeElement;
  const autoCheckbox = document.getElementById("calcAutoAjustarTaxa");
  
  if (activeEl && (activeEl.id === "calcTaxaPercentual" || activeEl.id === "calcTaxaFixa")) {
    if (autoCheckbox) autoCheckbox.checked = false;
  }

  const custoProduto = Number(document.getElementById("calcCustoProduto").value) || 0;
  const custoEmbalagem = Number(document.getElementById("calcCustoEmbalagem").value) || 0;
  const custoOperacional = Number(document.getElementById("calcCustoOperacional").value) || 0;
  const lucroInput = Number(document.getElementById("calcLucro").value) || 0;
  const lucroTipo = document.getElementById("calcLucroTipo").value;

  // Lucro em % incide sobre o custo do produto + embalagem + operacional.
  const custoBase = custoProduto + custoEmbalagem + custoOperacional;
  const lucro = lucroTipo === "percentual" ? custoBase * (lucroInput / 100) : lucroInput;
  const custoTotal = custoBase + lucro;

  const loja = lojasCache.find(l => l.id === selectedLojaId);
  const lojaNome = loja ? loja.nome : "Manual";

  let faixaAtiva = null;

  if (faixaForcada) {
    faixaAtiva = faixaForcada;
  } else if (autoCheckbox && autoCheckbox.checked) {
    faixaAtiva = obterFaixaConsistente(lojaNome, custoTotal);
    if (faixaAtiva) {
      document.getElementById("calcTaxaPercentual").value = faixaAtiva.taxaPercentual;
      document.getElementById("calcTaxaFixa").value = faixaAtiva.taxaFixa;
    }
  } else {
    // Se não for forçada e o auto ajuste estiver desmarcado, tenta identificar se a taxa atual
    // equivale a alguma faixa para destacá-la visualmente
    const currentPct = Number(document.getElementById("calcTaxaPercentual").value) || 0;
    const currentFixa = Number(document.getElementById("calcTaxaFixa").value) || 0;
    const faixas = LOJAS_FAIXAS[lojaNome.trim().toLowerCase()];
    if (faixas) {
      faixaAtiva = faixas.find(f => Math.abs(f.taxaPercentual - currentPct) < 0.01 && Math.abs(f.taxaFixa - currentFixa) < 0.01);
    }
  }

  const taxaPercentual = Number(document.getElementById("calcTaxaPercentual").value) || 0;
  const taxaFixa = Number(document.getElementById("calcTaxaFixa").value) || 0;

  if (taxaPercentual >= 100) {
    showToast("A taxa percentual da loja precisa ser menor que 100%.", "error");
    return;
  }

  const resultado = calcularPrecoVenda({ custoProduto, custoEmbalagem, custoOperacional, lucro, taxaPercentual, taxaFixa });

  const simularPromo = document.getElementById("calcSimularPromo")?.checked || false;
  const precoPromocional = Number(document.getElementById("calcPromoPreco")?.value) || 0;
  
  let resultadoFinal = { ...resultado };
  let lucroFinal = lucro;
  let liquidoFinal = resultado.liquido;

  if (simularPromo && precoPromocional > 0) {
    const valorTaxaPercentual = precoPromocional * (taxaPercentual / 100);
    const liquidoPromo = precoPromocional - valorTaxaPercentual - taxaFixa - custoEmbalagem - custoOperacional;
    const lucroPromo = liquidoPromo - custoProduto;
    
    resultadoFinal.precoVenda = precoPromocional;
    resultadoFinal.valorTaxaPercentual = valorTaxaPercentual;
    liquidoFinal = liquidoPromo;
    lucroFinal = lucroPromo;
  }

  // Preenche os campos do card de resultados
  const resPrecoVendaEl = document.getElementById("resPrecoVenda");
  if (simularPromo && precoPromocional > 0) {
    const descontoVal = Number(document.getElementById("calcPromoDesconto")?.value) || 0;
    resPrecoVendaEl.innerHTML = `<span class="text-muted text-decoration-line-through small me-1">${formatCurrency(resultado.precoVenda)}</span> <span class="text-danger fw-bold">${formatCurrency(precoPromocional)}</span> <span class="badge bg-danger-subtle text-danger ms-1" style="font-size: 0.65rem;">${descontoVal.toFixed(1)}% OFF</span>`;
  } else {
    resPrecoVendaEl.innerHTML = `<span>${formatCurrency(resultado.precoVenda)}</span>`;
  }

  document.getElementById("resCustoProduto").textContent = formatCurrency(custoProduto);
  document.getElementById("resEmbalagem").textContent = formatCurrency(custoEmbalagem);
  document.getElementById("resOperacional").textContent = formatCurrency(custoOperacional);

  const resLucroEl = document.getElementById("resLucro");
  const resLucroBox = document.getElementById("resLucroBox");
  const margemLiquida = resultadoFinal.precoVenda > 0 ? (lucroFinal / resultadoFinal.precoVenda) * 100 : 0;
  const isPrejuizo = lucroFinal < 0;
  const colorClass = isPrejuizo ? "text-danger" : "text-success";

  if (resLucroBox) {
    if (isPrejuizo) {
      resLucroBox.classList.add("sa-lucro-prejuizo");
    } else {
      resLucroBox.classList.remove("sa-lucro-prejuizo");
    }
  }

  if (simularPromo && precoPromocional > 0) {
    const originalLucroText = lucroTipo === "percentual" ? `${lucroInput.toFixed(2)}% (${formatCurrency(lucro)})` : formatCurrency(lucro);
    resLucroEl.innerHTML = `<span class="text-muted text-decoration-line-through me-1">${originalLucroText}</span> <span class="${colorClass} fw-semibold">${formatCurrency(lucroFinal)} (Margem: ${margemLiquida.toFixed(1)}%)</span>`;
  } else {
    resLucroEl.innerHTML = `<span class="${colorClass} fw-semibold">${formatCurrency(lucroFinal)} (Margem: ${margemLiquida.toFixed(1)}%)</span>`;
  }

  document.getElementById("resTaxaFixa").textContent = formatCurrency(taxaFixa);
  document.getElementById("resTaxaPercentual").textContent = `${taxaPercentual.toFixed(2)}% (${formatCurrency(resultadoFinal.valorTaxaPercentual)})`;

  const resLiquidoEl = document.getElementById("resLiquido");
  if (simularPromo && precoPromocional > 0) {
    resLiquidoEl.innerHTML = `<span class="text-muted text-decoration-line-through me-1">${formatCurrency(resultado.liquido)}</span> <span class="fw-bold">${formatCurrency(liquidoFinal)}</span>`;
  } else {
    resLiquidoEl.innerHTML = `<span>${formatCurrency(resultado.liquido)}</span>`;
  }

  // Verifica se o lucro promocional gerou prejuízo e exibe alerta no compWrapper
  const precoReferencia = Number(document.getElementById("calcPrecoReferencia").value) || 0;
  const compWrapper = document.getElementById("comparacaoPrecoWrapper");
  
  if (compWrapper) {
    if (simularPromo && precoPromocional > 0 && lucroFinal < 0) {
      compWrapper.innerHTML = `
        <div class="d-flex align-items-center justify-content-between text-danger">
          <span class="small fw-semibold"><i class="bi bi-exclamation-triangle-fill me-1"></i> Atenção: Prejuízo Detectado!</span>
        </div>
        <div class="mt-2 small text-danger fw-semibold">
          Esta promoção resulta em um prejuízo de ${formatCurrency(Math.abs(lucroFinal))} por unidade vendida!
        </div>
        <div class="mt-1 small text-muted">
          Ajuste o valor promocional ou o desconto para manter a saúde financeira.
        </div>
      `;
      compWrapper.style.backgroundColor = "rgba(220, 38, 38, 0.05)";
      compWrapper.style.borderColor = "rgba(220, 38, 38, 0.2)";
    } else {
      compWrapper.style.backgroundColor = "";
      compWrapper.style.borderColor = "";
      
      if (precoReferencia > 0) {
        const precoVenda = resultadoFinal.precoVenda;
        const diff = precoVenda - precoReferencia;
        const diffPercent = (diff / precoReferencia) * 100;
        
        let badgeClass = "";
        let badgeText = "";
        let descText = "";
        
        if (diff < -0.01) {
          badgeClass = "bg-success";
          badgeText = "Abaixo da Referência";
          descText = `Seu preço está <strong class="text-success">${formatCurrency(Math.abs(diff))} mais barato</strong> (${diffPercent.toFixed(1)}%) em relação ao concorrente.`;
        } else if (Math.abs(diff) <= 0.01) {
          badgeClass = "bg-warning text-dark";
          badgeText = "Igual à Referência";
          descText = `Seu preço está <strong>exatamente igual</strong> ao preço do concorrente.`;
        } else {
          badgeClass = "bg-danger";
          badgeText = "Acima da Referência";
          descText = `Seu preço está <strong class="text-danger">${formatCurrency(diff)} mais caro</strong> (+${diffPercent.toFixed(1)}%) que o concorrente.`;
        }
        
        compWrapper.innerHTML = `
          <div class="d-flex align-items-center justify-content-between">
            <span class="small fw-semibold text-muted">Comparação (Canal Ativo)</span>
            <span class="badge ${badgeClass}">${badgeText}</span>
          </div>
          <div class="mt-2 small text-secondary">
            Preço concorrente: <strong class="text-dark">${formatCurrency(precoReferencia)}</strong>
          </div>
          <div class="mt-1 small text-secondary">
            ${descText}
          </div>
        `;
      } else {
        compWrapper.innerHTML = `
          <div class="text-center text-muted py-2 small">
            <i class="bi bi-info-circle me-1"></i> Preencha o "Preço de referência" para comparar a competitividade do seu preço sugerido.
          </div>
        `;
      }
    }
  }

  // --- COMPARAÇÃO MULTICANAL ---
  const obterCalculoParaLoja = (id) => {
    const l = id ? lojasCache.find(x => x.id === id) : null;
    const name = l ? l.nome : "Manual";
    
    let pct = 0;
    let fix = 0;
    
    if (id) {
      if (autoCheckbox && autoCheckbox.checked) {
        const faixa = obterFaixaConsistente(name, custoTotal);
        pct = faixa ? faixa.taxaPercentual : l.taxa_percentual;
        fix = faixa ? faixa.taxaFixa : l.taxa_fixa;
      } else {
        if (id === selectedLojaId) {
          pct = taxaPercentual;
          fix = taxaFixa;
        } else {
          pct = l.taxa_percentual;
          fix = l.taxa_fixa;
        }
      }
    } else {
      pct = taxaPercentual;
      fix = taxaFixa;
    }
    
    return calcularPrecoVenda({ custoProduto, custoEmbalagem, custoOperacional, lucro, taxaPercentual: pct, taxaFixa: fix });
  };

  const multiWrapper = document.getElementById("resultadoMultiploWrapper");
  const multiTbody = document.getElementById("resultadoMultiploTableBody");
  
  if (selectedLojasIds.length > 1) {
    multiWrapper.classList.remove("d-none");
    multiTbody.innerHTML = "";
    
    selectedLojasIds.forEach(id => {
      const l = id ? lojasCache.find(x => x.id === id) : null;
      const nomeLoja = l ? l.nome : "Manual";
      const res = obterCalculoParaLoja(id);
      
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="fw-semibold">${escapeHtml(nomeLoja)}</td>
        <td class="text-end fw-bold text-primary">${formatCurrency(res.precoVenda)}</td>
        <td class="text-end text-success">${formatCurrency(lucro)}</td>
        <td class="text-end">${formatCurrency(res.liquido)}</td>
      `;
      multiTbody.appendChild(tr);
    });
  } else {
    multiWrapper.classList.add("d-none");
  }

  // Prepara o array de inserção em lote para o histórico
  const descontoVal = Number(document.getElementById("calcPromoDesconto")?.value) || 0;

  ultimoCalculosArray = selectedLojasIds.map(id => {
    const res = obterCalculoParaLoja(id);
    const l = id ? lojasCache.find(x => x.id === id) : null;
    
    let pct = 0;
    let fix = 0;
    if (id) {
      if (autoCheckbox && autoCheckbox.checked) {
        const faixa = obterFaixaConsistente(l.nome, custoTotal);
        pct = faixa ? faixa.taxaPercentual : l.taxa_percentual;
        fix = faixa ? faixa.taxaFixa : l.taxa_fixa;
      } else {
        pct = id === selectedLojaId ? taxaPercentual : l.taxa_percentual;
        fix = id === selectedLojaId ? taxaFixa : l.taxa_fixa;
      }
    } else {
      pct = taxaPercentual;
      fix = taxaFixa;
    }

    let pPromocional = null;
    if (simularPromo && descontoVal > 0) {
      pPromocional = res.precoVenda * (1 - descontoVal / 100);
    }

    return {
      nome_produto: document.getElementById("calcNomeProduto").value.trim(),
      link_venda: document.getElementById("calcLinkVenda").value.trim() || null,
      link_referencia: document.getElementById("calcLinkReferencia").value.trim() || null,
      preco_referencia: precoReferencia || null,
      loja_id: id || null,
      custo_produto: custoProduto,
      custo_embalagem: custoEmbalagem,
      custo_operacional: custoOperacional,
      lucro_desejado: lucro,
      taxa_percentual_usada: pct,
      taxa_fixa_usada: fix,
      preco_venda: res.precoVenda,
      promo_ativa: simularPromo,
      promo_desconto_percentual: simularPromo ? descontoVal : null,
      preco_promocional: pPromocional
    };
  });

  document.getElementById("salvarCalculoBtn").disabled = false;

  const btnCopiar = document.getElementById("btnCopiarPreco");
  if (btnCopiar) {
    const precoVal = resultado.precoVenda;
    if (precoVal > 0) {
      btnCopiar.classList.remove("d-none");
      btnCopiar.onclick = () => {
        const valToCopy = Number(precoVal).toFixed(2).replace(".", ",");
        navigator.clipboard.writeText(valToCopy).then(() => {
          const icon = btnCopiar.querySelector("i");
          if (icon) {
            icon.className = "bi bi-check-lg text-success";
            setTimeout(() => {
              icon.className = "bi bi-clipboard";
            }, 1500);
          }
        });
      };
    } else {
      btnCopiar.classList.add("d-none");
    }
  }

  // Renderiza as faixas com a faixa atual em destaque
  renderFaixas(lojaNome, faixaAtiva);
}

const calculadoraForm = document.getElementById("calculadoraForm");
if (calculadoraForm) {
  calculadoraForm.addEventListener("submit", (e) => {
    e.preventDefault();
    atualizarResultado();
  });

  // Recalcula em tempo real conforme os campos vão sendo preenchidos.
  calculadoraForm.addEventListener("input", () => atualizarResultado());
  calculadoraForm.addEventListener("change", () => atualizarResultado());
}

document.getElementById("calcAutoAjustarTaxa")?.addEventListener("change", () => {
  if (document.getElementById("calcAutoAjustarTaxa").checked) {
    const loja = lojasCache.find(l => l.id === selectedLojaId);
    if (loja) {
      document.getElementById("calcTaxaPercentual").value = loja.taxa_percentual;
      document.getElementById("calcTaxaFixa").value = loja.taxa_fixa;
    }
  }
  atualizarResultado();
});

document.getElementById("salvarCalculoBtn")?.addEventListener("click", async (e) => {
  if (!ultimoCalculosArray || ultimoCalculosArray.length === 0) return;
  const nomeProduto = document.getElementById("calcNomeProduto").value.trim();
  if (!nomeProduto) {
    showToast("Informe o nome do produto antes de salvar.", "error");
    return;
  }

  const btn = e.currentTarget;
  await withLoadingButton(btn, "Salvando...", async () => {
    // Coleta os componentes da lista com seus respectivos custos
    const rows = document.querySelectorAll("#kitComponentesLista .comp-row");
    const componentes = [];
    rows.forEach(row => {
      const val = row.querySelector(".comp-input-field").value.trim();
      if (val) {
        const badge = row.querySelector(".comp-custo-badge");
        const custo = badge ? Number(badge.dataset.custo) || 0 : 0;
        if (custo > 0) {
          componentes.push(`${val}:${custo.toFixed(2)}`);
        } else {
          componentes.push(val);
        }
      }
    });

    const radioKit = document.getElementById("calcTipoKit");
    let nomeSalvar = nomeProduto;
    if (radioKit && radioKit.checked) {
      if (componentes.length > 0) {
        nomeSalvar = `${nomeProduto}\u200B${componentes.join(" + ")}`;
      } else {
        nomeSalvar = `${nomeProduto}\u200B`;
      }
    }

    const recordsToInsert = ultimoCalculosArray.map(calc => ({
      empresa_id: currentEmpresaId,
      socio_id: currentSocioId,
      ...calc,
      nome_produto: nomeSalvar
    }));

    // Evita duplicados: remove registros anteriores do mesmo produto nas mesmas lojas
    const lojaIdsToSave = recordsToInsert.map(r => r.loja_id);
    const cleanNomeNormalizado = nomeProduto.toLowerCase();
    const { data: existentes } = await supabaseClient
      .from("calculos_preco")
      .select("id, nome_produto, loja_id")
      .eq("empresa_id", currentEmpresaId);

    const idsParaExcluir = (existentes || [])
      .filter(c => {
        const cleanNameExistente = c.nome_produto.split('\u200B')[0].trim().toLowerCase();
        return cleanNameExistente === cleanNomeNormalizado && lojaIdsToSave.includes(c.loja_id);
      })
      .map(c => c.id);

    if (idsParaExcluir.length > 0) {
      const { error: deleteError } = await supabaseClient.from("calculos_preco").delete().in("id", idsParaExcluir);
      if (deleteError) {
        showToast(friendlyErrorMessage(deleteError, "Não foi possível atualizar o cadastro existente."), "error");
        return;
      }
    }

    const { error } = await supabaseClient.from("calculos_preco").insert(recordsToInsert);

    if (error) {
      showToast(friendlyErrorMessage(error, "Não foi possível salvar os cálculos."), "error");
      return;
    }

    showToast(idsParaExcluir.length > 0 ? "Cadastro atualizado no histórico (registro anterior substituído)." : "Cálculo salvo no histórico.");
    btn.disabled = true;
    await loadHistorico();
    atualizarHintProdutoExistente(nomeNormalizado);
  });
});

function populateFiltroHistoricoLoja() {
  const select = document.getElementById("filtroHistoricoLoja");
  if (!select) return;
  const currentVal = select.value;
  select.innerHTML = '<option value="">Todas as lojas</option><option value="manual">Manual</option>';
  lojasCache.forEach(l => {
    const opt = document.createElement("option");
    opt.value = l.id;
    opt.textContent = l.nome;
    select.appendChild(opt);
  });
  select.value = currentVal;
}

async function loadHistorico() {
  tableLoading("historicoTableBody", 5);

  // Carrega o histórico completo (sem filtro de loja) — o filtro é aplicado
  // na renderização. Assim as sugestões do nome do produto e o aviso de
  // duplicado sempre enxergam todos os produtos cadastrados.
  const { data, error } = await supabaseClient
    .from("calculos_preco")
    .select("id, nome_produto, link_venda, link_referencia, preco_referencia, preco_venda, custo_produto, custo_embalagem, custo_operacional, lucro_desejado, taxa_percentual_usada, taxa_fixa_usada, loja_id, created_at, promo_ativa, promo_desconto_percentual, preco_promocional, lojas_ecommerce(id, nome)")
    .eq("empresa_id", currentEmpresaId)
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error) {
    showToast(friendlyErrorMessage(error, "Não foi possível carregar o histórico."), "error");
    return;
  }

  historicoCache = data || [];
  
  // Agrupa os cálculos pelo nome do produto (ignorando espaços e case-sensitive)
  groupedCalculosCache = {};
  historicoCache.forEach(c => {
    const key = c.nome_produto.split('\u200B')[0].trim().toLowerCase();
    if (!groupedCalculosCache[key]) {
      groupedCalculosCache[key] = {
        nome_produto: c.nome_produto,
        created_at: c.created_at,
        items: []
      };
    }
    groupedCalculosCache[key].items.push(c);
    if (new Date(c.created_at) > new Date(groupedCalculosCache[key].created_at)) {
      groupedCalculosCache[key].created_at = c.created_at;
    }
  });

  historicoGruposOrdenados = Object.values(groupedCalculosCache).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  renderHistoricoPagina();
}

function getGruposFiltrados() {
  let grupos = historicoGruposOrdenados;

  // Filtro de loja (client-side): mantém só os itens da loja escolhida em
  // cada grupo, e descarta grupos que ficarem vazios.
  const lojaFiltro = document.getElementById("filtroHistoricoLoja")?.value || "";
  if (lojaFiltro) {
    grupos = grupos
      .map(g => {
        const items = g.items.filter(i => lojaFiltro === "manual" ? !i.loja_id : i.loja_id === lojaFiltro);
        return items.length > 0 ? { ...g, items } : null;
      })
      .filter(Boolean);
  }

  if (filtroApenasKits) {
    grupos = grupos.filter(g => g.nome_produto.endsWith('\u200B'));
  }

  if (historicoBuscaTermo) {
    grupos = grupos.filter(g => g.nome_produto.toLowerCase().includes(historicoBuscaTermo));
  }

  return grupos;
}

function atualizarHintProdutoExistente(termo) {
  const hint = document.getElementById("produtoExistenteHint");
  if (!hint) return;
  if (termo && groupedCalculosCache[termo]) {
    hint.className = "small mt-1 text-warning";
    hint.innerHTML = '<i class="bi bi-exclamation-triangle me-1"></i>Produto já cadastrado no histórico. Ao salvar, o cadastro anterior será substituído.';
  } else {
    hint.className = "small mt-1 d-none";
    hint.innerHTML = "";
  }
}

// Preenche o formulário da calculadora com os dados de um cálculo salvo
function preencherFormularioComCalculo(c) {
  const parts = (c.nome_produto || "").split('\u200B');
  const cleanName = parts[0];
  const componentesStr = parts[1];

  document.getElementById("calcNomeProduto").value = cleanName;
  
  const radioUnitario = document.getElementById("calcTipoUnitario");
  const radioKit = document.getElementById("calcTipoKit");
  const compWrapper = document.getElementById("calcKitComponentesWrapper");
  const lista = document.getElementById("kitComponentesLista");
  if (lista) lista.innerHTML = "";

  if (radioUnitario && radioKit) {
    if ((c.nome_produto || "").includes('\u200B')) {
      radioKit.checked = true;
      compWrapper?.classList.remove("d-none");
      
      if (componentesStr) {
        const partesComponentes = componentesStr.split(/\s*\+\s*/);
        partesComponentes.forEach(part => adicionarLinhaComponente(part));
      } else {
        adicionarLinhaComponente();
        adicionarLinhaComponente();
      }
    } else {
      radioUnitario.checked = true;
      compWrapper?.classList.add("d-none");
    }
  }

  document.getElementById("calcLinkVenda").value = c.link_venda || "";
  document.getElementById("calcLinkReferencia").value = c.link_referencia || "";
  document.getElementById("calcPrecoReferencia").value = c.preco_referencia || "";
  document.getElementById("calcCustoProduto").value = c.custo_produto || 0;
  document.getElementById("calcCustoEmbalagem").value = c.custo_embalagem || 0;
  document.getElementById("calcCustoOperacional").value = c.custo_operacional || 0;

  // Recarrega o lucro como percentual (%) calculando a margem original
  const custoBase = (c.custo_produto || 0) + (c.custo_embalagem || 0) + (c.custo_operacional || 0);
  let lucroPct = 30;
  if (custoBase > 0) {
    lucroPct = Math.round((c.lucro_desejado / custoBase) * 100);
  }
  document.getElementById("calcLucro").value = lucroPct;
  document.getElementById("calcLucroTipo").value = "percentual";

  // Preenche a promoção
  const simularPromoCheckbox = document.getElementById("calcSimularPromo");
  const promoFields = document.getElementById("calcPromoFields");
  const inputPromoDesconto = document.getElementById("calcPromoDesconto");
  const inputPromoPreco = document.getElementById("calcPromoPreco");

  if (c.promo_ativa) {
    if (simularPromoCheckbox) simularPromoCheckbox.checked = true;
    promoFields?.classList.remove("d-none");
    if (inputPromoDesconto) inputPromoDesconto.value = c.promo_desconto_percentual || "";
    if (inputPromoPreco) inputPromoPreco.value = c.preco_promocional || "";
  } else {
    if (simularPromoCheckbox) simularPromoCheckbox.checked = false;
    promoFields?.classList.add("d-none");
    if (inputPromoDesconto) inputPromoDesconto.value = "";
    if (inputPromoPreco) inputPromoPreco.value = "";
  }

  if ((c.nome_produto || "").includes('\u200B')) {
    atualizarKitComponentes();
  }

  atualizarResultado();
}



function renderHistoricoPagina() {
  const gruposFiltrados = getGruposFiltrados();
  const totalItens = gruposFiltrados.length;
  
  // Atualiza o contador de total de produtos
  const contador = document.getElementById("historicoContador");
  if (contador) {
    if (historicoBuscaTermo) {
      contador.textContent = totalItens === 1 ? "1 produto encontrado" : `${totalItens} produtos encontrados`;
    } else {
      contador.textContent = totalItens === 1 ? "1 produto cadastrado" : `${totalItens} produtos cadastrados`;
    }
  }

  const totalPaginas = Math.ceil(totalItens / historicoItensPorPagina) || 1;
  
  // Corrige a página atual se estiver fora do range
  if (historicoPaginaAtual >= totalPaginas) {
    historicoPaginaAtual = totalPaginas - 1;
  }
  if (historicoPaginaAtual < 0) {
    historicoPaginaAtual = 0;
  }

  const inicio = historicoPaginaAtual * historicoItensPorPagina;
  const fim = Math.min(inicio + Number(historicoItensPorPagina), totalItens);

  const tbody = document.getElementById("historicoTableBody");
  tbody.innerHTML = "";

  const paginacaoWrapper = document.getElementById("historicoPaginacaoWrapper");
  const infoPaginacao = document.getElementById("historicoInfoPaginacao");
  const btnAnterior = document.getElementById("btnPaginaAnterior");
  const btnProxima = document.getElementById("btnPaginaProxima");

  if (totalItens === 0) {
    tbody.innerHTML = historicoBuscaTermo
      ? '<tr><td colspan="5" class="table-empty"><i class="bi bi-search fs-4 d-block mb-2"></i>Nenhum produto encontrado para esta busca.</td></tr>'
      : '<tr><td colspan="5" class="table-empty"><i class="bi bi-clock-history fs-4 d-block mb-2"></i>Nenhum cálculo salvo ainda. Calcular sem clicar em "Salvar" não fica registrado aqui.</td></tr>';
    if (paginacaoWrapper) paginacaoWrapper.classList.add("d-none");
    return;
  }

  if (paginacaoWrapper) paginacaoWrapper.classList.remove("d-none");
  if (infoPaginacao) {
    infoPaginacao.textContent = `Exibindo ${inicio + 1}-${fim} de ${totalItens} produto${totalItens === 1 ? "" : "s"} (Página ${historicoPaginaAtual + 1} de ${totalPaginas})`;
  }

  if (btnAnterior) {
    btnAnterior.classList.toggle("disabled", historicoPaginaAtual === 0);
  }
  if (btnProxima) {
    btnProxima.classList.toggle("disabled", historicoPaginaAtual === totalPaginas - 1);
  }

  const itensPagina = gruposFiltrados.slice(inicio, fim);

  itensPagina.forEach(g => {
    const tr = document.createElement("tr");
    tr.style.cursor = "pointer";
    tr.setAttribute("role", "button");
    tr.setAttribute("aria-label", `Ver detalhes do cálculo de ${escapeHtml(g.nome_produto.split('\u200B')[0])}`);
    tr.onclick = () => verCalculoGrupo(g.nome_produto.split('\u200B')[0].trim().toLowerCase());

    // Badges para as lojas calculadas com as cores de marca especificadas
    const storesHtml = g.items.map(item => {
      const storeName = item.lojas_ecommerce?.nome || "Manual";
      const nameLower = storeName.toLowerCase().trim();
      
      let badgeClass = "badge px-2 py-0.5 me-1";
      if (nameLower.includes("shopee")) {
        badgeClass += " badge-store-shopee";
      } else if (nameLower.includes("tiktok")) {
        badgeClass += " badge-store-tiktok";
      } else if (nameLower.includes("amazon")) {
        badgeClass += " badge-store-amazon";
      } else if (nameLower.includes("mercado livre") || nameLower.includes("mercado_livre")) {
        badgeClass += " badge-store-mercadolivre";
      } else if (nameLower.includes("manual")) {
        badgeClass += " badge-store-manual";
      } else {
        badgeClass += " badge-store-generic";
      }
      
      return `<span class="${badgeClass}" style="font-size: 0.65rem;">${escapeHtml(storeName)}</span>`;
    }).join("");

    const hasPromo = g.items.some(item => item.promo_ativa);
    const promoBadgeHtml = hasPromo 
      ? `<span class="badge ms-1" style="background-color: #FEE2E2 !important; color: #EF4444 !important; border: 1px solid #FCA5A5 !important; font-size: 0.6rem;">Promoção</span>` 
      : "";

    // Exibe preços lado a lado
    const pricesHtml = g.items.map(item => {
      const storeName = item.lojas_ecommerce?.nome || "Manual";
      if (item.promo_ativa && item.preco_promocional > 0) {
        return `<span class="text-nowrap"><strong class="text-muted" style="font-size:0.7rem;">${escapeHtml(storeName)}:</strong> <span class="text-decoration-line-through text-muted small me-1">${formatCurrency(item.preco_venda)}</span><span class="text-danger fw-semibold">${formatCurrency(item.preco_promocional)}</span></span>`;
      } else {
        return `<span class="text-nowrap"><strong class="text-muted" style="font-size:0.7rem;">${escapeHtml(storeName)}:</strong> ${formatCurrency(item.preco_venda)}</span>`;
      }
    }).join(" <span class='text-muted mx-1'>|</span> ");

    const parts = g.nome_produto.split('\u200B');
    const cleanName = parts[0];
    const componentesStr = parts[1];
    
    let compHtml = "";
    if (componentesStr) {
      compHtml = `<div class="text-muted small mt-0.5" style="font-size: 0.65rem;">Itens: ${escapeHtml(formatComponentesParaExibicao(componentesStr))}</div>`;
    }

    const mobilePricesHtml = `<div class="d-block d-md-none mt-2 pt-2 border-top border-light" style="border-top-style: dashed !important;">${pricesHtml}</div>`;

    tr.innerHTML = `
      <td>
        <div class="fw-semibold text-dark d-flex align-items-center gap-1">
          <span>${escapeHtml(cleanName)}</span>
          ${promoBadgeHtml}
        </div>
        ${compHtml}
        ${mobilePricesHtml}
      </td>
      <td colspan="2" class="d-none d-md-table-cell"><div class="d-flex flex-wrap py-1">${pricesHtml}</div></td>
      <td class="td-date">${formatTimestamp(g.created_at)}</td>
      <td class="text-end td-actions">
        <button type="button" class="btn btn-sm btn-outline-danger" data-produto="${escapeHtml(g.nome_produto)}" aria-label="Excluir produto ${escapeHtml(cleanName)}" onclick="event.stopPropagation(); excluirCalculoGrupo(this.getAttribute('data-produto'))"><i class="bi bi-trash"></i></button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  animateTableRows(tbody);
}

// Mostra num modal o detalhamento de um produto, alternando entre as lojas calculadas.
function verCalculoGrupo(key) {
  const g = groupedCalculosCache[key];
  if (!g || g.items.length === 0) return;

  const parts = g.nome_produto.split('\u200B');
  const cleanName = parts[0];
  const componentesStr = parts[1];

  document.getElementById("verCalculoTitulo").textContent = cleanName;

  const subtituloEl = document.getElementById("verCalculoSubtitulo");
  if (subtituloEl) {
    if (g.nome_produto.includes('\u200B')) {
      if (componentesStr) {
        subtituloEl.textContent = `Itens: ${formatComponentesParaExibicao(componentesStr)}`;
        subtituloEl.classList.remove("d-none");
      } else {
        subtituloEl.textContent = "Produto cadastrado como Kit";
        subtituloEl.classList.remove("d-none");
      }
    } else {
      subtituloEl.classList.add("d-none");
      subtituloEl.textContent = "";
    }
  }

  const tabsContainer = document.getElementById("verCalculoTabs");
  
  const renderItemDetails = (c) => {
    const isPromo = c.promo_ativa && c.preco_promocional > 0;
    const pVenda = isPromo ? Number(c.preco_promocional) : Number(c.preco_venda);
    const valorTaxaPercentual = pVenda * (Number(c.taxa_percentual_usada) / 100);
    const liquido = pVenda - valorTaxaPercentual - Number(c.taxa_fixa_usada) - Number(c.custo_embalagem) - Number(c.custo_operacional);
    const lucroReal = liquido - Number(c.custo_produto);
    const margemLiquida = pVenda > 0 ? (lucroReal / pVenda) * 100 : 0;
    const isPrejuizo = lucroReal < 0;
    const colorClass = isPrejuizo ? "text-danger" : "text-success";

    const verLucroBox = document.getElementById("verLucroBox");
    if (verLucroBox) {
      if (isPrejuizo) {
        verLucroBox.classList.add("sa-lucro-prejuizo");
      } else {
        verLucroBox.classList.remove("sa-lucro-prejuizo");
      }
    }

    if (isPromo) {
      document.getElementById("verPrecoVenda").innerHTML = `<span class="text-muted text-decoration-line-through small me-1">${formatCurrency(c.preco_venda)}</span> <span class="text-danger fw-bold">${formatCurrency(c.preco_promocional)}</span> <span class="badge bg-danger-subtle text-danger ms-1" style="font-size: 0.65rem;">${Number(c.promo_desconto_percentual).toFixed(1)}% OFF</span>`;
      document.getElementById("verLucro").innerHTML = `<span class="text-muted text-decoration-line-through me-1">${formatCurrency(c.lucro_desejado)}</span> <span class="${colorClass} fw-semibold">${formatCurrency(lucroReal)} (Margem: ${margemLiquida.toFixed(1)}%)</span>`;
      
      const originalLiquido = Number(c.preco_venda) - (Number(c.preco_venda) * (Number(c.taxa_percentual_usada) / 100)) - Number(c.taxa_fixa_usada) - Number(c.custo_embalagem) - Number(c.custo_operacional);
      document.getElementById("verLiquido").innerHTML = `<span class="text-muted text-decoration-line-through me-1">${formatCurrency(originalLiquido)}</span> <span class="fw-bold">${formatCurrency(liquido)}</span>`;
    } else {
      document.getElementById("verPrecoVenda").innerHTML = `<span>${formatCurrency(c.preco_venda)}</span>`;
      document.getElementById("verLucro").innerHTML = `<span class="${colorClass} fw-semibold">${formatCurrency(lucroReal)} (Margem: ${margemLiquida.toFixed(1)}%)</span>`;
      document.getElementById("verLiquido").innerHTML = `<span>${formatCurrency(liquido)}</span>`;
    }

    document.getElementById("verLoja").textContent = c.lojas_ecommerce?.nome || "Manual";
    document.getElementById("verCustoProduto").textContent = formatCurrency(c.custo_produto);
    document.getElementById("verEmbalagem").textContent = formatCurrency(c.custo_embalagem);
    document.getElementById("verOperacional").textContent = formatCurrency(c.custo_operacional);
    document.getElementById("verTaxaFixa").textContent = formatCurrency(c.taxa_fixa_usada);
    document.getElementById("verTaxaPercentual").textContent = `${Number(c.taxa_percentual_usada).toFixed(2)}% (${formatCurrency(valorTaxaPercentual)})`;

    const precoRefRow = document.getElementById("verPrecoReferenciaRow");
    const precoRefVal = document.getElementById("verPrecoReferencia");
    const diffRow = document.getElementById("verDiferencaRow");
    const diffVal = document.getElementById("verDiferenca");

    if (c.preco_referencia && Number(c.preco_referencia) > 0) {
      const pRef = Number(c.preco_referencia);
      const pVenda = Number(c.preco_venda);
      const diff = pVenda - pRef;
      const diffPercent = (diff / pRef) * 100;
      
      precoRefRow.classList.remove("d-none");
      precoRefVal.textContent = formatCurrency(pRef);
      
      diffRow.classList.remove("d-none");
      if (diff < -0.01) {
        diffVal.innerHTML = `<span class="text-success fw-semibold">-${formatCurrency(Math.abs(diff))} (-${Math.abs(diffPercent).toFixed(1)}%)</span>`;
      } else if (Math.abs(diff) <= 0.01) {
        diffVal.innerHTML = `<span class="text-warning fw-semibold">Igual</span>`;
      } else {
        diffVal.innerHTML = `<span class="text-danger fw-semibold">+${formatCurrency(diff)} (+${diffPercent.toFixed(1)}%)</span>`;
      }
    } else {
      precoRefRow.classList.add("d-none");
      diffRow.classList.add("d-none");
    }

    const btnCopiarModal = document.getElementById("btnCopiarPrecoModal");
    if (btnCopiarModal) {
      const precoVal = c.preco_venda;
      if (precoVal > 0) {
        btnCopiarModal.classList.remove("d-none");
        btnCopiarModal.onclick = () => {
          const valToCopy = Number(precoVal).toFixed(2).replace(".", ",");
          navigator.clipboard.writeText(valToCopy).then(() => {
            const icon = btnCopiarModal.querySelector("i");
            if (icon) {
              icon.className = "bi bi-check-lg text-success";
              setTimeout(() => {
                icon.className = "bi bi-clipboard";
              }, 1500);
            }
          });
        };
      } else {
        btnCopiarModal.classList.add("d-none");
      }
    }

    const linksWrapper = document.getElementById("verLinksWrapper");
    linksWrapper.innerHTML = "";
    if (c.link_venda) {
      linksWrapper.innerHTML += `<a href="${escapeHtml(c.link_venda)}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-outline-secondary"><i class="bi bi-box-arrow-up-right me-1"></i>Link de venda</a>`;
    }
    if (c.link_referencia) {
      linksWrapper.innerHTML += `<a href="${escapeHtml(c.link_referencia)}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-outline-secondary"><i class="bi bi-box-arrow-up-right me-1"></i>Link de referência</a>`;
    }

    const btnCopiarComoModelo = document.getElementById("btnCopiarComoModelo");
    if (btnCopiarComoModelo) {
      btnCopiarComoModelo.onclick = () => {
        preencherFormularioComCalculo(c);

        const modalEl = document.getElementById("verCalculoModal");
        const modal = bootstrap.Modal.getInstance(modalEl) || bootstrap.Modal.getOrCreateInstance(modalEl);
        if (modal) modal.hide();

        window.scrollTo({ top: 0, behavior: 'smooth' });
        showToast("Cálculo carregado como modelo! Altere a loja/aba se desejar recalcular.");
      };
    }

    const btnExcluirItem = document.getElementById("btnExcluirItemModal");
    if (btnExcluirItem) {
      btnExcluirItem.onclick = async () => {
        const ok = await confirmDialog(`Excluir a precificação de "${c.nome_produto.replace(/\u200B/g, "")}" para a loja "${c.lojas_ecommerce?.nome || 'Manual'}"?`, { confirmText: "Excluir" });
        if (!ok) return;

        const { error } = await supabaseClient
          .from("calculos_preco")
          .delete()
          .eq("id", c.id);

        if (error) {
          showToast(friendlyErrorMessage(error, "Não foi possível excluir esta precificação."), "error");
          return;
        }
        showToast("Precificação excluída.");
        
        const modalEl = document.getElementById("verCalculoModal");
        const modal = bootstrap.Modal.getInstance(modalEl) || bootstrap.Modal.getOrCreateInstance(modalEl);
        if (modal) modal.hide();

        await loadHistorico();
      };
    }
  };

  if (g.items.length > 1) {
    tabsContainer.classList.remove("d-none");
    tabsContainer.innerHTML = g.items.map((item, idx) => {
      const storeName = item.lojas_ecommerce?.nome || "Manual";
      return `
        <li class="nav-item" role="presentation">
          <button type="button" class="nav-link ${idx === 0 ? "active" : ""}" data-ver-idx="${idx}" style="padding: 4px 8px; font-size: 0.75rem;">
            ${escapeHtml(storeName)}
          </button>
        </li>
      `;
    }).join("");

    tabsContainer.querySelectorAll("button[data-ver-idx]").forEach(btn => {
      btn.onclick = (e) => {
        tabsContainer.querySelectorAll("button").forEach(b => b.classList.remove("active"));
        e.currentTarget.classList.add("active");
        const idx = Number(e.currentTarget.dataset.verIdx);
        renderItemDetails(g.items[idx]);
      };
    });
  } else {
    tabsContainer.classList.add("d-none");
  }

  renderItemDetails(g.items[0]);

  bootstrap.Modal.getOrCreateInstance(document.getElementById("verCalculoModal")).show();
}

async function excluirCalculoGrupo(nomeProduto) {
  const ok = await confirmDialog(`Excluir todos os cálculos do produto "${nomeProduto.replace(/\u200B/g, "")}" do histórico?`, { confirmText: "Excluir" });
  if (!ok) return;

  const { error } = await supabaseClient
    .from("calculos_preco")
    .delete()
    .eq("empresa_id", currentEmpresaId)
    .eq("nome_produto", nomeProduto);

  if (error) {
    showToast(friendlyErrorMessage(error, "Não foi possível excluir o produto."), "error");
    return;
  }
  showToast("Produto excluído do histórico.");
  await loadHistorico();
}

function adicionarLinhaComponente(nomeInicial = "") {
  const lista = document.getElementById("kitComponentesLista");
  if (!lista) return;

  const row = document.createElement("div");
  row.className = "d-flex align-items-center gap-1 position-relative comp-row";
  
  let nome = nomeInicial;
  let custo = 0;
  let custoStr = "";

  const colonIdx = nomeInicial.lastIndexOf(":");
  if (colonIdx !== -1) {
    const possibleCost = nomeInicial.substring(colonIdx + 1).trim();
    if (!isNaN(possibleCost) && possibleCost !== "") {
      nome = nomeInicial.substring(0, colonIdx).trim();
      custo = Number(possibleCost);
      custoStr = `R$ ${custo.toFixed(2).replace(".", ",")}`;
    }
  }

  if (nome && !custoStr) {
    const key = nome.toLowerCase();
    const g = groupedCalculosCache[key];
    if (g && g.items.length > 0) {
      custo = Number(g.items[0].custo_produto) || 0;
      custoStr = `R$ ${custo.toFixed(2).replace(".", ",")}`;
    }
  }

  const badgeText = custoStr || (nome ? "S/ Histórico" : "");
  const badgeClass = nome ? "" : "d-none";

  row.innerHTML = `
    <div class="flex-grow-1 position-relative comp-input-wrapper">
      <input type="text" class="form-control form-control-sm comp-input-field" placeholder="Buscar produto..." autocomplete="off" value="${escapeHtml(nome)}" style="font-size: 0.75rem;">
      <div class="dropdown-menu w-100 shadow-sm comp-sugestoes-box" style="max-height: 150px; overflow-y: auto; font-size: 0.75rem;"></div>
    </div>
    <span class="badge bg-light text-dark border comp-custo-badge ${badgeClass}" data-custo="${custo}" style="height: 24px; font-size: 0.7rem; display: flex; align-items: center; justify-content: center; min-width: 65px; white-space: nowrap;">${badgeText}</span>
    <button type="button" class="btn btn-sm btn-outline-danger py-0 px-2 btn-remover-comp" style="height: 24px; font-size: 0.75rem; line-height: 1.2;">&times;</button>
  `;

  lista.appendChild(row);

  const inputEl = row.querySelector(".comp-input-field");
  const boxEl = row.querySelector(".comp-sugestoes-box");
  const btnRemover = row.querySelector(".btn-remover-comp");

  let timeout;
  inputEl.addEventListener("input", () => {
    const val = inputEl.value.trim();
    const badge = row.querySelector(".comp-custo-badge");
    if (!val) {
      if (badge) {
        badge.dataset.custo = "0";
        badge.textContent = "";
        badge.classList.add("d-none");
      }
    } else {
      if (badge) {
        const key = val.toLowerCase();
        const g = groupedCalculosCache[key];
        if (g && g.items.length > 0) {
          const c = Number(g.items[0].custo_produto) || 0;
          badge.dataset.custo = c;
          badge.textContent = `R$ ${c.toFixed(2).replace(".", ",")}`;
        } else {
          badge.dataset.custo = "0";
          badge.textContent = "S/ Histórico";
        }
        badge.classList.remove("d-none");
      }
    }
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      renderSugestoesComponente(inputEl, boxEl);
    }, 300);
  });

  btnRemover.addEventListener("click", () => {
    row.remove();
    atualizarKitComponentes();
  });
}

function renderSugestoesComponente(inputEl, boxEl) {
  const termo = inputEl.value.trim().toLowerCase();
  
  const cleanTerm = termo.replace(/^(kit\s*-?\s*|combo\s*-?\s*)/i, "").trim().toLowerCase();

  const matches = cleanTerm
    ? historicoGruposOrdenados.filter(g => {
        const nameCleaned = g.nome_produto.replace(/\u200B/g, "").replace(/^(kit\s*-?\s*|combo\s*-?\s*)/i, "").trim().toLowerCase();
        return nameCleaned.includes(cleanTerm);
      }).slice(0, 5)
    : [];

  if (matches.length === 0) {
    boxEl.classList.remove("show");
    boxEl.innerHTML = "";
    return;
  }

  boxEl.innerHTML = matches.map(g => {
    const cleanName = g.nome_produto.replace(/\u200B/g, "");
    return `
      <button type="button" class="dropdown-item py-1 text-truncate" data-sugestao-name="${escapeHtml(cleanName)}">
        ${escapeHtml(cleanName)}
      </button>
    `;
  }).join("");

  boxEl.querySelectorAll("[data-sugestao-name]").forEach(btn => {
    btn.onclick = () => {
      const selectedName = btn.dataset.sugestaoName;
      inputEl.value = selectedName;
      boxEl.classList.remove("show");
      
      const key = selectedName.toLowerCase();
      const g = groupedCalculosCache[key];
      const row = inputEl.closest(".comp-row");
      const badge = row ? row.querySelector(".comp-custo-badge") : null;
      if (badge) {
        if (g && g.items.length > 0) {
          const custo = Number(g.items[0].custo_produto) || 0;
          badge.dataset.custo = custo;
          badge.textContent = `R$ ${custo.toFixed(2).replace(".", ",")}`;
          badge.classList.remove("d-none");
        } else {
          badge.dataset.custo = "0";
          badge.textContent = "S/ Histórico";
          badge.classList.remove("d-none");
        }
      }
      
      atualizarKitComponentes();
    };
  });

  boxEl.classList.add("show");
}

function atualizarKitComponentes() {
  const rows = document.querySelectorAll("#kitComponentesLista .comp-row");
  
  let totalCusto = 0;
  const nomesSelecionados = [];

  rows.forEach(row => {
    const val = row.querySelector(".comp-input-field").value.trim();
    if (val) {
      const badge = row.querySelector(".comp-custo-badge");
      const custo = badge ? Number(badge.dataset.custo) || 0 : 0;
      totalCusto += custo;
      nomesSelecionados.push(val);
    }
  });

  const totalValorEl = document.getElementById("kitTotalizadorValor");
  if (totalValorEl) {
    totalValorEl.textContent = `R$ ${totalCusto.toFixed(2).replace(".", ",")}`;
  }

  const custoProdutoEl = document.getElementById("calcCustoProduto");
  if (custoProdutoEl) {
    custoProdutoEl.value = totalCusto > 0 ? totalCusto.toFixed(2) : "";
    custoProdutoEl.dispatchEvent(new Event("input"));
  }

  if (nomesSelecionados.length > 0) {
    const finalName = nomesSelecionados.join(" + ");
    const inputNome = document.getElementById("calcNomeProduto");
    if (inputNome) {
      inputNome.value = finalName;
      inputNome.dispatchEvent(new Event("input"));
    }
  }
}

function formatComponentesParaExibicao(componentesStr) {
  if (!componentesStr) return "";
  return componentesStr.replace(/:([0-9.]+)/g, (match, p1) => {
    const val = Number(p1);
    return isNaN(val) ? "" : ` (R$ ${val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`;
  });
}

initPrecificacao();
