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
  const chaves = [];
  for (let i = MESES - 1; i >= 0; i--) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
    const chave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    chaves.push(chave);
    labels.push(d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }));
  }

  const receitasPorMes = Object.fromEntries(chaves.map(c => [c, 0]));
  const despesasPorMes = Object.fromEntries(chaves.map(c => [c, 0]));

  lancamentos.forEach(l => {
    if (!l.data) return;
    const chave = l.data.slice(0, 7); // "YYYY-MM"
    if (!(chave in receitasPorMes)) return; // fora da janela dos últimos MESES meses
    if (l.tipo === "receita") receitasPorMes[chave] += Number(l.valor);
    else despesasPorMes[chave] += Number(l.valor);
  });

  const dadosReceitas = chaves.map(c => receitasPorMes[c]);
  const dadosDespesas = chaves.map(c => despesasPorMes[c]);

  if (evolucaoChartInstance) {
    evolucaoChartInstance.destroy();
  }

  evolucaoChartInstance = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Receitas",
          data: dadosReceitas,
          backgroundColor: getComputedStyle(document.documentElement).getPropertyValue("--sa-success").trim() || "#0EA79A",
          borderRadius: 4,
        },
        {
          label: "Despesas",
          data: dadosDespesas,
          backgroundColor: getComputedStyle(document.documentElement).getPropertyValue("--sa-danger").trim() || "#DC2626",
          borderRadius: 4,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: (v) => formatCurrency(v) }
        }
      },
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          callbacks: {
            label: (item) => `${item.dataset.label}: ${formatCurrency(item.raw)}`
          }
        }
      }
    }
  });
}

initDashboard();
