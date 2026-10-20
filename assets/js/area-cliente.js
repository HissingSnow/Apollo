/* =========================================================
   Área do Cliente Apollo
   Login (e-mail/senha ou Google via Supabase) → plano → dados da empresa
   → pagamento (Stripe) → empresa criada no Apollo Drive → link de acesso.
   ?demo=1 mostra as telas sem contas reais (para revisão).
   ========================================================= */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const params = new URLSearchParams(location.search);
  const DEMO = params.has("demo");
  const WHATSAPP = "https://wa.me/5511949371451?text=" + encodeURIComponent("Olá! Preciso de ajuda com minha assinatura do Apollo Drive.");

  const PLAN_FEATURES = {
    essencial: ["Clientes e pedidos", "Agenda comercial", "Dashboard essencial", "Importação e exportação"],
    profissional: ["Tudo do Essencial", "Funil Kanban e notificações", "Produtividade e comissões", "Catálogos e Portal B2B"],
    gestao: ["Tudo do Profissional", "Controle de estoque", "Contas a pagar", "Relatórios avançados", "Múltiplos administradores"],
  };
  const STATUS = {
    aguardando_pagamento: { label: "Aguardando pagamento", tone: "warn" },
    pago: { label: "Pagamento confirmado · criando empresa", tone: "info" },
    provisionando: { label: "Criando sua empresa", tone: "info" },
    falha_temporaria: { label: "Finalizando a criação", tone: "info" },
    falha: { label: "Precisa de atenção", tone: "danger" },
    ativo: { label: "Ativa", tone: "ok" },
    pagamento_pendente: { label: "Pagamento pendente", tone: "warn" },
    cancelado: { label: "Cancelada", tone: "muted" },
  };

  let sb = null, session = null, plans = [], selectedPlan = null, account = null, slugTouched = false, logoData = null;

  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => Number(n).toLocaleString("pt-BR");
  const dateBR = (iso) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
  const onlyDigits = (v) => String(v || "").replace(/\D/g, "");
  const slugify = (v) => String(v || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------------- Validações (iguais às do servidor) ---------------- */
  function validCPF(v) {
    const c = onlyDigits(v);
    if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
    const dv = (len) => { let s = 0; for (let i = 0; i < len; i++) s += +c[i] * (len + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
    return dv(9) === +c[9] && dv(10) === +c[10];
  }
  function validCNPJ(v) {
    const c = onlyDigits(v);
    if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
    const dv = (len) => {
      const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      const r = w.reduce((s, x, i) => s + x * +c[i], 0) % 11; return r < 2 ? 0 : 11 - r;
    };
    return dv(12) === +c[12] && dv(13) === +c[13];
  }
  const pwRules = {
    len: (v) => v.length >= 10, upper: (v) => /[A-Z]/.test(v), lower: (v) => /[a-z]/.test(v),
    digit: (v) => /\d/.test(v), symbol: (v) => /[^A-Za-z0-9]/.test(v),
  };
  const validSlug = (v) => /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(v || "");
  const validUsername = (v) => /^[A-Za-z0-9._-]{3,40}$/.test(v || "");

  function maskDoc(value, type) {
    const d = onlyDigits(value).slice(0, type === "pf" ? 11 : 14);
    if (type === "pf") return d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
    return d.replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\d{4})(\d)/, "$1-$2");
  }

  /* ---------------- Telas ---------------- */
  const VIEWS = ["ac-loading", "ac-auth", "ac-reset", "ac-app"];
  function show(id) {
    VIEWS.forEach((v) => ($("#" + v).hidden = v !== id));
    scrollTo({ top: 0 });
  }
  const APP_PARTS = ["ac-companies", "ac-plans", "ac-form-wrap", "ac-wait"];
  function showApp(...parts) {
    show("ac-app");
    APP_PARTS.forEach((p) => ($("#" + p).hidden = !parts.includes(p)));
  }
  function msg(el, text, tone = "danger") {
    el.textContent = text || "";
    el.dataset.tone = tone;
  }

  /* ---------------- API (funções da Netlify) ---------------- */
  async function api(path, { method = "GET", body } = {}) {
    if (DEMO) return demoApi(path, method, body);
    const res = await fetch(path, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${session?.access_token || ""}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch { data = { ok: false, error: "Resposta inválida do servidor." }; }
    data.status = res.status;
    return data;
  }

  /* ---------------- Início ---------------- */
  async function init() {
    let cfg;
    try {
      if (DEMO) throw new Error("demo");
      cfg = await fetch("/api/config").then((r) => r.json());
      if (!cfg.ok) throw new Error(cfg.error);
    } catch (err) {
      if (DEMO) return startDemo();
      show("ac-auth");
      msg($("#ac-auth-msg"), "A Área do Cliente está em configuração. Fale com a gente pelo WhatsApp para contratar.", "warn");
      $$("#ac-auth input, #ac-auth button").forEach((el) => (el.disabled = true));
      return;
    }
    plans = cfg.plans;
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, detectSessionInUrl: true, flowType: "pkce" },
    });
    sb.auth.onAuthStateChange((event, s) => {
      session = s;
      if (event === "PASSWORD_RECOVERY") show("ac-reset");
    });
    const { data } = await sb.auth.getSession();
    session = data.session;
    if (session) enterApp(); else show("ac-auth");
  }

  /* ---------------- Entrar / Criar conta ---------------- */
  let authMode = "login";
  $$(".ac-tabs button").forEach((btn) => btn.addEventListener("click", () => {
    authMode = btn.dataset.mode;
    $$(".ac-tabs button").forEach((b) => b.classList.toggle("active", b === btn));
    $$("[data-only]", $("#ac-auth")).forEach((el) => (el.hidden = el.dataset.only !== authMode));
    $("#ac-auth-submit").firstChild.textContent = authMode === "login" ? "Entrar " : "Criar conta ";
    $("#ac-auth-form [name=password]").autocomplete = authMode === "login" ? "current-password" : "new-password";
    msg($("#ac-auth-msg"), "");
  }));

  const AUTH_ERRORS = [
    [/invalid login credentials/i, "E-mail ou senha incorretos."],
    [/email not confirmed/i, "Confirme seu e-mail pelo link que enviamos antes de entrar."],
    [/already registered|already been registered/i, "Este e-mail já tem conta. Use a aba Entrar."],
    [/password should be at least/i, "A senha precisa ter ao menos 8 caracteres."],
    [/rate limit|too many/i, "Muitas tentativas. Aguarde alguns minutos."],
  ];
  const authError = (e) => (AUTH_ERRORS.find(([re]) => re.test(e?.message || "")) || [, "Não foi possível continuar. Tente novamente."])[1];
  const returnUrl = () => location.origin + location.pathname + (params.get("plano") ? `?plano=${encodeURIComponent(params.get("plano"))}` : "");

  $("#ac-auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget, out = $("#ac-auth-msg");
    const email = f.email.value.trim(), password = f.password.value;
    if (!/^\S+@\S+\.\S+$/.test(email)) return msg(out, "Informe um e-mail válido.");
    if (password.length < 8) return msg(out, "A senha precisa ter ao menos 8 caracteres.");
    if (authMode === "signup" && password !== f.password2.value) return msg(out, "As senhas não conferem.");
    const btn = $("#ac-auth-submit"); btn.disabled = true;
    try {
      if (authMode === "login") {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        session = data.session; enterApp();
      } else {
        const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: returnUrl() } });
        if (error) throw error;
        if (data.session) { session = data.session; enterApp(); }
        else msg(out, "Conta criada! Enviamos um link de confirmação para o seu e-mail.", "ok");
      }
    } catch (err) {
      msg(out, authError(err));
    } finally { btn.disabled = false; }
  });

  $("#ac-google").addEventListener("click", async () => {
    const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: returnUrl() } });
    if (error) msg($("#ac-auth-msg"), "Não foi possível entrar com o Google agora.");
  });

  $("#ac-forgot").addEventListener("click", async () => {
    const email = $("#ac-auth-form").email.value.trim(), out = $("#ac-auth-msg");
    if (!/^\S+@\S+\.\S+$/.test(email)) return msg(out, "Digite seu e-mail acima e clique de novo em “Esqueci minha senha”.", "warn");
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    msg(out, error ? authError(error) : "Se o e-mail tiver conta, você receberá um link para criar uma nova senha.", error ? "danger" : "ok");
  });

  $("#ac-reset-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const password = e.currentTarget.password.value, out = $("#ac-reset-msg");
    if (password.length < 8) return msg(out, "A senha precisa ter ao menos 8 caracteres.");
    const { error } = await sb.auth.updateUser({ password });
    if (error) return msg(out, authError(error));
    enterApp();
  });

  $("#ac-logout").addEventListener("click", async () => {
    if (DEMO) { sessionStorage.removeItem("apolloDemo"); location.href = "area-cliente.html?demo=1"; return; }
    await sb.auth.signOut(); session = null; show("ac-auth");
  });

  /* ---------------- Área logada ---------------- */
  async function enterApp() {
    const user = DEMO ? { email: "demo@apollo.com", user_metadata: { full_name: "Cliente Demonstração" } } : session.user;
    const name = user.user_metadata?.full_name || user.user_metadata?.name || "";
    $("#ac-name").textContent = name ? `, ${name.split(" ")[0]}` : "";
    $("#ac-email").textContent = user.email;
    if (name && !$("#ac-company-form").admin_full_name.value) $("#ac-company-form").admin_full_name.value = name;

    const pay = params.get("pagamento"), cadastro = params.get("cadastro"), plano = params.get("plano");
    if (pay || plano) history.replaceState(null, "", location.pathname + (DEMO ? "?demo=1" : ""));

    if (pay === "sucesso" && cadastro) return waitForCompany(cadastro);
    await refreshAccount();
    if (pay === "cancelado") flashCompanies("Pagamento não concluído. Você pode retomar quando quiser.", "warn");
    if (plano && plans.some((p) => p.key === plano)) return selectPlan(plano);
    account?.signups?.length ? showApp("ac-companies") : showPlans();
  }

  async function refreshAccount() {
    const data = await api("/api/conta");
    if (data.status === 401) { show("ac-auth"); return; }
    account = data.ok ? data : { signups: [], apollo_url: "https://apollo-drive.onrender.com/" };
    renderCompanies();
  }

  function flashCompanies(text, tone) {
    const box = document.createElement("p");
    box.className = "ac-msg ac-flash"; box.dataset.tone = tone; box.textContent = text;
    $("#ac-company-list").before(box);
    setTimeout(() => box.remove(), 9000);
  }

  function renderCompanies() {
    const list = $("#ac-company-list");
    list.innerHTML = (account.signups || []).map((s) => {
      const st = STATUS[s.status] || { label: s.status, tone: "muted" };
      const working = ["pago", "provisionando", "falha_temporaria"].includes(s.status);
      const actions = [];
      if (["ativo", "pagamento_pendente"].includes(s.status))
        actions.push(`<a class="btn btn-gold btn-sm" href="${esc(account.apollo_url)}" target="_blank" rel="noopener">Acessar o Apollo Drive <svg class="i"><use href="#i-arrow"/></svg></a>`);
      if (s.status === "aguardando_pagamento") actions.push(`<button class="btn btn-gold btn-sm" data-resume="${esc(s.id)}">Concluir pagamento</button>`);
      if (s.has_billing && s.status !== "aguardando_pagamento") actions.push(`<button class="btn btn-ghost btn-sm" data-portal>${s.status === "pagamento_pendente" ? "Atualizar cartão" : "Gerenciar pagamento"}</button>`);
      if (s.status === "cancelado") actions.push(`<button class="btn btn-ghost btn-sm" data-new>Assinar novamente</button>`);
      if (s.status === "falha") actions.push(`<a class="btn btn-ghost btn-sm" href="${WHATSAPP}" target="_blank" rel="noopener">Falar com o suporte</a>`);
      return `
        <article class="ac-company glass">
          <header>
            <div><h3>${esc(s.company_name)}</h3><span class="ac-plan-tag">Plano ${esc(s.plan_name)}${s.monthly ? ` · R$ ${money(s.monthly)}/mês` : ""}</span></div>
            <span class="ac-status" data-tone="${st.tone}">${working ? '<i class="ac-spin"></i>' : ""}${esc(st.label)}</span>
          </header>
          <dl>
            <div><dt>Código de acesso</dt><dd>${esc(s.slug)}</dd></div>
            <div><dt>Usuário administrador</dt><dd>${esc(s.admin_username)}</dd></div>
            <div><dt>${s.person_type === "pf" ? "CPF" : "CNPJ"}</dt><dd>${esc(s.document_masked)}</dd></div>
            <div><dt>Próximo vencimento</dt><dd>${dateBR(s.next_due_on)}</dd></div>
          </dl>
          ${s.status === "ativo" ? `<p class="ac-note">Entre no sistema com o usuário <b>${esc(s.admin_username)}</b> e a senha que você definiu no cadastro.</p>` : ""}
          ${s.status === "pagamento_pendente" ? `<p class="ac-note" data-tone="warn">Não conseguimos cobrar seu cartão. Atualize a forma de pagamento para não perder o acesso.</p>` : ""}
          ${s.error ? `<p class="ac-note" data-tone="danger">Não conseguimos criar a empresa automaticamente. Nossa equipe já pode resolver para você.</p>` : ""}
          ${working ? `<p class="ac-note">Seu pagamento foi confirmado. A empresa fica pronta em instantes.</p>` : ""}
          <div class="ac-actions">${actions.join("")}</div>
        </article>`;
    }).join("");
    $("#ac-companies").hidden = !(account.signups || []).length;
    if ((account.signups || []).some((s) => ["pago", "provisionando", "falha_temporaria"].includes(s.status))) schedulePoll();
  }

  let pollTimer = null;
  function schedulePoll() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => { await refreshAccount(); }, 5000);
  }

  $("#ac-company-list").addEventListener("click", async (e) => {
    const resume = e.target.closest("[data-resume]"), portal = e.target.closest("[data-portal]"), again = e.target.closest("[data-new]");
    if (again) return showPlans();
    const btn = resume || portal; if (!btn) return;
    btn.disabled = true;
    const data = resume ? await api("/api/checkout", { method: "POST", body: { resume_id: resume.dataset.resume } }) : await api("/api/portal", { method: "POST" });
    btn.disabled = false;
    if (data.ok && data.url) location.href = data.url;
    else flashCompanies(data.error || "Não foi possível continuar agora.", "danger");
  });
  $("#ac-new-company").addEventListener("click", showPlans);

  /* ---------------- Planos ---------------- */
  function showPlans() {
    $("#ac-plan-cards").innerHTML = plans.map((p) => `
      <div class="plan glass ${p.key === "profissional" ? "featured" : ""}">
        ${p.key === "profissional" ? '<span class="ribbon"><svg class="i"><use href="#i-crown"/></svg> MAIS ESCOLHIDO</span>' : ""}
        <h3>${esc(p.name)}</h3>
        <div class="price"><small>R$</small><strong>${money(p.monthly)}</strong><small>/mês</small></div>
        <p class="price-note">até ${p.userLimit} usuários · ${p.storageMb / 1024} GB</p>
        <ul>${(PLAN_FEATURES[p.key] || []).map((f) => `<li><svg class="i"><use href="#i-check"/></svg> ${esc(f)}</li>`).join("")}</ul>
        <button class="btn ${p.key === "profissional" ? "btn-gold" : "btn-ghost"}" data-plan="${p.key}">Escolher ${esc(p.name)}</button>
      </div>`).join("");
    showApp("ac-plans", ...(account?.signups?.length ? ["ac-companies"] : []));
    $("#ac-plans").scrollIntoView({ block: "start" });
  }
  $("#ac-plan-cards").addEventListener("click", (e) => { const b = e.target.closest("[data-plan]"); if (b) selectPlan(b.dataset.plan); });
  $("#ac-back").addEventListener("click", showPlans);

  function selectPlan(key) {
    selectedPlan = plans.find((p) => p.key === key);
    if (!selectedPlan) return showPlans();
    $("#ac-sum-plan").textContent = `Plano ${selectedPlan.name}`;
    $("#ac-sum-price").textContent = money(selectedPlan.monthly);
    $("#ac-sum-users").textContent = `Até ${selectedPlan.userLimit} usuários`;
    $("#ac-sum-storage").textContent = `${selectedPlan.storageMb / 1024} GB de armazenamento`;
    showApp("ac-form-wrap");
  }

  /* ---------------- Formulário da empresa ---------------- */
  const form = $("#ac-company-form");
  const fieldErr = (name, text) => { const el = $(`[data-for="${name}"]`, form); if (el) el.textContent = text || ""; const input = form.elements[name]; if (input?.classList) input.classList.toggle("invalid", !!text); };
  const clearErrors = () => $$(".ac-err", form).forEach((el) => (el.textContent = "")) || $$(".invalid", form).forEach((el) => el.classList.remove("invalid"));
  const personType = () => form.person_type.value;

  function syncPersonType() {
    const pf = personType() === "pf";
    $("#ac-doc-label").textContent = pf ? "CPF" : "CNPJ";
    $("#ac-name-label").textContent = pf ? "Seu nome ou nome comercial" : "Nome da empresa";
    form.document.placeholder = pf ? "000.000.000-00" : "00.000.000/0000-00";
    form.document.value = maskDoc(form.document.value, personType());
    fieldErr("document", "");
  }
  $$("[name=person_type]", form).forEach((r) => r.addEventListener("change", syncPersonType));
  syncPersonType();

  form.document.addEventListener("input", () => { form.document.value = maskDoc(form.document.value, personType()); fieldErr("document", ""); });
  form.document.addEventListener("blur", () => {
    if (!form.document.value) return;
    const ok = personType() === "pf" ? validCPF(form.document.value) : validCNPJ(form.document.value);
    fieldErr("document", ok ? "" : `${personType() === "pf" ? "CPF" : "CNPJ"} inválido.`);
  });

  form.company_name.addEventListener("input", () => {
    if (!slugTouched) { form.slug.value = slugify(form.company_name.value); queueAvailability(); }
    $("#ac-brand-name").textContent = form.company_name.value || "Sua empresa";
  });
  form.slug.addEventListener("input", () => {
    slugTouched = true;
    form.slug.value = form.slug.value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
    queueAvailability();
  });
  form.admin_username.addEventListener("input", queueAvailability);

  // Confere no Apollo Drive se o código e o usuário estão livres
  let availTimer = null;
  function setHint(name, text, tone) { const h = $(`[data-hint="${name}"]`, form); if (h) { h.textContent = text; h.dataset.tone = tone || ""; } }
  function queueAvailability() {
    clearTimeout(availTimer);
    availTimer = setTimeout(checkAvailability, 650);
  }
  async function checkAvailability() {
    const slug = form.slug.value, username = form.admin_username.value.trim();
    if (!validSlug(slug)) { setHint("slug", "Use de 3 a 40 letras minúsculas, números ou hífen.", ""); return; }
    if (!validUsername(username)) { setHint("slug", "Verificando quando o usuário for preenchido…", ""); return; }
    setHint("slug", "Verificando disponibilidade…", ""); setHint("admin_username", "Verificando disponibilidade…", "");
    const data = await api(`/api/disponibilidade?${new URLSearchParams({ slug, username })}`);
    if (!data.ok) { setHint("slug", data.error || "Não foi possível verificar agora.", "warn"); setHint("admin_username", "", ""); return; }
    setHint("slug", data.slug_available ? "✓ Código disponível" : "Este código já está em uso.", data.slug_available ? "ok" : "danger");
    setHint("admin_username", data.username_available ? "✓ Usuário disponível" : "Este usuário já existe no sistema.", data.username_available ? "ok" : "danger");
  }

  function syncPwRules() {
    const v = form.admin_password.value;
    $$("#ac-pw-rules li").forEach((li) => li.classList.toggle("ok", pwRules[li.dataset.rule](v)));
  }
  form.admin_password.addEventListener("input", syncPwRules);

  // Identidade visual: cores e logo com pré-visualização
  function syncBrand() {
    $("#ac-brand-preview").style.background = `linear-gradient(120deg, ${form.primary_color.value}, ${form.secondary_color.value})`;
  }
  form.primary_color.addEventListener("input", syncBrand);
  form.secondary_color.addEventListener("input", syncBrand);
  syncBrand();
  form.logo.addEventListener("change", () => {
    const file = form.logo.files[0], img = $("#ac-brand-preview img");
    logoData = null; img.hidden = true; fieldErr("logo", "");
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) { form.logo.value = ""; return fieldErr("logo", "Use PNG, JPG ou WEBP."); }
    if (file.size > 1024 * 1024) { form.logo.value = ""; return fieldErr("logo", "A logo deve ter até 1 MB."); }
    const reader = new FileReader();
    reader.onload = () => { logoData = { mime: file.type, base64: String(reader.result).split(",")[1] }; img.src = reader.result; img.hidden = false; };
    reader.readAsDataURL(file);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearErrors();
    const out = $("#ac-form-msg"); msg(out, "");
    const pf = personType() === "pf";
    const errors = {};
    if (!(pf ? validCPF(form.document.value) : validCNPJ(form.document.value))) errors.document = `${pf ? "CPF" : "CNPJ"} inválido.`;
    if (form.company_name.value.trim().length < 2) errors.company_name = "Informe o nome.";
    if (!validSlug(form.slug.value)) errors.slug = "Use de 3 a 40 letras minúsculas, números ou hífen.";
    if (form.admin_full_name.value.trim().length < 2) errors.admin_full_name = "Informe o nome do administrador.";
    if (!validUsername(form.admin_username.value.trim())) errors.admin_username = "Use de 3 a 40 letras, números, ponto, hífen ou sublinhado.";
    if (!Object.values(pwRules).every((r) => r(form.admin_password.value))) errors.admin_password = "A senha não atende às regras abaixo.";
    if (form.admin_password.value !== form.admin_password2.value) errors.admin_password2 = "As senhas não conferem.";
    if (!form.accept_terms.checked) errors.accept_terms = "É preciso aceitar os termos para continuar.";
    if (Object.keys(errors).length) {
      Object.entries(errors).forEach(([k, v]) => fieldErr(k, v));
      msg(out, "Revise os campos destacados.");
      form.querySelector(".invalid, .ac-err:not(:empty)")?.closest(".ac-field, .ac-check")?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }

    const btn = $("#ac-pay"); btn.disabled = true; btn.firstChild.textContent = "Abrindo pagamento seguro… ";
    const data = await api("/api/checkout", {
      method: "POST",
      body: {
        plan_key: selectedPlan.key,
        person_type: personType(),
        document: form.document.value,
        company_name: form.company_name.value.trim(),
        slug: form.slug.value,
        admin_full_name: form.admin_full_name.value.trim(),
        admin_username: form.admin_username.value.trim(),
        admin_password: form.admin_password.value,
        primary_color: form.primary_color.value,
        secondary_color: form.secondary_color.value,
        logo_base64: logoData?.base64 || null,
        logo_mime: logoData?.mime || null,
        accept_terms: true,
      },
    });
    if (data.ok && data.url) { location.href = data.url; return; }
    btn.disabled = false; btn.firstChild.textContent = "Ir para o pagamento ";
    if (data.fields) Object.entries(data.fields).forEach(([k, v]) => fieldErr(k, v));
    msg(out, data.error || "Não foi possível abrir o pagamento.");
  });

  /* ---------------- Depois do pagamento ---------------- */
  async function waitForCompany(id) {
    showApp("ac-wait");
    const title = $("#ac-wait-title"), text = $("#ac-wait-text");
    for (let i = 0; i < 45; i++) {
      await refreshAccount();
      const s = (account.signups || []).find((x) => x.id === id);
      if (s?.status === "ativo") {
        $("#ac-wait").classList.add("done");
        title.textContent = "Tudo pronto! Sua empresa foi criada.";
        text.innerHTML = `Entre no Apollo Drive com o usuário <b>${esc(s.admin_username)}</b> e a senha que você definiu.`;
        const a = document.createElement("a");
        a.className = "btn btn-gold"; a.href = account.apollo_url; a.target = "_blank"; a.rel = "noopener";
        a.innerHTML = 'Acessar o Apollo Drive <svg class="i"><use href="#i-arrow"/></svg>';
        text.after(a);
        $("#ac-companies").hidden = false;
        return;
      }
      if (s?.status === "falha") {
        title.textContent = "Pagamento confirmado, mas precisamos finalizar sua empresa.";
        text.innerHTML = `Nossa equipe vai concluir o cadastro para você. <a class="ac-inline" href="${WHATSAPP}" target="_blank" rel="noopener">Falar com o suporte</a>.`;
        $("#ac-companies").hidden = false;
        return;
      }
      await sleep(i < 10 ? 3000 : 6000);
    }
    title.textContent = "Estamos finalizando sua empresa.";
    text.textContent = "Seu pagamento foi recebido. Atualize esta página em alguns minutos para ver o acesso.";
    $("#ac-companies").hidden = false;
  }

  /* ---------------- Modo demonstração (sem contas reais) ---------------- */
  function startDemo() {
    $("#ac-demo").hidden = false;
    plans = [
      { key: "essencial", name: "Essencial", monthly: 349, userLimit: 3, storageMb: 2048 },
      { key: "profissional", name: "Profissional", monthly: 1290, userLimit: 10, storageMb: 5120 },
      { key: "gestao", name: "Gestão", monthly: 2199, userLimit: 30, storageMb: 10240 },
    ];
    $$('a[href="area-cliente.html"]').forEach((a) => (a.href = "area-cliente.html?demo=1"));
    if (sessionStorage.getItem("apolloDemo") || params.get("pagamento")) return enterApp();
    show("ac-auth");
    $("#ac-auth-form").addEventListener("submit", (e) => { e.preventDefault(); e.stopImmediatePropagation(); sessionStorage.setItem("apolloDemo", "[]"); enterApp(); }, true);
    $("#ac-google").addEventListener("click", (e) => { e.stopImmediatePropagation(); sessionStorage.setItem("apolloDemo", "[]"); enterApp(); }, true);
  }
  function demoApi(path, method, body) {
    const store = JSON.parse(sessionStorage.getItem("apolloDemo") || "[]");
    const save = () => sessionStorage.setItem("apolloDemo", JSON.stringify(store));
    const plan = (k) => plans.find((p) => p.key === k);
    if (path.startsWith("/api/conta")) {
      store.forEach((s) => { if (s.status === "pago" && ++s.polls >= 2) s.status = "ativo"; });
      save();
      return { ok: true, status: 200, apollo_url: "https://apollo-drive.onrender.com/", signups: store };
    }
    if (path.startsWith("/api/disponibilidade")) {
      const q = new URLSearchParams(path.split("?")[1]);
      return { ok: true, status: 200, slug_available: q.get("slug") !== "apollo", username_available: q.get("username").toLowerCase() !== "admin" };
    }
    if (path.startsWith("/api/checkout")) {
      const id = "demo-" + Date.now();
      const p = plan(body.plan_key);
      const due = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
      store.unshift({ id, status: "pago", polls: 0, plan_key: p.key, plan_name: p.name, monthly: p.monthly, company_name: body.company_name, slug: body.slug,
        person_type: body.person_type, document_masked: onlyDigits(body.document).replace(/\d(?=\d{4})/g, "•"), admin_username: body.admin_username, next_due_on: due, has_billing: true });
      save();
      return { ok: true, status: 200, url: `area-cliente.html?demo=1&pagamento=sucesso&cadastro=${id}` };
    }
    if (path.startsWith("/api/portal")) return { ok: false, status: 400, error: "No modo demonstração o portal da Stripe não abre." };
    return { ok: false, status: 404, error: "Indisponível." };
  }

  init().catch((err) => {
    console.error("[Área do cliente]", err);
    show("ac-auth");
    msg($("#ac-auth-msg"), "Não foi possível carregar a Área do Cliente. Atualize a página.");
  });
})();
