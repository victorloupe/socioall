// ---------- Helpers de inicialização compartilhados entre as páginas internas ----------
// Depende de: common.js (initSidebarState, showToast) e supabaseClient.js
// (requireAuth, getEmpresaContext, renderSidebarUser). Carregue este arquivo
// depois dos dois.

// Injeta a sidebar (partials/sidebar.html) dentro de um elemento com
// id="sidebarMount" e marca o item de menu correspondente a activePage.
// activePage é um dos: dashboard, lancamentos, socios, categorias, relatorios, empresa
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
    sessionStorage.se