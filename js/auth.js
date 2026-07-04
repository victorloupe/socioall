const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");
const authError = document.getElementById("authError");

function showError(msg) {
  authError.textContent = msg;
  authError.classList.remove("d-none");
}

if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    authError.classList.add("d-none");
    const usuario = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;

    const { error } = await supabaseClient.auth.signInWithPassword({
      email: usernameToEmail(usuario),
      password
    });
    if (error) {
      showError("Não foi possível entrar. Confira usuário e senha.");
      return;
    }
    window.location.href = "dashboard.html";
  });
}

if (signupForm) {
  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    authError.classList.add("d-none");
    const nome = document.getElementById("signupNome").value.trim();
    const empresa = document.getElementById("signupEmpresa").value.trim();
    const usuario = document.getElementById("signupEmail").value.trim();
    const password = document.getElementById("signupPassword").value;
    const email = usernameToEmail(usuario);

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
      showError("Não foi possível criar a conta. " + signUpError.message);
      return;
    }

    if (!signUpData.session) {
      showError("Não deu para entrar automaticamente. Como o login é por usuário (não e-mail real), a opção \"Confirm email\" precisa estar DESATIVADA em Authentication > Providers > Email, no painel do Supabase.");
      return;
    }

    // Já temos sessão. getEmpresaContext tenta primeiro reivindicar um convite
    // pendente (usuário já cadastrado como sócio por outra pessoa) antes de
    // criar uma empresa nova.
    const ctx = await getEmpresaContext();
    if (!ctx) {
      showError("Conta criada, mas houve um erro ao configurar a empresa. Tente fazer login novamente.");
      return;
    }

    window.location.href = "dashboard.html";
  });
}
