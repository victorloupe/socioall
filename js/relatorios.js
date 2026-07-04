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

  if (!lancamentos || lancamentos.length === 0) {
    showToast("Nenhum lançamento para exportar com esse filtro.", "warning");
    return;
  }

  const rows = [["Data", "Descrição", "Tipo", "Sócio", "Valor"]];
  lancamentos.forEach(l => {
    rows.push([
      formatDate(l.data),
      l.descricao,
      l.tipo,
      l.socios?.nome || "—",
      formatCurrency(l.valor)
    ]);
  });

  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "extrato-socioall.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// Mesmo filtro do CSV, mas em PDF (jsPDF + autoTable, carregados via CDN) —
// útil para anexar num e-mail ou imprimir, coisa que um CSV não cobre bem.
async function exportarPDF() {
  if (typeof window.jspdf === "undefined") {
    showToast("Não foi possível carregar o gerador de PDF. Recarregue a página e tente de novo.", "error");
    return;
  }

  const { data: lancamentos, error } = await buildQuery({ paginate: false });

  if (error) {
    showToast(friendlyErrorMessage(error, "Não foi possível exportar o PDF."), "error");
    return;
  }

  if (!lancamentos || lancamentos.length === 0) {
    showToast("Nenhum lançamento para exportar com esse filtro.", "warning");
    return;
  }

  const dataInicio = document.getElementById("filtroDataInicio").value;
  const dataFim = document.getElementById("filtroDataFim").value;
  const tipo = document.getElementById("filtroTipo").value;

  let totalReceitas = 0;
  let totalDespesas = 0;
  lancamentos.forEach(l => {
    if (l.tipo === "receita") totalReceitas += Number(l.valor);
    else totalDespesas += Number(l.valor);
  });

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  doc.setFontSize(14);
  doc.text("SócioAll — Extrato de lançamentos", 14, 16);

  doc.setFontSize(9);
  doc.setTextColor(100);
  const periodoTexto = (dataInicio || dataFim)
    ? `Período: ${dataInicio ? formatDate(dataInicio) : "início"} até ${dataFim ? formatDate(dataFim) : "hoje"}`
    : "Período: todos os lançamentos";
  const tipoTexto = tipo ? `Tipo: ${tipo}` : "Tipo: todos";
  doc.text(`${periodoTexto}  |  ${tipoTexto}`, 14, 22);
  doc.text(`Gerado em ${new Date().toLocaleString("pt-BR")}`, 14, 27);

  doc.autoTable({
    startY: 33,
    head: [["Data", "Descrição", "Tipo", "Sócio", "Valor"]],
    body: lancamentos.map(l => [
      formatDate(l.data),
      l.descricao,
      l.tipo,
      l.socios?.nome || "—",
      formatCurrency(l.valor)
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [15, 76, 92] }
  });

  const finalY = doc.lastAutoTable.finalY + 8;
  doc.setFontSize(10);
  doc.setTextColor(0);
  doc.text(`Total receitas: ${formatCurrency(totalReceitas)}`, 14, finalY);
  doc.text(`Total despesas: ${formatCurrency(totalDespesas)}`, 14, finalY + 6);
  doc.text(`Saldo do período: ${formatCurrency(totalReceitas - totalDespesas)}`, 14, finalY + 12);

  doc.save("extrato-socioall.pdf");
}

initRelatorios();
