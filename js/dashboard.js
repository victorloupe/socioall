async function initDashboard() {
  const ctx = await initAuthenticatedPage('dashboard');
  if (!ctx) return;

  tableLoading("divisaoTableBody", 3);
  tableLoading("despesasSociosTableBody", 3);
  tableLoading("acertoTableBody", 4);

  const { data: lancamentos, error: lancamentosError } = await supabaseClient
    .from("lancamentos")
    .select("tipo, valor, data, socio_id")
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
    .select("id, nome, percentual")
    .eq("empresa_id", ctx.empresaId);

  if (sociosError) {
    showToast(friendlyErrorMessage(sociosError, "Não foi possível carregar os sócios."), "error");
  }

  renderDivisaoTable(socios || [], lucro);
  renderDespesasSociosTable(socios || [], lancamentos || [], despesas);
  renderAcertoSocios(socios || [], lancamentos || [], lucro);
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
      <td class="summary-name">${escapeHtml(s.nome)}</td>
      <td data-label="Percentual">${Number(s.percentual).toFixed(1)}%</td>
      <td class="${parte >= 0 ? 'value-positive' : 'value-negative'}" data-label="Valor a receber">${formatCurrency(parte)}</td>
    `;
    tbody.appendChild(tr);
  });

  animateTableRows(tbody);
}

function renderDespesasSociosTable(socios, lancamentos, totalDespesas) {
  const tbody = document.getElementById("despesasSociosTableBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!socios || socios.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="table-empty">Nenhum sócio cadastrado ainda.</td></tr>';
    return;
  }

  const despesasLancamentos = (lancamentos || []).filter(l => l.tipo === "despesa");

  const totalPorSocio = {};
  socios.forEach(s => {
    totalPorSocio[s.id] = 0;
  });
  let totalGeralEmpresa = 0;

  despesasLancamentos.forEach(l => {
    if (l.socio_id && totalPorSocio[l.socio_id] !== undefined) {
      totalPorSocio[l.socio_id] += Number(l.valor);
    } else {
      totalGeralEmpresa += Number(l.valor);
    }
  });

  socios.forEach(s => {
    const valorPago = totalPorSocio[s.id];
    const percDespesas = totalDespesas > 0 ? (valorPago / totalDespesas) * 100 : 0;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="summary-name">${escapeHtml(s.nome)}</td>
      <td data-label="Total pago">${formatCurrency(valorPago)}</td>
      <td class="text-muted" data-label="% das despesas">${percDespesas.toFixed(1)}%</td>
    `;
    tbody.appendChild(tr);
  });

  if (totalGeralEmpresa > 0) {
    const percDespesas = totalDespesas > 0 ? (totalGeralEmpresa / totalDespesas) * 100 : 0;
    const tr = document.createElement("tr");
    tr.className = "text-muted table-light";
    tr.innerHTML = `
      <td class="summary-name"><em>Caixa Geral (Empresa)</em></td>
      <td data-label="Total pago">${formatCurrency(totalGeralEmpresa)}</td>
      <td class="text-muted" data-label="% das despesas">${percDespesas.toFixed(1)}%</td>
    `;
    tbody.appendChild(tr);
  }

  animateTableRows(tbody);
}

// A "Divisão do lucro" mostra a parte de cada sócio no resultado (só olha o
// % de participação) e "Despesas pagas por sócio" mostra quem tirou dinheiro
// do próprio bolso — mas nenhuma das duas diz se as contas estão "batendo"
// entre os sócios. Aqui comparamos o que cada um pagou/recebeu de fato
// (lançamentos com o socio_id dele) com a parte que cabia a ele no
// resultado, pra saber quem já contribuiu mais do que devia (tem a receber
// dos outros) e quem contribuiu menos (deve aos outros).
function renderAcertoSocios(socios, lancamentos, lucro) {
  const tbody = document.getElementById("acertoTableBody");
  const sugestoesEl = document.getElementById("acertoSugestoes");
  if (!tbody) return;
  tbody.innerHTML = "";
  if (sugestoesEl) sugestoesEl.innerHTML = "";

  if (!socios || socios.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="table-empty">Nenhum sócio cadastrado ainda.</td></tr>';
    return;
  }

  // Quanto cada sócio efetivamente pagou (despesa) ou recebeu (receita) do
  // próprio bolso. Lançamentos sem socio_id (ex: caixa geral da empresa) não
  // entram aqui — já afetam o lucro total, mas não são "de" nenhum sócio.
  const netPorSocio = {};
  socios.forEach(s => { netPorSocio[s.id] = 0; });

  (lancamentos || []).forEach(l => {
    if (!l.socio_id || netPorSocio[l.socio_id] === undefined) return;
    const valor = Number(l.valor);
    netPorSocio[l.socio_id] += l.tipo === "receita" ? valor : -valor;
  });

  const saldos = socios.map(s => {
    const parteJusta = lucro * (Number(s.percentual) / 100);
    const contribuiuDeFato = netPorSocio[s.id];
    // Se o sócio colocou mais dinheiro do próprio bolso do que sua parte
    // justa exigia (contribuiuDeFato mais "negativo"/menor que parteJusta),
    // ele tem a receber a diferença dos outros — por isso a ordem é
    // parteJusta - contribuiuDeFato (não o contrário).
    return { id: s.id, nome: s.nome, parteJusta, contribuiuDeFato, saldo: parteJusta - contribuiuDeFato };
  });

  saldos.forEach(s => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="summary-name">${escapeHtml(s.nome)}</td>
      <td data-label="Parte no resultado">${formatCurrency(s.parteJusta)}</td>
      <td data-label="Pagou/recebeu de fato">${formatCurrency(s.contribuiuDeFato)}</td>
      <td class="${s.saldo >= 0 ? "value-positive" : "value-negative"} fw-semibold" data-label="Saldo">
        ${s.saldo >= 0 ? "+" : ""}${formatCurrency(s.saldo)}
        <span class="text-muted fw-normal small d-block">${s.saldo >= 0 ? "a receber dos outros" : "deve aos outros"}</span>
      </td>
    `;
    tbody.appendChild(tr);
  });

  animateTableRows(tbody);

  if (!sugestoesEl) return;

  // Sugere as transferências mínimas entre sócios para zerar os saldos
  // (algoritmo guloso: sempre casa o maior credor com o maior devedor).
  const credores = saldos.filter(s => s.saldo > 0.01).map(s => ({ ...s, restante: s.saldo })).sort((a, b) => b.restante - a.restante);
  const devedores = saldos.filter(s => s.saldo < -0.01).map(s => ({ ...s, restante: -s.saldo })).sort((a, b) => b.restante - a.restante);

  const transferencias = [];
  let i = 0, j = 0;
  while (i < devedores.length && j < credores.length) {
    const devedor = devedores[i];
    const credor = credores[j];
    const valor = Math.min(devedor.restante, credor.restante);
    if (valor > 0.01) transferencias.push({ de: devedor.nome, para: credor.nome, valor });
    devedor.restante -= valor;
    credor.restante -= valor;
    if (devedor.restante <= 0.01) i++;
    if (credor.restante <= 0.01) j++;
  }

  sugestoesEl.innerHTML = transferencias.length === 0
    ? '<p class="text-secondary small mb-0">As contas já estão equilibradas entre os sócios.</p>'
    : transferencias.map(t => `
        <div class="alert alert-warning small mb-2 py-2 px-3">
          <strong>${escapeHtml(t.de)}</strong> deve transferir <strong>${formatCurrency(t.valor)}</strong> para <strong>${escapeHtml(t.para)}</strong>.
        </div>
      `).join("");
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
