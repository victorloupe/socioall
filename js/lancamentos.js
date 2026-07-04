let currentEmpresaId = null;
let currentSocioId = null;

const PAGE_SIZE = 25;
let currentPage = 0;
let totalLancamentos = 0;
let categoriasCache = [];

async function initLancamentos() {
  const ctx = await initAuthenticatedPage('lancamentos');
  if (!ctx) return;
  currentEmpresaId = ctx.empresaId;
  currentSocioId = ctx.socioId;

  // Filtra as categorias dinamicamente quando o tipo de lançamento mudar
  document.getElementById("lancamentoTipo")?.addEventListener("change", updateCategoriasSelect);

  await loadCategorias();
  await loadLancamentos();
}

async function loadCategorias() {
  const { data: categorias, error } = await supabaseClient
    .from("categorias")
    .select("id, nome, tipo")
    .eq("empresa_id", currentEmpresaId);

  if (error) {
    showToast(friendlyErrorMessage(error, "Não foi possível carregar as categorias."), "error");
  }

  categoriasCache = categorias || [];
  updateCategoriasSelect();
}

function updateCategoriasSelect() {
  const select = document.getElementById("lancamentoCategoria");
  if (!select) return;
  const currentTipo = document.getElementById("lancamentoTipo").value;
  const currentVal = select.value; // Preserva o valor selecionado se houver

  select.innerHTML = '<option value="">Sem categoria</option>';
  categoriasCache
    .filter(c => c.tipo === currentTipo)
    .forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.nome;
      select.appendChild(opt);
    });

  select.value = currentVal;
}

async function loadLancamentos() {
  tableLoading("lancamentosTableBody", 7);

  const from = currentPage * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { data: lancamentos, count, error } = await supabaseClient
    .from("lancamentos")
    .select("id, tipo, descricao, valor, data, categoria_id, socios(nome), lancamento_comprovantes(id)", { count: "exact" })
    .eq("empresa_id", currentEmpresaId)
    .order("data", { ascending: false })
    .range(from, to);

  if (error) {
    showToast(friendlyErrorMessage(error, "Não foi possível carregar os lançamentos."), "error");
    return;
  }

  totalLancamentos = count || 0;

  const tbody = document.getElementById("lancamentosTableBody");
  tbody.innerHTML = "";

  if (!lancamentos || lancamentos.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="table-empty"><i class="bi bi-inboxes fs-4 d-block mb-2"></i>Nenhum lançamento ainda. Clique em "Novo lançamento" para começar.</td></tr>';
  }

  lancamentos.forEach(l => {
    const badgeClass = l.tipo === "receita" ? "badge-receita" : "badge-despesa";
    const sinal = l.tipo === "receita" ? "+" : "-";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${formatDate(l.data)}</td>
      <td>${escapeHtml(l.descricao)}</td>
      <td><span class="badge ${badgeClass}">${l.tipo}</span></td>
      <td>${escapeHtml(l.socios?.nome || "—")}</td>
      <td class="${l.tipo === 'receita' ? 'value-positive' : 'value-negative'}">${sinal} ${formatCurrency(l.valor)}</td>
      <td class="text-center">
        ${l.lancamento_comprovantes?.length ? `<button class="btn btn-sm btn-outline-secondary" title="Ver comprovantes" aria-label="Ver comprovantes" onclick="verComprovantes('${l.id}')"><i class="bi bi-paperclip"></i>${l.lancamento_comprovantes.length > 1 ? ` ${l.lancamento_comprovantes.length}` : ""}</button>` : ""}
      </td>
      <td class="text-end text-nowrap">
        <button class="btn btn-sm btn-outline-secondary" aria-label="Editar lançamento" onclick="editarLancamento('${l.id}')"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-sm btn-outline-danger" aria-label="Excluir lançamento" onclick="excluirLancamento('${l.id}')"><i class="bi bi-trash"></i></button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  animateTableRows(tbody);
  renderPagination();
}

function renderPagination() {
  const totalPages = Math.max(1, Math.ceil(totalLancamentos / PAGE_SIZE));
  const info = document.getElementById("lancamentosPageInfo");
  if (info) {
    info.textContent = totalLancamentos === 0
      ? "Nenhum lançamento"
      : `Página ${currentPage + 1} de ${totalPages} — ${totalLancamentos} lançamento(s)`;
  }
  const prevBtn = document.getElementById("lancamentosPrevBtn");
  const nextBtn = document.getElementById("lancamentosNextBtn");
  if (prevBtn) prevBtn.disabled = currentPage === 0;
  if (nextBtn) nextBtn.disabled = currentPage >= totalPages - 1;
}

document.getElementById("lancamentosPrevBtn")?.addEventListener("click", () => {
  if (currentPage > 0) {
    currentPage--;
    loadLancamentos();
  }
});

document.getElementById("lancamentosNextBtn")?.addEventListener("click", () => {
  const totalPages = Math.max(1, Math.ceil(totalLancamentos / PAGE_SIZE));
  if (currentPage < totalPages - 1) {
    currentPage++;
    loadLancamentos();
  }
});

// Abre um comprovante específico numa nova aba via URL assinada temporária
// (o bucket "comprovantes" é privado, então precisa de signed URL).
async function abrirComprovante(path) {
  const { data, error } = await supabaseClient.storage.from("comprovantes").createSignedUrl(path, 60);
  if (error || !data) {
    showToast("Não foi possível abrir o comprovante.", "error");
    return;
  }
  window.open(data.signedUrl, "_blank");
}

// Modal só de leitura, aberto ao clicar no clipe da tabela — lista todos os
// comprovantes anexados a esse lançamento (pode ser mais de um).
async function verComprovantes(lancamentoId) {
  const { data, error } = await supabaseClient
    .from("lancamento_comprovantes")
    .select("id, path, nome_arquivo")
    .eq("lancamento_id", lancamentoId)
    .order("created_at", { ascending: true });

  if (error) {
    showToast(friendlyErrorMessage(error, "Não foi possível carregar os comprovantes."), "error");
    return;
  }

  const lista = document.getElementById("verComprovantesLista");
  lista.innerHTML = (data || []).map((c, i) => `
    <li class="mb-2">
      <button type="button" class="btn btn-sm btn-outline-secondary w-100 text-start" onclick="abrirComprovante('${c.path}')">
        <i class="bi bi-paperclip me-1"></i>${escapeHtml(c.nome_arquivo || `Comprovante ${i + 1}`)}
      </button>
    </li>
  `).join("") || '<li class="text-muted small">Nenhum comprovante anexado.</li>';

  bootstrap.Modal.getOrCreateInstance(document.getElementById("verComprovantesModal")).show();
}

// Faz upload de vários arquivos para o bucket e grava uma linha por arquivo
// em lancamento_comprovantes — pode ser chamado tanto ao criar quanto ao
// editar um lançamento (adiciona aos que já existem, não substitui).
async function uploadComprovantes(files, lancamentoId) {
  for (const file of files) {
    const ext = (file.name.split(".").pop() || "bin").toLowerCase();
    const path = `${currentEmpresaId}/${lancamentoId}/comprovante-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: uploadError } = await supabaseClient.storage.from("comprovantes").upload(path, file, { contentType: file.type || undefined });
    if (uploadError) throw uploadError;

    const { error: insertError } = await supabaseClient.from("lancamento_comprovantes").insert({
      lancamento_id: lancamentoId,
      empresa_id: currentEmpresaId,
      path,
      nome_arquivo: file.name
    });
    if (insertError) throw insertError;
  }
}

// Renderiza a lista de comprovantes já anexados dentro do modal de edição,
// cada um com um botão de excluir (remove do storage e da tabela).
async function renderComprovantesAtuais(lancamentoId) {
  const container = document.getElementById("lancamentoComprovantesAtuais");
  if (!container) return;

  if (!lancamentoId) {
    container.innerHTML = "";
    return;
  }

  const { data, error } = await supabaseClient
    .from("lancamento_comprovantes")
    .select("id, path, nome_arquivo")
    .eq("lancamento_id", lancamentoId)
    .order("created_at", { ascending: true });

  if (error) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = (data || []).map((c, i) => `
    <li class="d-flex align-items-center justify-content-between border rounded px-2 py-1 mb-1">
      <button type="button" class="btn btn-sm btn-link p-0 text-truncate" onclick="abrirComprovante('${c.path}')">
        <i class="bi bi-paperclip me-1"></i>${escapeHtml(c.nome_arquivo || `Comprovante ${i + 1}`)}
      </button>
      <button type="button" class="btn btn-sm btn-outline-danger border-0" aria-label="Remover comprovante" onclick="excluirComprovante('${c.id}', '${c.path}', '${lancamentoId}')"><i class="bi bi-x-lg"></i></button>
    </li>
  `).join("");
}

async function excluirComprovante(comprovanteId, path, lancamentoId) {
  const ok = await confirmDialog("Remover este comprovante?", { confirmText: "Remover" });
  if (!ok) return;

  await supabaseClient.storage.from("comprovantes").remove([path]);
  const { error } = await supabaseClient.from("lancamento_comprovantes").delete().eq("id", comprovanteId);
  if (error) {
    showToast(friendlyErrorMessage(error, "Não foi possível remover o comprovante."), "error");
    return;
  }
  showToast("Comprovante removido.");
  await renderComprovantesAtuais(lancamentoId);
  await loadLancamentos();
}

async function editarLancamento(id) {
  const { data: l, error } = await supabaseClient
    .from("lancamentos")
    .select("id, tipo, descricao, valor, data, categoria_id")
    .eq("id", id)
    .single();

  if (error || !l) {
    showToast("Não foi possível carregar este lançamento.", "error");
    return;
  }

  document.getElementById("lancamentoEditId").value = l.id;
  document.getElementById("lancamentoTipo").value = l.tipo;
  updateCategoriasSelect(); // Atualiza a lista filtrada no select antes de setar o ID da categoria
  document.getElementById("lancamentoCategoria").value = l.categoria_id || "";

  document.getElementById("lancamentoDescricao").value = l.descricao;
  document.getElementById("lancamentoValor").value = l.valor;
  document.getElementById("l