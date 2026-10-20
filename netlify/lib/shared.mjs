// Núcleo compartilhado das funções da Área do Cliente.
// Variáveis de ambiente (configurar no painel da Netlify): ver AREA_CLIENTE_SETUP.md
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import crypto from "node:crypto";

/* ---------------- Planos (fonte única de verdade no servidor) ---------------- */
// Preço e limites nunca vêm do navegador: o cliente só escolhe a chave do plano.
export const PLANS = {
  essencial:    { key: "essencial",    name: "Essencial",    monthly: 349,  userLimit: 3,  storageMb: 2048,  priceEnv: "STRIPE_PRICE_ESSENCIAL" },
  profissional: { key: "profissional", name: "Profissional", monthly: 1290, userLimit: 10, storageMb: 5120,  priceEnv: "STRIPE_PRICE_PROFISSIONAL" },
  gestao:       { key: "gestao",       name: "Gestão",       monthly: 2199, userLimit: 30, storageMb: 10240, priceEnv: "STRIPE_PRICE_GESTAO" },
};

export const env = (name, fallback) => {
  const v = process.env[name];
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Variável de ambiente ausente: ${name}`);
  }
  return v;
};

export const siteUrl = () => env("SITE_URL", "https://apollocompany.netlify.app").replace(/\/+$/, "");
export const apolloLoginUrl = () => env("APOLLO_LOGIN_URL", "https://apollo-drive.onrender.com/");

/* ---------------- Clientes de serviço ---------------- */
let _supabase, _stripe;
export const supabaseAdmin = () =>
  (_supabase ??= createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } }));
export const stripe = () => (_stripe ??= new Stripe(env("STRIPE_SECRET_KEY")));

/* ---------------- Respostas ---------------- */
export const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
export const fail = (status, error, extra = {}) => json(status, { ok: false, error, ...extra });

/* ---------------- Autenticação (token do Supabase vindo do navegador) ---------------- */
export async function requireUser(req) {
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  const { data, error } = await supabaseAdmin().auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

/* ---------------- Validações ---------------- */
export const onlyDigits = (v) => String(v || "").replace(/\D/g, "");

export function validCPF(value) {
  const c = onlyDigits(value);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (len) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(c[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10]);
}

export function validCNPJ(value) {
  const c = onlyDigits(value);
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const dv = (len) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((s, w, i) => s + w * Number(c[i]), 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(c[12]) && dv(13) === Number(c[13]);
}

// Mesma regra do Apollo Drive (valid_new_password): 10+ caracteres, maiúscula, minúscula, número e símbolo.
export const validPassword = (v) =>
  typeof v === "string" && v.length >= 10 && /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v) && /[^A-Za-z0-9]/.test(v);

export const validSlug = (v) => /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(v || "");
export const validUsername = (v) => /^[A-Za-z0-9._-]{3,40}$/.test(v || "");
export const validColor = (v) => /^#[0-9a-fA-F]{6}$/.test(v || "");

export const slugify = (v) =>
  String(v || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

/* ---------------- Senha no formato do Werkzeug (Flask) ---------------- */
// Gera "scrypt:32768:8:1$<sal>$<hex>", idêntico ao generate_password_hash() padrão do Apollo Drive.
// Assim a senha em texto puro nunca é guardada nem trafega até o sistema.
const SALT_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
export function werkzeugScryptHash(password) {
  const bytes = crypto.randomBytes(16);
  const salt = Array.from(bytes, (b) => SALT_CHARS[b % SALT_CHARS.length]).join("");
  const N = 32768, r = 8, p = 1;
  const key = crypto.scryptSync(password, salt, 64, { N, r, p, maxmem: 128 * N * r * p * 2 });
  return `scrypt:${N}:${r}:${p}$${salt}$${key.toString("hex")}`;
}

/* ---------------- Apollo Drive (API de provisionamento) ---------------- */
async function apolloFetch(path, { method = "GET", body, timeoutMs = 9000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(env("APOLLO_API_URL").replace(/\/+$/, "") + path, {
      method,
      signal: ctrl.signal,
      headers: { authorization: `Bearer ${env("APOLLO_PROVISION_TOKEN")}`, "content-type": "application/json", accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch { /* resposta sem JSON */ }
    return { status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkAvailability(slug, username) {
  const q = new URLSearchParams({ slug, username });
  const { status, data } = await apolloFetch(`/api/disponibilidade?${q}`);
  if (status !== 200) throw new Error(`Apollo Drive respondeu ${status} na verificação de disponibilidade`);
  return { slugAvailable: !!data.slug_available, usernameAvailable: !!data.username_available };
}

// Cadastros de outras pessoas que "seguram" um código/usuário (pagos, ou aguardando pagamento há menos de 2h)
export async function reservedByOthers(userId, slug, username) {
  const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data } = await supabaseAdmin()
    .from("signups")
    .select("slug, admin_username, status, created_at, user_id")
    .neq("user_id", userId)
    .or(`slug.ilike.${slug},admin_username.ilike.${username}`)
    .in("status", ["aguardando_pagamento", "pago", "provisionando", "falha_temporaria", "ativo", "pagamento_pendente"]);
  const live = (data || []).filter((r) => r.status !== "aguardando_pagamento" || r.created_at >= since);
  return {
    slugTaken: live.some((r) => r.slug.toLowerCase() === slug.toLowerCase()),
    usernameTaken: live.some((r) => r.admin_username.toLowerCase() === username.toLowerCase()),
  };
}

/* ---------------- Provisionamento da empresa ---------------- */
// Idempotente: pode ser chamado pelo webhook e pela Área do Cliente quantas vezes for preciso.
// Retorna { done: true } quando a empresa existe; { done: false, transient: true } para tentar de novo depois.
export async function provisionSignup(signupId) {
  const db = supabaseAdmin();
  const { data: s, error } = await db.from("signups").select("*").eq("id", signupId).single();
  if (error || !s) return { done: false, transient: false, reason: "cadastro não encontrado" };
  if (s.status === "ativo" && s.apollo_company_id) return { done: true };
  if (!["pago", "provisionando", "falha_temporaria"].includes(s.status)) return { done: false, transient: false, reason: `status ${s.status}` };

  const plan = PLANS[s.plan_key];
  await db.from("signups").update({ status: "provisionando", updated_at: new Date().toISOString() }).eq("id", s.id);

  const payload = {
    external_ref: s.id,
    company_name: s.company_name,
    slug: s.slug,
    document_type: s.person_type === "pf" ? "cpf" : "cnpj",
    document: s.document,
    plan_name: plan.name,
    user_limit: plan.userLimit,
    storage_limit_mb: plan.storageMb,
    monthly_amount: plan.monthly,
    currency: "BRL",
    payment_method: "Cartão de crédito (Stripe)",
    due_on: s.next_due_on,
    admin_username: s.admin_username,
    admin_full_name: s.admin_full_name,
    admin_password_hash: s.admin_password_hash,
    primary_color: s.primary_color,
    secondary_color: s.secondary_color,
    logo_base64: s.logo_base64 || null,
    logo_mime: s.logo_mime || null,
    contact_email: s.email,
    stripe_customer_id: s.stripe_customer_id,
    stripe_subscription_id: s.stripe_subscription_id,
  };

  let result;
  try {
    result = await apolloFetch("/api/provisionar-empresa", { method: "POST", body: payload, timeoutMs: 9000 });
  } catch (err) {
    // Render no plano gratuito pode estar "dormindo": tenta de novo depois
    await db.from("signups").update({ status: "falha_temporaria", last_error: String(err?.message || err).slice(0, 500), updated_at: new Date().toISOString() }).eq("id", s.id);
    return { done: false, transient: true, reason: "Apollo Drive indisponível no momento" };
  }

  if (result.status === 200 || result.status === 201) {
    await db.from("signups").update({
      status: "ativo",
      apollo_company_id: result.data.company_id ?? null,
      admin_password_hash: null, // não precisa mais guardar
      logo_base64: null,
      last_error: null,
      activated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", s.id);
    return { done: true };
  }

  const transient = result.status >= 500 || result.status === 429;
  await db.from("signups").update({
    status: transient ? "falha_temporaria" : "falha",
    last_error: `${result.status}: ${result.data?.error || "erro"}`.slice(0, 500),
    updated_at: new Date().toISOString(),
  }).eq("id", s.id);
  return { done: false, transient, reason: result.data?.error || `erro ${result.status}` };
}

/* ---------------- Resumo seguro para o navegador ---------------- */
export const publicSignup = (s) => ({
  id: s.id,
  status: s.status,
  plan_key: s.plan_key,
  plan_name: PLANS[s.plan_key]?.name || s.plan_key,
  monthly: PLANS[s.plan_key]?.monthly ?? null,
  company_name: s.company_name,
  slug: s.slug,
  person_type: s.person_type,
  document_masked: s.document ? s.document.replace(/\d(?=\d{4})/g, "•") : "",
  admin_username: s.admin_username,
  next_due_on: s.next_due_on,
  created_at: s.created_at,
  activated_at: s.activated_at,
  has_billing: !!s.stripe_customer_id,
  error: s.status === "falha" ? s.last_error : null,
});
