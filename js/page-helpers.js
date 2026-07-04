// ---------- Helpers de inicialização compartilhados entre as páginas internas ----------
// Depende de: common.js (initSidebarState, showToast) e supabaseClient.js
// (requireAuth, getEmpresaContext, renderSidebarUser). Carregue este arquivo
// depois dos dois.

// Injeta a sidebar (partials/sidebar.html) dentro de um elemento com
// id="sidebarMount" e marca o item de menu correspondente a activePage.
// activePage é um dos: dashboard, lancamentos, pedidos, categorias, relatorios,
// precificacao, empresa (a página "empresa" cobre tanto a aba "Dados da
// empresa" quanto a aba "Sócios", já que as duas foram mescladas numa página só)
//
// Como cada página é um HTML separado (sem SPA), navegar entre elas recarrega
// tudo do zero — sem cache, isso fazia o menu "piscar" (sumir e reaparecer) a
// cada troca de página, porque a sidebar só aparecia depois do fetch
// terminar. Guardamos o HTML da sidebar em sessionStorage: da segunda
// navegação em diante ela é desenhada na hora (sem esperar rede), e o fetch
// roda por trás só para manter o cache atualizado para a próxima página.
const SIDEBAR_CACHE_KEY = "sa_sidebar_html_v1";

async function injectSidebar(activePage) {
  const mount = document.getElementById("sidebarMount");
  if (!mount) return;

  const render = (html) => {
    mount.innerHTML = html;
    const link = mount.querySelector(`.nav-link[data-page="${activePage}"]`);
    if (link) link.classList.add("active");

    // Os 7 itens da bottom tab bar (mobile, só ícone) usam o mesmo data-page da sidebar.
    const bottomTab = mount.querySelector(`.bottom-tab[data-page="${activePage}"]`);
    if (bottomTab) bottomTab.classList.add("active");

    initSidebarState();
  };

  const cached = sessionStorage.getItem(SIDEBAR_CACHE_KEY);
  if (cached) {
    render(cached);
    // Atualiza o cache em segundo plano, sem re-renderizar agora (é isso
    // que evita o piscar) — a próxima página já usa a versão mais nova.
    fetch("partials/sidebar.html")
      .then(resp => resp.text())
      .then(html => sessionStorage.setItem(SIDEBAR_CACHE_KEY, html))
      .catch(() => {});
    return;
  }

  // Primeira página aberta nesta aba: ainda não tem cache, precisa esperar.
  try {
    const resp = await fetch("partials/sidebar.html");
    const html = await resp.text();
    sessionStorage.setItem(SIDEBAR_CACHE_KEY, html);
    render(html);
  } catch (err) {
    console.error("Falha ao carregar o menu lateral:", err);
  }
}

// Boilerplate padrão de toda página autenticada: injeta sidebar, valida
// sessão, carrega contexto da empresa, preenche o card de usuário no rodapé.
// Retorna o ctx (empresaId, empresaNome, socioId, ...) ou null se falhar
// (já mostra um toast de erro amigável em vez de deixar a tela em branco).
async function initAuthenticatedPage(activePage) {
  await injectSidebar(activePage);

  // Mostra na hora o nome/empresa/logo da última vez que carregou (cache em
  // sessionStorage), em vez de deixar aparecer "SócioAll"/"?"/"—" por um
  // instante enquanto a consulta de verdade ainda não voltou.
  const cachedCtx = getCachedEmpresaContext();
  if (cachedCtx) renderSidebarUser(cachedCtx);

  const session = await requireAuth();
  if (!session) return null;
  const ctx = await getEmpresaContext();
  if (!ctx) {
    showToast("Não foi possível carregar os dados da sua empresa. Recarregue a página ou entre novamente.", "error");
    return null;
  }
  renderSidebarUser(ctx);
  return ctx;
}

// Desabilita um botão de submit com texto de "carregando" enquanto roda fn,
// e restaura ao final (sucesso ou erro).
async function withLoadingButton(submitBtn, loadingText, fn) {
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = loadingText;
  try {
    await fn();
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
}
