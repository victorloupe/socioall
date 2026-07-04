async function initDashboard() {
  const ctx = await initAuthenticatedPage('dashboard');
  if (!ctx) return;

  tableLoading("divisaoTableBody", 3);

  const { data: lancamentos, error: lancamentosError } = await supabaseClient
    .from("lancamentos")
    .select("tipo, valor, data")
    .eq("empresa_id", ctx.empresaId);

  if (lancamentosError) {
    showToast(friendlyErrorMessage(lancamentosError, "Não foi possível carregar os lançamentos."), "error");
  }

  const receitas = (lancamentos || []).filter(l => l.tipo === "receita").reduce((s, l) => s + Number(l.valor), 0);
  const despesas = (lancamentos || []).filter(l => l.tipo === "despesa").reduce((s, l) => s + Number(l.valor), 0);
  const lucro = receitas - despesas;

  document.getElementById("totalReceitas").textContent = formatCurrency(receitas);
  document.getElementById("totalDespesas").textContent = formatCurrency(despesas);
  const lucroEl = document.getElementById("totalLucro");
  lucroEl.textContent = formatCurrency(lucro);
  lucroEl.classList.add(lucro >= 0 ? "value-positive" : "value-negative");

  renderEvolucaoChart(lancamentos || []);

  const { data: socios, error: sociosError } = await supabaseClient
    .from("socios")
    .select("nome, percentual")
    .eq("empresa_id", ctx.empresaId);

  if (sociosError) {
    showToast(friendlyErrorMessage(sociosError, "Não foi possível carregar os sócios."), "error");
  }

  renderDivisaoTable(socios || [], lucro);
}

function renderDivisaoTable(socios, lucro) {
  const tbody = document.getElementById("divisaoTableBody");
  tbody.innerHTML = "";

  if (!socios || socios.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="table-empty">Nenhum sócio cadastrado ainda.</td></tr>';
    return;
  }

  socios.forEach(s => {
    const parte = lucro * (Number(s.percentual) / 100);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(s.nome)}</td>
      <td>${Number(s.percentual).toFixed(1)}%</td>
      <td class="${parte >= 0 ? 'value-positive' : 'value-negative'}">${formatCurrency(parte)}</td>
    `;
    tbody.appendChild(tr);
  });

  animateTableRows(tbody);
}

let evolucaoChartInstance = null;

// Agrupa os lançamentos por mês (últimos 6 meses, incluindo meses sem
// nenhum lançamento, para o eixo não "pular") e desenha um gráfico de barras
// receita x despesa. Susbtitui o antigo gráfico de divisão (removido a
// pedido do usuário) por uma visão que a tabela abaixo não mostra: a
// evolução ao longo do tempo.
function renderEvolucaoChart(lancamentos) {
  const canvas = document.getElementById("evolucaoChart");
  if (!canvas || typeof Chart === "undefined") return;

  const MESES = 6;
  const hoje = new Date();
  const labels = [];
  const