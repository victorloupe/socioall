let currentEmpresaId = null;

const PAGE_SIZE = 25;
let currentPage = 0;
let totalFiltrado = 0;

// Cache do resumo (totais do filtro atual) para não recalcular a cada troca de
// página — só é refeito quando o formulário de filtro é submetido de novo ou no
// carregamento inicial (ver loadRelatorio/loadResumo abaixo).
let resumoCache = null;

async function initRelatorios() {
  const ctx = await initAuthenticatedPage('relatorios');
  if (!ctx) return;
  currentEmpresaId = ctx.empresaId;

  await loadRelatorio({ recalcularResumo: true });
}

function buildQuery({ paginate }) {
  const dataInicio = document.getElementById("filtroDataInicio").value;
  const dataFim = document.getElementById("filtroDataFim").value;
  const tipo = document.getElementById("filtroTipo").value;

  let query = supabaseClient
    .from("lancamentos")
    .select("data, descricao, tipo, valor, socios(nome)", { count: paginate ? "exact" : undefined })
    .eq("empresa_id", currentEmpresaId)
    .order("data", { ascending: false });

  if (dataInicio) query = query.gte("data", dataInicio);
  if (dataFim) query = query.lte("data", dataFim);
  if (tipo) query = query.eq("tipo", tipo);

  if (paginate) {
    const from = currentPage * PAGE_SIZE;
    query = query.range(from, from + PAGE_SIZE - 1);
  }

  return query;
}

async function loadRelatorio({ recalcularResumo = false } = {}) {
  tableLoading("relatorioTableBody", 5);

  const { data: lancamentos, count, error } = await buildQuery({ paginate: true });

  if (error) {
    showToast(friendlyErrorMessage(error, "Não foi possível carregar o relatório."), "error");
    return;
  }

  totalFiltrado = count || 0;

  const tbody = document.getElementById("relatorioTableBody");
  tbody.innerHTML = "";

  if (!lancamentos || lancamentos.length === 0) {
    tbody.innerHTML = '<tr class="table-empty-row"><td colspan="5" class="table-empty"><i class="bi bi-search fs-4 d-block mb-2"></i>Nenhum lançamento encontrado para esse filtro.</td></tr>';
  }

  (lancamentos || []).forEach(l => {
    const badgeClass = l.tipo === "receita" ? "badge-receita" : "badge-despesa";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${formatDate(l.data)}</td>
      <td>${escapeHtml(l.descricao)}</td>
      <td><span class="badge ${badgeClass}">${l.tipo}</span></td>
      <td>${escapeHtml(l.socios?.nome || "—")}</td>
      <td>${formatCurrency(l.valor)}</td>
    `;
    tbody.appendChild(tr);
  });

  animateTableRows(tbody);
  renderPagination();

  // Os totais do período consideram TODOS os lançamentos filtrados, não só a
  // página atual — por isso são caros (buscam a tabela inteira sem paginação).
  // Só recalculamos no carregamento inicial ou quando o filtro muda; ao trocar
  // de página do mesmo filtro, reaproveitamos o resultado já calculado.
  if (recalcularResumo || !resumoCache) {
    await loadResumo();
  } else {
    renderResumo(resumoCache);
  }
}

async function loadResumo() {
  const { data: todos, error } = await buildQuery({ paginate: false });

  let totalReceitas = 0;
  let totalDespesas = 0;

  if (!error) {
    (todos || []).forEach(l => {
      if (l.tipo === "receita") totalReceitas += Number(l.valor);
      else totalDespesas += Number(l.valor);
    });
  }

  resumoCache = { totalReceitas, totalDespesas };
  renderResumo(resumoCache);
}

function renderResumo({ totalReceitas, totalDespesas }) {
  document.getElementById("resumoReceitas").textContent = formatCurrency(totalReceitas);
  document.getElementById("resumoDespesas").textContent = formatCurrency(totalDespesas);
  document.getElementById("resumoLucro").textContent = formatCurrency(totalReceitas - totalDespesas);
}

function renderPagination() {
  const totalPages = Math.max(1, Math.ceil(totalFiltrado / PAGE_SIZE));
  const info = document.getElementById("relatorioPageInfo");
  if (info) {
    info.textContent = totalFiltrado === 0
      ? "Nenhum lançamento"
      : `Página ${currentPage + 1} de ${totalPages} — ${totalFiltrado} lançamento(s)`;
  }
  const prevBtn = document.getElementById("relatorioPrevBtn");
  const nextBtn = document.getElementById("relatorioNextBtn");
  if (prevBtn) prevBtn.disabled = currentPage === 0;
  if (nextBtn) nextBtn.disabled = currentPage >= totalPages - 1;
}

document.getElementById("relatorioPrevBtn")?.addEventListener("click", () => {
  if (currentPage > 0) {
    currentPage--;
    loadRelatorio();
  }
});

document.getElementById("relatorioNextBtn")?.addEventListener("click", () => {
  const totalPages = Math.max(1, Math.ceil(totalFiltrado / PAGE_SIZE));
  if (currentPage < totalPages - 1) {
    currentPage++;
    loadRelatorio();
  }
});

document.getElementById("filtroForm").addEventListener("submit", (e) => {
  e.preventDefault();
  currentPage = 0;
  loadRelatorio({ recalcularResumo: true });
});

// Exporta TODOS os lançamentos que batem com o filtro atual (não só a página visível).
async function exportarCSV() {
  const { data: lancamentos, error } = await buildQuery({ paginate: false });

  if (error) {
    showToast(friendlyErrorMessage(error, "Não foi possível exportar o CSV."), "error");
    return;
  }

  if (!lancament