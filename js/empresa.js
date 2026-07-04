let currentEmpresaId = null;

async function initEmpresa() {
  const ctx = await initAuthenticatedPage('empresa');
  if (!ctx) return;
  currentEmpresaId = ctx.empresaId;

  document.getElementById("empresaNomeInput").value = ctx.empresaNome || "";
  document.getElementById("empresaSite").value = ctx.empresaSite || "";
  document.getElementById("empresaEndereco").value = ctx.empresaEndereco || "";
  renderLogoPreview(ctx.logoUrl);

  await loadCamposExtras();
}

// CNPJ/telefone/e-mail de contato foram adicionados em sql/schema_completo.sql,
// que pode ainda não ter sido rodado num ambiente mais antigo. Busca eles à parte,
// de propósito: se a coluna não existir ainda, só esses 3 campos ficam vazios —
// o resto da página (e o app inteiro) continua funcionando normalmente.
async function loadCamposExtras() {
  const { data, error } = await supabaseClient
    .from("empresas")
    .select("cnpj, telefone, email_contato")
    .eq("id", currentEmpresaId)
    .maybeSingle();

  if (error) {
    showToast("Não foi possível carregar CNPJ/telefone/e-mail — rode sql/schema_completo.sql no Supabase.", "warning");
    return;
  }

  document.getElementById("empresaCnpj").value = data?.cnpj || "";
  document.getElementById("empresaTelefone").value = data?.telefone || "";
  document.getElementById("empresaEmailContato").value = data?.email_contato || "";
}

// Máscara simples de CNPJ (00.000.000/0000-00) enquanto o usuário digita.
function maskCnpj(value) {
  return value
    .replace(/\D/g, "")
    .slice(0, 14)
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

document.getElementById("empresaCnpj").addEventListener("input", (e) => {
  e.target.value = maskCnpj(e.target.value);
});

function renderLogoPreview(url) {
  const img = document.getElementById("empresaLogoPreview");
  const placeholder = document.getElementById("empresaLogoPlaceholder");
  if (url) {
    img.src = url;
    img.classList.remove("d-none");
    placeholder.classList.add("d-none");
  } else {
    img.classList.add("d-none");
    placeholder.classList.remove("d-none");
  }
}

// Envia a logo para o bucket "logos" (público) e devolve a URL pública.
async function uploadLogo(file) {
  const ext = (file.name.split(".").pop() || "png").toLowerCase();
  const path = `${currentEmpresaId}/logo-${Date.now()}.${ext}`;

  const { error: uploadError } = await supabaseClient
    .storage
    .from("logos")
    .upload(path, file, { upsert: true, contentType: file.type || undefined });

  if (uploadError) throw uploadError;

  const { data } = supabaseClient.storage.from("logos").getPublicUrl(path);
  return data.publicUrl;
}

const empresaForm = document.getElementById("empresaForm");
if (empresaForm) {
  empresaForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("empresaSubmitBtn");
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Salvando...";

    try {
      const nome = document.getElementById("empresaNomeInput").value.trim();
      const site = document.getElementById("empresaSite").value.trim();
      const endereco = document.getElementById("empresaEndereco").value.trim();
      const cnpj = document.getElementById("empresaCnpj").value.trim();
      const telefone = document.getElementById("empresaTelefone").value.trim();
      const emailContato = document.getElementById("empresaEmailContato").value.trim();
      const fileInput = document.getElementById("empresaLogoInput");
      const file = fileInput.files[0];

      // Campos "core" (presentes desde a primeira versão do schema) — sempre devem poder ser salvos.
      const update = { nome, site: site || null, endereco: endereco || null };

      if (file) {
        update.logo_url = await uploadLogo(file);
      }

      const { error } = await supabaseClient
        .from("empresas")
        .update(update)
        .eq("id", currentEmpresaId);

      if (error) throw error;

      if (update.logo_url) renderLogoPreview(update.logo_url);
      fileInput.value = "";

      // Campos extras (cnpj/telefone/email_contato, sql/schema_completo.sql) — salvos à
      // parte de propósito: se essa migração ainda não rodou, o resto dos dados acima já
      // foi salvo normalmente.
      const { error: extrasError } = await supabaseClient
        .from("empresas")
        .update({ cnpj: cnpj || null, telefone: telefone || null, email_contato: emailContato || null })
        .eq("id", currentEmpresaId);

      if (extrasError) {
        showToast("Nome/site/endereço/logo foram salvos. CNPJ/telefone/e-mail não — rode sql/schema_completo.sql no Supabase.", "warning");
      } else {
        showToast("Dados da empresa atualizados.");
      }

      // Atualiza o nome/logo já visíveis no menu lateral, sem precisar recarregar.
      document.getElementById("empresaNome").textContent = nome;
    } catch (err) {
      showToast(friendlyErrorMessage(err, "Não foi possível salvar os dados da empresa."), "error");
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });
}

document.getElementById("empresaLogoInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => renderLogoPreview(ev.target.