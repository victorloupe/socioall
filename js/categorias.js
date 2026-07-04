let currentEmpresaId = null;

const CATEGORIAS_PADRAO = [
  { nome: "Vendas", tipo: "receita" },
  { nome: "Serviços prestados", tipo: "receita" },
  { nome: "Outras receitas", tipo: "receita" },
  { nome: "Aluguel", tipo: "despesa" },
  { nome: "Salários", tipo: "despesa" },
  { nome: "Fornecedores", tipo: "despesa" },
  { nome: "Marketing", tipo: "despesa" },
  { nome: "Impostos", tipo: "despesa" },
  { nome: "Despesas administrativas", tipo: "despesa" },
  { nome: "Outras despesas", tipo: "despesa" }
];

async function usarCategoriasPadrao() {
  const btn = document.getElementById("usarCategoriasPadraoBtn");

  const run = async () => {
    const { data: existentes } = await supabaseClient
      .from("categorias")
      .select("nome, tipo")
      .eq("empresa_id", currentEmpresaId);

    const jaExiste = new Set((existentes || []).map(c => `${c.nome.trim().toLowerCase()}|${c.tipo}`));
    const faltando = CATEGORIAS_PADRAO.filter(c => !jaExiste.has(`${c.nome.toLowerCase()}|${c.tipo}`));

    if (faltando.length === 0) {
      showToast("Todas as categorias padrão já estão cadastradas.", "warning");
      return;
    }

    const { error } = await supabaseClient.from("categorias").insert(
      faltando.map(c => ({ empresa_id: currentEmpresaId, nome: c.nome, tipo: c.tipo }))
    );

    if (error) {
      showToast(friendlyErrorMessage(error, "Não foi possível criar as categorias padrão."), "error");
      return;
    }

    showToast(`${faltando.length} categoria(s) padrão adicionada(s).`);
    await loadCategorias();
  };

  if (btn) {
    await withLoadingButton(btn, "Adicionando...", run);
  } else {
    await run();
  }
}

async function initCategorias() {
  const ctx = await initAuthenticatedPage('categorias');
  if (!ctx) return;
  currentEmpresaId = ctx.empresaId;

  await loadCategorias();
}

async function loadCategorias() {
  tableLoading("categoriasTableBody", 3);

  const { data: categorias, error } = await supabaseClient
    .from("categorias")
    .select("id, nome, tipo")
    .eq("empresa_id", currentEmpresaId)
    .order("nome", { ascending: true });

  if (error) {
    showToast(friendlyErrorMessage(error, "Não foi possível carregar as categorias."), "error");
    return;
  }

  const tbody = document.getElementById("categoriasTableBody");
  tbody.innerHTML = "";

  if (!categorias || categorias.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="table-empty"><i class="bi bi-tags fs-4 d-block mb-2"></i>Nenhuma categoria ainda. Clique em "Usar categorias padrão" para começar rápido.</td></tr>';
    return;
  }

  categorias.forEach(c => {
    const badgeClass = c.tipo === "receita" ? "badge-receita" : "badge-despesa";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(c.nome)}</td>
      <td><span class="badge ${badgeClass}">${c.tipo}</span></td>
      <td class="text-end">
        <button class="btn btn-sm btn-outline-danger" aria-label="Excluir categoria" onclick="excluirCategoria('${c.id}')"><i class="bi bi-trash"></i></button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  animateTableRows(tbody);
}

async function excluirCategoria(id) {
  const ok = await confirmDialog("Excluir esta categoria? Lançamentos que a usam ficarão sem categoria.", { confirmText: "Excluir" });
  if (!ok) return;

  const { error } = await supabaseClient.from("categorias").delete().eq("id", id);
  if (error) {
    showToast(friendlyErrorMessage(error, "Não foi possível excluir a categoria."), "error");
    return;
  }
  showToast("Categoria excluída.");
  await loadCategorias();
}

const novaCategoriaForm = document.getElementById("novaCategoriaForm");
if (novaCategoriaForm) {
  novaCategoriaForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = document.getElementById("categoriaSubmitBtn");

    await withLoadingButton(submitBtn, "Salvando...", async () => {
      const nome = document.getElementById("categoriaNome").value.trim();
      const tipo = document.getElementById("categoriaTipo").value;

      const { error } = await supabaseClient.from("categorias").insert({
        empresa_id: currentEmpresaId,
   