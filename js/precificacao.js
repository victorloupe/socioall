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

async function initPrecificacao() {
  const ctx = await initAuthenticatedPage('precificacao');
  if (!ctx) return;
  currentEmpresaId = ctx.empresaId;
  currentSocioId = ctx.socioId;

  document.getElementById("filtroHistoricoLoja")?.addEventListener("change", () => {
    historicoPaginaAtual = 0;
    loadHistorico();
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
    const totalPaginas = Math.ceil(historicoGruposOrdenados.length / historicoItensPorPagina);
    if (historicoPaginaAtual < totalPaginas - 1) {
      historicoPaginaAtual++;
      renderHistoricoPagina();
    }
  });

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

  if (!lojaTabsInicializado) {
    lojaTabsInicializado = true;
    const shopee = lojasCache.find(l => l.nome.trim().toLowerCase() === "shopee");
    selectedLojaId = shopee ? shopee.id : (lojasOrdenadas[0]?.id || "");
    selectedLojasIds = [selectedLojaId];
  } else if (!abas.some(a => a.id === selectedLojaId)) {
    selectedLojaId = "";
  }

  container.innerHTML = abas.map(a => {
    const isSelected = selectedLojasIds.includes(a.id);
    const isActive = a.id === selectedLojaId;

    let btnClass = "btn btn-sm btn-outline-secondary"; // Não selecionado
    if (isActive) {
      btnClass = "btn btn-sm btn-primary shadow-sm"; // Selecionado + Focado/Ativo
    } else if (isSelected) {
      btnClass = "btn btn-sm btn-outline-primary bg-primary bg-opacity-10"; // Selecionado mas não focado
    }

    return `
      <button type="button" class="${btnClass} py-1.5 px-3 rounded-pill fw-semibold" data-loja-id="${a.id}" style="transition: all 0.2s; font-size: 0.8rem;">
        ${escapeHtml(a.nome)}
      </button>
    `;
  }).join("");

  // Vincula os listeners de click nos botões para a seleção de dupla ação
  container.querySelectorAll("button[data-loja-id]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const id = e.currentTarget.dataset.lojaId;
      const isSelected = selectedLojasIds.includes(id);
      const isActive = id === selectedLojaId;

      if (!isSelected) {
        // Clica em um cinza: seleciona e foca (fica azul sólido)
        selectedLojasIds.push(id);
        selectedLojaId = id;
      } else if (isSelected && !isActive) {
        // Clica em um azul claro: apenas foca ele (vira azul sólido)
        selectedLojaId = id;
      } else if (isSelected && isActive) {
        // Clica no azul sólido (ativo): desmarca e volta a ficar cinza
        selectedLojasIds = selectedLojasIds.filter(x => x !== id);
        if (selectedLojasIds.length > 0) {
          selectedLojaId = selectedLojasIds[selectedLojasIds.length - 1];
        } else {
          selectedLojaId = "";
          selectedLojasIds = [""];
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
    const atualizadoTexto = atualizadoEm ? formatDate(atualizadoEm.slice(0, 10)) : "—";

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

  document.getElementById("resPrecoVenda").textContent = formatCurrency(resultado.precoVenda);
  document.getElementById("resCustoProduto").textContent = formatCurrency(custoProduto);
  document.getElementById("resEmbalagem").textContent = formatCurrency(custoEmbalagem);
  document.getElementById("resOperacional").textContent = formatCurrency(custoOperacional);
  document.getElementById("resLucro").textContent = lucroTipo === "percentual"
    ? `${lucroInput.toFixed(2)}% (${formatCurrency(lucro)})`
    : formatCurrency(lucro);
  document.getElementById("resTaxaFixa").textContent = formatCurrency(taxaFixa);
  document.getElementById("resTaxaPercentual").textContent = `${taxaPercentual.toFixed(2)}% (${formatCurrency(resultado.valorTaxaPercentual)})`;
  document.getElementById("resLiquido").textContent = formatCurrency(resultado.liquido);

  const precoReferencia = Number(document.getElementById("calcPrecoReferencia").value) || 0;

  // Renderiza a comparação de preços do canal ativo
  const compWrapper = document.getElementById("comparacaoPrecoWrapper");
  if (compWrapper) {
    if (precoReferencia > 0) {
      const precoVenda = resultado.precoVenda;
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
      preco_venda: res.precoVenda
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
    const recordsToInsert = ultimoCalculosArray.map(calc => ({
      empresa_id: currentEmpresaId,
      socio_id: currentSocioId,
      ...calc,
      nome_produto: nomeProduto
    }));

    const { error } = await supabaseClient.from("calculos_preco").insert(recordsToInsert);

    if (error) {
      showToast(friendlyErrorMessage(error, "Não foi possível salvar os cálculos."), "error");
      return;
    }

    showToast("Cálculo salvo no histórico.");
    btn.disabled = true;
    await loadHistorico();
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

  const filterVal = document.getElementById("filtroHistoricoLoja")?.value;
  let query = supabaseClient
    .from("calculos_preco")
    .select("id, nome_produto, link_venda, link_referencia, preco_referencia, preco_venda, custo_produto, custo_embalagem, custo_operacional, lucro_desejado, taxa_percentual_usada, taxa_fixa_usada, created_at, lojas_ecommerce(id, nome)")
    .eq("empresa_id", currentEmpresaId);

  if (filterVal === "manual") {
    query = query.is("loja_id", null);
  } else if (filterVal) {
    query = query.eq("loja_id", filterVal);
  }

  // Busca até 1000 registros para podermos agrupar em memória de forma consistente
  const { data, error } = await query
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
    const key = c.nome_produto.trim().toLowerCase();
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

function renderHistoricoPagina() {
  const totalItens = historicoGruposOrdenados.length;
  
  // Atualiza o contador de total de produtos
  const contador = document.getElementById("historicoContador");
  if (contador) {
    contador.textContent = totalItens === 1 ? "1 produto cadastrado" : `${totalItens} produtos cadastrados`;
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
    tbody.innerHTML = '<tr><td colspan="5" class="table-empty"><i class="bi bi-clock-history fs-4 d-block mb-2"></i>Nenhum cálculo salvo ainda. Calcular sem clicar em "Salvar" não fica registrado aqui.</td></tr>';
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

  const itensPagina = historicoGruposOrdenados.slice(inicio, fim);

  itensPagina.forEach(g => {
    const tr = document.createElement("tr");
    tr.style.cursor = "pointer";
    tr.setAttribute("role", "button");
    tr.setAttribute("aria-label", `Ver detalhes do cálculo de ${escapeHtml(g.nome_produto)}`);
    tr.onclick = () => verCalculoGrupo(g.nome_produto.trim().toLowerCase());

    // Badges para as lojas calculadas
    const storesHtml = g.items.map(item => {
      const storeName = item.lojas_ecommerce?.nome || "Manual";
      return `<span class="badge bg-secondary-subtle text-secondary-emphasis border border-secondary-subtle px-2 py-0.5 me-1" style="font-size: 0.65rem;">${escapeHtml(storeName)}</span>`;
    }).join("");

    // Exibe preços lado a lado
    const pricesHtml = g.items.map(item => {
      const storeName = item.lojas_ecommerce?.nome || "Manual";
      return `<span class="text-nowrap"><strong class="text-muted" style="font-size:0.7rem;">${escapeHtml(storeName)}:</strong> ${formatCurrency(item.preco_venda)}</span>`;
    }).join(" <span class='text-muted mx-1'>|</span> ");

    tr.innerHTML = `
      <td>
        <div class="fw-semibold text-dark">${escapeHtml(g.nome_produto)}</div>
        <div class="mt-1 d-flex flex-wrap align-items-center gap-1">${storesHtml}</div>
      </td>
      <td colspan="2"><div class="d-flex flex-wrap py-1">${pricesHtml}</div></td>
      <td>${formatDate(g.created_at.slice(0, 10))}</td>
      <td class="text-end">
        <button type="button" class="btn btn-sm btn-outline-danger" aria-label="Excluir produto ${escapeHtml(g.nome_produto)}" onclick="event.stopPropagation(); excluirCalculoGrupo('${escapeHtml(g.nome_produto)}')"><i class="bi bi-trash"></i></button>
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

  document.getElementById("verCalculoTitulo").textContent = g.nome_produto;

  const tabsContainer = document.getElementById("verCalculoTabs");
  
  const renderItemDetails = (c) => {
    document.getElementById("verPrecoVenda").textContent = formatCurrency(c.preco_venda);
    document.getElementById("verLoja").textContent = c.lojas_ecommerce?.nome || "Manual";
    document.getElementById("verCustoProduto").textContent = formatCurrency(c.custo_produto);
    document.getElementById("verEmbalagem").textContent = formatCurrency(c.custo_embalagem);
    document.getElementById("verOperacional").textContent = formatCurrency(c.custo_operacional);
    document.getElementById("verLucro").textContent = formatCurrency(c.lucro_desejado);
    document.getElementById("verTaxaFixa").textContent = formatCurrency(c.taxa_fixa_usada);
    document.getElementById("verTaxaPercentual").textContent = `${Number(c.taxa_percentual_usada).toFixed(2)}%`;

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
        document.getElementById("calcNomeProduto").value = c.nome_produto || "";
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

        const modalEl = document.getElementById("verCalculoModal");
        const modal = bootstrap.Modal.getInstance(modalEl) || bootstrap.Modal.getOrCreateInstance(modalEl);
        if (modal) modal.hide();

        atualizarResultado();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        showToast("Cálculo carregado como modelo! Altere a loja/aba se desejar recalcular.");
      };
    }

    const btnExcluirItem = document.getElementById("btnExcluirItemModal");
    if (btnExcluirItem) {
      btnExcluirItem.onclick = async () => {
        const ok = await confirmDialog(`Excluir a precificação de "${c.nome_produto}" para a loja "${c.lojas_ecommerce?.nome || 'Manual'}"?`, { confirmText: "Excluir" });
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
  const ok = await confirmDialog(`Excluir todos os cálculos do produto "${nomeProduto}" do histórico?`, { confirmText: "Excluir" });
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

initPrecificacao();
