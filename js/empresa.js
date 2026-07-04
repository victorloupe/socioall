let currentEmpresaId = null;
let currentUserId = null;
let sociosNomeCache = {};

// Página "Configurações": reúne os dados da empresa e a gestão de sócios em
// abas (antes eram duas páginas — empresa.html e socios.html — mescladas a
// pedido do usuário, já que gestão de sócios também é uma configuração).
async function initConfiguracoes() {
  const ctx = await initAuthenticatedPage('empresa');
  if (!ctx) return;
  currentEmpresaId = ctx.empresaId;

  const { data: { session } } = await supabaseClient.auth.getSession();
  currentUserId = session.user.id;

  document.getElementById("empresaNomeInput").value = ctx.empresaNome || "";
  document.getElementById("empresaSite").value = ctx.empresaSite || "";
  document.getElementById("empresaEndereco").value = ctx.empresaEndereco || "";
  renderLogoPreview(ctx.logoUrl);

  await loadCamposExtras();
  await loadSocios();
  await loadAuditLog();
}

// ==================== Aba: Dados da empresa ====================

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
  reader.onload = (ev) => renderLogoPreview(ev.target.result);
  reader.readAsDataURL(file);
});

// ==================== Aba: Sócios ====================

async function loadSocios() {
  tableLoading("sociosTableBody", 4);

  const { data: socios, error } = await supabaseClient
    .from("socios")
    .select("id, user_id, nome, email, percentual")
    .eq("empresa_id", currentEmpresaId)
    .order("percentual", { ascending: false });

  if (error) {
    showToast(friendlyErrorMessage(error, "Não foi possível carregar os sócios."), "error");
    return;
  }

  const tbody = document.getElementById("sociosTableBody");
  tbody.innerHTML = "";

  let totalPercentual = 0;

  if (!socios || socios.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="table-empty"><i class="bi bi-people fs-4 d-block mb-2"></i>Nenhum sócio cadastrado ainda.</td></tr>';
  }

  sociosNomeCache = {};

  (socios || []).forEach(s => {
    totalPercentual += Number(s.percentual);
    sociosNomeCache[s.id] = s.nome;
    const isSelf = s.user_id === currentUserId;
    const temLogin = !!s.user_id;
    const tr = document.createElement("tr");
    const nomeSeguro = escapeHtml(s.nome);
    tr.innerHTML = `
      <td>${nomeSeguro}</td>
      <td>${escapeHtml(emailToUsername(s.email) || "—")}</td>
      <td>${Number(s.percentual).toFixed(1)}%</td>
      <td class="text-end text-nowrap">
        ${!isSelf && temLogin ? `<button class="btn btn-sm btn-outline-secondary" title="Resetar senha" aria-label="Resetar senha de ${nomeSeguro}" onclick="abrirResetSenha('${s.id}')"><i class="bi bi-key"></i></button>` : ""}
        <button class="btn btn-sm btn-outline-secondary" aria-label="Editar sócio" onclick="editarSocio('${s.id}')"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-sm btn-outline-danger" aria-label="Excluir sócio" onclick="excluirSocio('${s.id}')" ${isSelf ? "disabled title='Você não pode remover a si mesmo'" : ""}><i class="bi bi-trash"></i></button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  animateTableRows(tbody);

  const alertEl = document.getElementById("percentualAlert");
  if (Math.abs(totalPercentual - 100) > 0.01) {
    alertEl.textContent = `Atenção: os percentuais somam ${totalPercentual.toFixed(1)}%, e deveriam somar 100%.`;
    alertEl.classList.remove("d-none");
  } else {
    alertEl.classList.add("d-none");
  }
}

async function editarSocio(id) {
  const { data: s, error } = await supabaseClient
    .from("socios")
    .select("id, user_id, nome, email, percentual")
    .eq("id", id)
    .single();

  if (error || !s) {
    showToast("Não foi possível carregar este sócio.", "error");
    return;
  }

  document.getElementById("socioEditId").value = s.id;
  document.getElementById("socioNome").value = s.nome;
  document.getElementById("socioEmail").value = emailToUsername(s.email);
  document.getElementById("socioPercentual").value = s.percentual;

  const emailInput = document.getElementById("socioEmail");
  if (s.user_id) {
    emailInput.disabled = true;
    emailInput.title = "Não é possível alterar o usuário de um sócio que já possui login.";
  } else {
    emailInput.disabled = false;
    emailInput.title = "";
  }

  document.getElementById("socioModalTitle").textContent = "Editar sócio";
  document.getElementById("socioSubmitBtn").textContent = "Salvar alterações";

  bootstrap.Modal.getOrCreateInstance(document.getElementById("novoSocioModal")).show();
}

async function excluirSocio(id) {
  const ok = await confirmDialog("Excluir este sócio? Essa ação não pode ser desfeita.", { confirmText: "Excluir" });
  if (!ok) return;

  const { error } = await supabaseClient.from("socios").delete().eq("id", id);
  if (error) {
    showToast(friendlyErrorMessage(error, "Não foi possível excluir o sócio."), "error");
    return;
  }
  showToast("Sócio excluído.");
  await loadSocios();
}

function resetSocioForm() {
  document.getElementById("socioEditId").value = "";
  document.getElementById("socioModalTitle").textContent = "Adicionar sócio";
  document.getElementById("socioSubmitBtn").textContent = "Salvar sócio";
  const emailInput = document.getElementById("socioEmail");
  emailInput.disabled = false;
  emailInput.title = "";
}

document.getElementById("novoSocioModal")?.addEventListener("hidden.bs.modal", () => {
  document.getElementById("novoSocioForm").reset();
  resetSocioForm();
});

const novoSocioForm = document.getElementById("novoSocioForm");
if (novoSocioForm) {
  novoSocioForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = document.getElementById("socioSubmitBtn");
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = "Salvando...";

    try {
      const editId = document.getElementById("socioEditId").value;
      const nome = document.getElementById("socioNome").value.trim();
      const email = usernameToEmail(document.getElementById("socioEmail").value.trim());
      const percentual = parseFloat(document.getElementById("socioPercentual").value);

      let error;
      if (editId) {
        ({ error } = await supabaseClient.from("socios").update({ nome, email, percentual }).eq("id", editId));
      } else {
        ({ error } = await supabaseClient.from("socios").insert({
          empresa_id: currentEmpresaId,
          nome,
          email,
          percentual
        }));
      }

      if (error) throw error;

      bootstrap.Modal.getInstance(document.getElementById("novoSocioModal")).hide();
      showToast(editId ? "Sócio atualizado." : "Sócio adicionado.");
      await loadSocios();
    } catch (err) {
      showToast(friendlyErrorMessage(err, "Não foi possível salvar o sócio."), "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  });
}

// ---------- Resetar senha de outro sócio (via função serverless) ----------

function abrirResetSenha(socioId) {
  document.getElementById("resetSenhaSocioId").value = socioId;
  // textContent (não innerHTML) já é seguro contra injeção de HTML/JS.
  document.getElementById("resetSenhaSocioNome").textContent = sociosNomeCache[socioId] || "";
  bootstrap.Modal.getOrCreateInstance(document.getElementById("resetSenhaModal")).show();
}

document.getElementById("resetSenhaModal")?.addEventListener("hidden.bs.modal", () => {
  document.getElementById("resetSenhaSocioForm").reset();
});

const resetSenhaSocioForm = document.getElementById("resetSenhaSocioForm");
if (resetSenhaSocioForm) {
  resetSenhaSocioForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = document.getElementById("resetSenhaSubmitBtn");
    const originalText = submitBtn.textContent;

    const novaSenha = document.getElementById("resetSenhaNova").value;
    const confirmaSenha = document.getElementById("resetSenhaConfirma").value;

    if (novaSenha !== confirmaSenha) {
      showToast("As senhas não coincidem.", "error");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Redefinindo...";

    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      const targetSocioId = document.getElementById("resetSenhaSocioId").value;

      const resp = await fetch("/api/reset-senha-socio", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ targetSocioId, novaSenha })
      });

      const result = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        throw new Error(result.error || "Não foi possível redefinir a senha.");
      }

      bootstrap.Modal.getInstance(document.getElementById("resetSenhaModal")).hide();
      showToast("Senha redefinida com sucesso.");
    } catch (err) {
      showToast(err.message || "Não foi possível redefinir a senha.", "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  });
}

// ---------- Histórico de alterações (auditoria) ----------
// Alimentado por triggers no banco (tabela audit_logs) em lancamentos e
// socios — nenhuma escrita é feita daqui, só leitura. Ver sql/schema_completo.sql.

const AUDIT_ACAO_LABEL = { insert: "Criou", update: "Editou", delete: "Excluiu" };
const AUDIT_TABELA_LABEL = { lancamentos: "lançamento", socios: "sócio" };

function descreverAuditItem(item) {
  const dados = item.dados_novos || item.dados_antigos || {};
  if (item.tabela === "lancamentos") {
    return dados.descricao ? `${escapeHtml(dados.descricao)} (${formatCurrency(dados.valor || 0)})` : "—";
  }
  if (item.tabela === "socios") {
    return dados.nome ? escapeHtml(dados.nome) : "—";
  }
  return "—";
}

async function loadAuditLog() {
  const tbody = document.getElementById("auditLogTableBody");
  if (!tbody) return;
  tableLoading("auditLogTableBody", 4);

  const { data, error } = await supabaseClient
    .from("audit_logs")
    .select("id, tabela, acao, created_at, dados_antigos, dados_novos, socios(nome)")
    .eq("empresa_id", currentEmpresaId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    // Tabela pode ainda não existir se o schema_completo.sql atualizado
    // ainda não foi rodado no Supabase — falha silenciosa é melhor que
    // travar a página com um toast de erro.
    tbody.innerHTML = '<tr><td colspan="4" class="table-empty">Histórico indisponível.</td></tr>';
    return;
  }

  tbody.innerHTML = "";

  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="table-empty"><i class="bi bi-clock-history fs-4 d-block mb-2"></i>Nenhuma alteração registrada ainda.</td></tr>';
    return;
  }

  data.forEach(item => {
    const tr = document.createElement("tr");
    const acaoBadge = item.acao === "delete" ? "badge-despesa" : (item.acao === "insert" ? "badge-receita" : "");
    tr.innerHTML = `
      <td class="small text-muted">${formatDate(item.created_at.slice(0, 10))} ${item.created_at.slice(11, 16)}</td>
      <td>${escapeHtml(item.socios?.nome || "—")}</td>
      <td>${AUDIT_TABELA_LABEL[item.tabela] || escapeHtml(item.tabela)}: ${descreverAuditItem(item)}</td>
      <td>${acaoBadge ? `<span class="badge ${acaoBadge}">${AUDIT_ACAO_LABEL[item.acao] || item.acao}</span>` : (AUDIT_ACAO_LABEL[item.acao] || item.acao)}</td>
    `;
    tbody.appendChild(tr);
  });

  animateTableRows(tbody);
}

initConfiguracoes();
