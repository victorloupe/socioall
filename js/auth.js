const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");
const authError = document.getElementById("authError");

// Alterna o campo de senha entre oculto/visível (ícone de olho). Usado nos
// dois formulários (login e cadastro) desta página.
function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const showing = input.type === "password";
  input.type = showing ? "text" : "password";
  const icon = btn.querySelector("i");
  if (icon) {
    icon.classList.toggle("bi-eye", !showing);
    icon.classList.toggle("bi-eye-slash", showing);
  }
  btn.setAttribute("aria-label", showing ? "Ocultar senha" : "Mostrar senha");
}

function showError(msg) {
  authError.textContent = msg;
  authError.classList.remove("d-none");
}

// Troca as abas + formulário pela telinha de "sistema carregando": nome do
// sócio, checklist das áreas do sistema marcando uma a uma e barra de
// progresso (ver .auth-loading no css/style.css) — e só então navega pra
// dashboard.html. Sem isso, o clique em "Entrar" não dava nenhum feedback
// visual até a página trocar.
function showAuthLoading(nome, subtitle, logoUrl) {
  document.getElementById("authTabs")?.classList.add("d-none");
  document.querySelector(".tab-content")?.classList.add("d-none");
  authError.classList.add("d-none");

  const loadingEl = document.getElementById("authLoading");
  const logoEl = document.getElementById("authLoadingLogo");
  const nomeEl = document.getElementById("authLoadingNome");
  const subtitleEl = document.getElementById("authLoadingText");
  const fillEl = document.getElementById("authLoadingBarFill");
  const pctEl = document.getElementById("authLoadingPct");
  const items = document.querySelectorAll("#authLoadingChecklist li");

  // Mostra a logo da empresa (cadastrada em Configurações) se existir; senão
  // cai pra logo do próprio SócioAll.
  if (logoEl) {
    const temLogoPropria = !!(logoUrl && logoUrl.trim());
    logoEl.src = temLogoPropria ? logoUrl.trim() : "logo-full.png";
    logoEl.alt = temLogoPropria ? "Logo da empresa" : "SócioAll";
  }

  if (nomeEl) nomeEl.textContent = (nome || "").trim() || "Sócio";
  if (subtitleEl) subtitleEl.textContent = subtitle || "Preparando seu espaço...";
  if (fillEl) fillEl.style.width = "0%";
  if (pctEl) pctEl.textContent = "0%";
  items.forEach(li => {
    li.classList.remove("active", "done");
    const icon = li.querySelector(".auth-loading-check-icon");
    if (icon) icon.innerHTML = "";
  });

  if (loadingEl) loadingEl.classList.remove("d-none");

  const DURATION_MS = 3000;
  animateChecklistItems(items, DURATION_MS);
  animateProgressBar(fillEl, pctEl, DURATION_MS, () => {
    window.location.href = "dashboard.html";
  });
}

// Marca os itens da checklist como "ativo" (girando) e depois "concluído"
// (check verde), um de cada vez, ao longo da duração total — puramente
// visual, não espera nenhuma requisição de verdade.
function animateChecklistItems(items, duration) {
  const list = Array.from(items);
  if (list.length === 0) return;
  const step = duration / list.length;

  list.forEach((li, idx) => {
    setTimeout(() => li.classList.add("active"), idx * step);
    setTimeout(() => {
      li.classList.remove("active");
      li.classList.add("done");
      const icon = li.querySelector(".auth-loading-check-icon");
      if (icon) icon.innerHTML = '<i class="bi bi-check-lg"></i>';
    }, (idx + 1) * step);
  });
}

// Enche a barra (e conta a porcentagem) de forma contínua com
// requestAnimationFrame, em vez de pular de número em número a cada item da
// checklist — fica com cara de carregamento de verdade, não de degrau.
function animateProgressBar(fillEl, pctEl, duration, onDone) {
  const start = performance.now();

  function tick(now) {
    const elapsed = now - start;
    const pct = Math.min(100, (elapsed / duration) * 100);
    if (fillEl) fillEl.style.width = `${pct}%`;
    if (pctEl) pctEl.textContent = `${Math.round(pct)}%`;

    if (elapsed < duration) {
      requestAnimationFrame(tick);
    } else {
      setTimeout(onDone, 250);
    }
  }

  requestAnimationFrame(tick);
}

if (loginForm) {
  const loginSubmitBtn = loginForm.querySelector('button[type="submit"]');

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    authError.classList.add("d-none");
    const usuario = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;

    const originalBtnHtml = loginSubmitBtn.innerHTML;
    loginSubmitBtn.disabled = true;
    loginSubmitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Entrando...';

    const { error } = await supabaseClient.auth.signInWithPassword({
      email: usernameToEmail(usuario),
      password
    });

    if (error) {
      loginSubmitBtn.disabled = false;
      loginSubmitBtn.innerHTML = originalBtnHtml;
      showError("Não foi possível entrar. Confira usuário e senha.");
      return;
    }

    // Busca nome/empresa aqui (não só na dashboard) pra já mostrar "Bem-vindo,
    // Fulano" na animação — de quebra, isso já deixa o contexto em cache pra
    // dashboard.html pintar instantâneo (ver getCachedEmpresaContext).
    const ctx = await getEmpresaContext();
    showAuthLoading(ctx?.socioNome, "Preparando seu espaço...", ctx?.logoUrl);
  });
}

if (signupForm) {
  const signupSubmitBtn = signupForm.querySelector('button[type="submit"]');

  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    authError.classList.add("d-none");
    const nome = document.getElementById("signupNome").value.trim();
    const empresa = document.getElementById("signupEmpresa").value.trim();
    const usuario = document.getElementById("signupEmail").value.trim();
    const password = document.getElementById("signupPassword").value;
    const email = usernameToEmail(usuario);

    const originalBtnHtml = signupSubmitBtn.innerHTML;
    signupSubmitBtn.disabled = true;
    signupSubmitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Criando conta...';

    const restoreBtn = () => {
      signupSubmitBtn.disabled = false;
      signupSubmitBtn.innerHTML = originalBtnHtml;
    };

    // Guarda nome/empresa no user_metadata: se a confirmação de e-mail estiver
    // ativa, ainda não teremos sessão autenticada para criar empresa/sócio agora
    // (o RLS bloquearia). Esses dados são usados no primeiro login.
    const { data: signUpData, error: signUpError } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: { pendingEmpresaNome: empresa, pendingSocioNome: nome }
      }
    });

    if (signUpError) {
      restoreBtn();
      showError("Não foi possível criar a conta. " + signUpError.message);
      return;
    }

    if (!signUpData.session) {
      restoreBtn();
      showError("Não deu para entrar automaticamente. Como o login é por usuário (não e-mail real), a opção \"Confirm email\" precisa estar DESATIVADA em Authentication > Providers > Email, no painel do Supabase.");
      return;
    }

    // Já temos sessão. getEmpresaContext tenta primeiro reivindicar um convite
    // pendente (usuário já cadastrado como sócio por outra pessoa) antes de
    // criar uma empresa nova.
    const ctx = await getEmpresaContext();
    if (!ctx) {
      restoreBtn();
      showError("Conta criada, mas houve um erro ao configurar a empresa. Tente fazer login novamente.");
      return;
    }

    showAuthLoading(ctx?.socioNome, "Preparando sua empresa...", ctx?.logoUrl);
  });
}
