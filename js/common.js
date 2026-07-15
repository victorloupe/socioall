// ---------- Utilitários genéricos de UI e helpers compartilhados ----------
// Este arquivo não depende de supabaseClient.js e deve ser carregado ANTES dele
// (supabaseClient.js usa escapeHtml em renderSidebarUser).

// Em produção, mensagens de erro não devem expor detalhes internos do banco
// (nomes de tabela, policies, etc.) — isso ajuda quem está atacando o site a
// mapear a estrutura do schema. Em localhost, mostramos o detalhe técnico
// para facilitar o diagnóstico durante o desenvolvimento/setup.
const SA_DEBUG = ["localhost", "127.0.0.1"].includes(window.location.hostname);

// Escapa texto vindo do usuário antes de inserir em innerHTML (evita XSS armazenado).
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Recolhe/expande o menu lateral (clique na logo), mostrando só os ícones
// quando recolhido.
function toggleSidebar() {
  const el = document.getElementById("sidebarCol");
  if (!el) return;
  const collapsed = el.classList.toggle("collapsed");
  document.documentElement.classList.toggle("sa-sidebar-collapsed", collapsed);
  localStorage.setItem("sa_sidebar_collapsed", collapsed ? "1" : "0");
}

// Quando o menu está recolhido, a busca vira só um ícone. Clicar nele expande
// o menu de novo e já foca o campo de busca, para digitar na hora.
function expandSidebarAndFocusSearch() {
  const el = document.getElementById("sidebarCol");
  if (el && el.classList.contains("collapsed")) {
    el.classList.remove("collapsed");
    document.documentElement.classList.remove("sa-sidebar-collapsed");
    localStorage.setItem("sa_sidebar_collapsed", "0");
  }
  const input = document.getElementById("sidebarSearchInput");
  // Pequeno atraso para o menu terminar de expandir antes de focar.
  if (input) setTimeout(() => input.focus(), 60);
}

// Filtra dinamicamente as opções do menu lateral com base na pesquisa.
// Também esconde o rótulo de uma seção (ex: "Vendas") quando nenhum item
// dela bate com a busca.
function filterSidebarMenu() {
  const query = (document.getElementById("sidebarSearchInput")?.value || "").toLowerCase().trim();
  const navList = document.getElementById("sidebarNav");
  if (!navList) return;

  let lastSectionTitle = null;
  let sectionHasVisibleItem = false;

  Array.from(navList.children).forEach(li => {
    if (li.classList.contains("nav-section-title")) {
      if (lastSectionTitle) {
        lastSectionTitle.style.display = sectionHasVisibleItem ? "" : "none";
      }
      lastSectionTitle = li;
      sectionHasVisibleItem = false;
      return;
    }

    const label = li.querySelector(".nav-label")?.textContent.toLowerCase() || "";
    const matches = label.includes(query);
    li.style.display = matches ? "" : "none";
    if (matches) sectionHasVisibleItem = true;
  });

  if (lastSectionTitle) {
    lastSectionTitle.style.display = sectionHasVisibleItem ? "" : "none";
  }
}

// Restaura o estado (recolhido/expandido) salvo do menu lateral.
function initSidebarState() {
  const el = document.getElementById("sidebarCol");
  if (!el) return;
  const isCollapsed = localStorage.getItem("sa_sidebar_collapsed") === "1";
  el.classList.toggle("collapsed", isCollapsed);
  document.documentElement.classList.toggle("sa-sidebar-collapsed", isCollapsed);
}

initSidebarState();

// ---------- Toast de notificação (substitui alert()) ----------
function ensureToastContainer() {
  let el = document.getElementById("saToastContainer");
  if (!el) {
    el = document.createElement("div");
    el.id = "saToastContainer";
    el.className = "sa-toast-container";
    el.setAttribute("role", "alert");
    el.setAttribute("aria-live", "assertive");
    document.body.appendChild(el);
  }
  return el;
}

function showToast(message, type = "success") {
  const container = ensureToastContainer();
  const toast = document.createElement("div");
  toast.className = `sa-toast sa-toast-${type}`;
  const icon = type === "error" ? "bi-exclamation-circle" : type === "warning" ? "bi-exclamation-triangle" : "bi-check-circle";
  toast.innerHTML = `<i class="bi ${icon}"></i><span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 200);
  }, 4500);
}

// Traduz erros comuns do Supabase/Postgres para mensagens legíveis.
// Quando não reconhece o erro, mostra o texto original junto do fallback em vez de
// esconder a causa real — isso é o que permite diagnosticar problemas de setup
// (ex: migração do banco não rodada, bucket de Storage não criado).
function friendlyErrorMessage(error, fallback) {
  const msg = error?.message || error?.error_description || "";
  const base = fallback || "Ocorreu um erro inesperado.";

  // Loga o detalhe técnico completo sempre (ajuda a depurar via console),
  // mas só mostra esse detalhe na tela quando SA_DEBUG (localhost).
  if (msg) console.error("Erro:", msg);

  if (msg.includes("soma dos percentuais")) return msg;
  if (msg.includes("duplicate key value") && msg.includes("categorias_unique_nome_tipo")) {
    return "Já existe uma categoria com esse nome e tipo.";
  }
  if (msg.includes("duplicate key value")) return "Esse registro já existe.";
  if (msg.toLowerCase().includes("bucket not found")) {
    return SA_DEBUG
      ? `${base} O bucket de Storage ainda não foi criado no Supabase (rode sql/schema_completo.sql ou crie manualmente em Storage).`
      : base;
  }
  if (msg.toLowerCase().includes("database schema is invalid or incompatible")) {
    return SA_DEBUG
      ? `${base} Erro no Storage do Supabase. Isso geralmente ocorre se os buckets foram criados via SQL em vez do painel. Por favor, exclua os buckets 'logos' e 'comprovantes' no painel do Supabase e recrie-os usando o botão 'New Bucket' na interface de Storage (marque 'logos' como público e 'comprovantes' como privado).`
      : base;
  }
  if (msg.includes('column') && msg.includes('does not exist')) {
    return SA_DEBUG
      ? `${base} Parece que falta rodar uma migração do banco (sql/schema_completo.sql). Detalhe: ${msg}`
      : base;
  }
  if (msg.includes("violates foreign key constraint")) return "Não é possível concluir: existe outro registro que depende deste.";
  if (msg.includes("violates row-level security") || msg.includes("permission denied")) {
    return SA_DEBUG
      ? `${base} Você não tem permissão para fazer isso (verifique se as policies do sql/schema_completo.sql foram aplicadas). Detalhe: ${msg}`
      : `${base} Você não tem permissão para fazer isso.`;
  }
  if (!msg) return base;
  return SA_DEBUG ? `${base} Detalhe: ${msg}` : base;
}

// ---------- Modal de confirmação (substitui confirm()) ----------
function confirmDialog(message, { confirmText = "Confirmar", danger = true } = {}) {
  return new Promise((resolve) => {
    let modalEl = document.getElementById("saConfirmModal");
    if (!modalEl) {
      modalEl = document.createElement("div");
      modalEl.id = "saConfirmModal";
      modalEl.className = "modal fade";
      modalEl.tabIndex = -1;
      modalEl.innerHTML = `
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-body py-4">
              <p class="mb-0" id="saConfirmMessage"></p>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancelar</button>
              <button type="button" class="btn" id="saConfirmOkBtn"></button>
            </div>
          </div>
        </div>`;
      document.body.appendChild(modalEl);
    }

    modalEl.querySelector("#saConfirmMessage").textContent = message;
    const okBtn = modalEl.querySelector("#saConfirmOkBtn");
    okBtn.textContent = confirmText;
    okBtn.className = "btn " + (danger ? "btn-danger" : "btn-primary");

    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);

    let resolved = false;
    const onOk = () => {
      resolved = true;
      modal.hide();
      resolve(true);
    };
    const onHidden = () => {
      okBtn.removeEventListener("click", onOk);
      modalEl.removeEventListener("hidden.bs.modal", onHidden);
      if (!resolved) resolve(false);
    };

    okBtn.addEventListener("click", onOk);
    modalEl.addEventListener("hidden.bs.modal", onHidden);
    modal.show();
  });
}

// Mostra um estado de carregamento numa tabela enquanto os dados não chegam.
function tableLoading(tbodyId, colspan, label = "Carregando...") {
  const tbody = document.getElementById(tbodyId);
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="${colspan}" class="table-empty"><span class="spinner-border spinner-border-sm me-2"></span>${label}</td></tr>`;
  }
}

// Anima a entrada das linhas de uma tabela (fade + leve deslize), com um
// pequeno atraso crescente entre elas. Chame depois de terminar de preencher
// o <tbody>. Aceita o próprio elemento <tbody> ou o id dele.
function animateTableRows(tbodyOrId) {
  const tbody = typeof tbodyOrId === "string" ? document.getElementById(tbodyOrId) : tbodyOrId;
  if (!tbody) return;
  tbody.querySelectorAll("tr").forEach((tr, i) => {
    tr.classList.add("row-enter");
    tr.style.animationDelay = `${Math.min(i * 30, 300)}ms`;
  });
}

function formatCurrency(value) {
  return (value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(dateStr) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("pt-BR");
}
