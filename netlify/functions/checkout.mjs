// POST /api/checkout — valida os dados da empresa, reserva o cadastro e abre o pagamento na Stripe.
// Corpo: { plan_key, person_type, document, company_name, slug, admin_full_name, admin_username,
//          admin_password, primary_color, secondary_color, logo_base64?, logo_mime?, accept_terms }
//   ou:  { resume_id } para retomar um pagamento que ficou pendente.
import {
  PLANS, env, siteUrl, json, fail, requireUser, supabaseAdmin, stripe,
  validCPF, validCNPJ, validPassword, validSlug, validUsername, validColor, onlyDigits,
  werkzeugScryptHash, checkAvailability, reservedByOthers,
} from "../lib/shared.mjs";

const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];
const LOGO_MAX_B64 = 1_400_000; // ~1 MB de imagem

function validate(b) {
  const errors = {};
  if (!PLANS[b.plan_key]) errors.plan_key = "Escolha um plano.";
  if (!["pf", "pj"].includes(b.person_type)) errors.person_type = "Informe se é pessoa física ou jurídica.";
  if (b.person_type === "pf" && !validCPF(b.document)) errors.document = "CPF inválido.";
  if (b.person_type === "pj" && !validCNPJ(b.document)) errors.document = "CNPJ inválido.";
  const name = String(b.company_name || "").trim();
  if (name.length < 2 || name.length > 120) errors.company_name = "Informe o nome da empresa.";
  if (!validSlug(String(b.slug || "").toLowerCase())) errors.slug = "Use de 3 a 40 letras minúsculas, números ou hífen.";
  const fullName = String(b.admin_full_name || "").trim();
  if (fullName.length < 2 || fullName.length > 120) errors.admin_full_name = "Informe o nome do administrador.";
  if (!validUsername(b.admin_username)) errors.admin_username = "Use de 3 a 40 letras, números, ponto, hífen ou sublinhado.";
  if (!validPassword(b.admin_password)) errors.admin_password = "Use ao menos 10 caracteres, com maiúscula, minúscula, número e símbolo.";
  if (b.primary_color && !validColor(b.primary_color)) errors.primary_color = "Cor inválida.";
  if (b.secondary_color && !validColor(b.secondary_color)) errors.secondary_color = "Cor inválida.";
  if (b.logo_base64) {
    if (!LOGO_TYPES.includes(b.logo_mime)) errors.logo = "Logo deve ser PNG, JPG ou WEBP.";
    else if (String(b.logo_base64).length > LOGO_MAX_B64) errors.logo = "Logo deve ter até 1 MB.";
  }
  if (b.accept_terms !== true) errors.accept_terms = "É preciso aceitar os termos.";
  return errors;
}

async function stripeCustomerFor(user, db) {
  const { data } = await db.from("signups").select("stripe_customer_id").eq("user_id", user.id).not("stripe_customer_id", "is", null).limit(1);
  if (data?.[0]?.stripe_customer_id) return data[0].stripe_customer_id;
  const customer = await stripe().customers.create({ email: user.email, metadata: { supabase_user_id: user.id } });
  return customer.id;
}

async function openCheckout(signup, user, db) {
  const plan = PLANS[signup.plan_key];
  const customerId = signup.stripe_customer_id || (await stripeCustomerFor(user, db));
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    payment_method_types: ["card"],
    line_items: [{ price: env(plan.priceEnv), quantity: 1 }],
    client_reference_id: signup.id,
    metadata: { signup_id: signup.id },
    subscription_data: { metadata: { signup_id: signup.id, plano: plan.name, empresa: signup.company_name } },
    locale: "pt-BR",
    success_url: `${siteUrl()}/area-cliente.html?pagamento=sucesso&cadastro=${signup.id}`,
    cancel_url: `${siteUrl()}/area-cliente.html?pagamento=cancelado&cadastro=${signup.id}`,
  });
  await db.from("signups").update({ stripe_customer_id: customerId, stripe_session_id: session.id, updated_at: new Date().toISOString() }).eq("id", signup.id);
  return session.url;
}

export default async (req) => {
  if (req.method !== "POST") return fail(405, "Método não permitido.");
  const user = await requireUser(req);
  if (!user) return fail(401, "Faça login para continuar.");
  let b;
  try { b = await req.json(); } catch { return fail(400, "Dados inválidos."); }
  const db = supabaseAdmin();

  try {
    /* Retomar pagamento pendente */
    if (b.resume_id) {
      const { data: s } = await db.from("signups").select("*").eq("id", b.resume_id).eq("user_id", user.id).single();
      if (!s || s.status !== "aguardando_pagamento") return fail(409, "Este cadastro não está aguardando pagamento.");
      if (!s.admin_password_hash) return fail(409, "Cadastro expirado. Preencha os dados novamente.");
      const avail = await checkAvailability(s.slug, s.admin_username);
      const local = await reservedByOthers(user.id, s.slug, s.admin_username);
      if (!avail.slugAvailable || local.slugTaken) return fail(409, "O código de acesso desta empresa foi ocupado. Faça um novo cadastro.");
      if (!avail.usernameAvailable || local.usernameTaken) return fail(409, "O usuário administrador foi ocupado. Faça um novo cadastro.");
      return json(200, { ok: true, url: await openCheckout(s, user, db) });
    }

    /* Novo cadastro */
    b.slug = String(b.slug || "").toLowerCase().trim();
    b.admin_username = String(b.admin_username || "").trim();
    const errors = validate(b);
    if (Object.keys(errors).length) return fail(422, "Revise os campos destacados.", { fields: errors });

    let avail;
    try { avail = await checkAvailability(b.slug, b.admin_username); }
    catch { return fail(503, "O Apollo Drive está iniciando. Aguarde alguns segundos e tente de novo."); }
    const local = await reservedByOthers(user.id, b.slug, b.admin_username);
    const fields = {};
    if (!avail.slugAvailable || local.slugTaken) fields.slug = "Este código já está em uso. Escolha outro.";
    if (!avail.usernameAvailable || local.usernameTaken) fields.admin_username = "Este usuário já existe no sistema. Escolha outro.";
    if (Object.keys(fields).length) return fail(409, "Código ou usuário indisponível.", { fields });

    // Um cadastro pendente anterior do mesmo usuário é substituído pelo novo
    await db.from("signups").update({ status: "expirado", admin_password_hash: null, logo_base64: null, updated_at: new Date().toISOString() })
      .eq("user_id", user.id).eq("status", "aguardando_pagamento");

    const { data: signup, error } = await db.from("signups").insert({
      user_id: user.id,
      email: user.email,
      status: "aguardando_pagamento",
      plan_key: b.plan_key,
      person_type: b.person_type,
      document: onlyDigits(b.document),
      company_name: String(b.company_name).trim(),
      slug: b.slug,
      admin_full_name: String(b.admin_full_name).trim(),
      admin_username: b.admin_username,
      admin_password_hash: werkzeugScryptHash(b.admin_password),
      primary_color: b.primary_color || "#5B21B6",
      secondary_color: b.secondary_color || "#0891B2",
      logo_base64: b.logo_base64 || null,
      logo_mime: b.logo_base64 ? b.logo_mime : null,
      accepted_terms_at: new Date().toISOString(),
    }).select("*").single();
    if (error) throw error;

    return json(200, { ok: true, url: await openCheckout(signup, user, db) });
  } catch (err) {
    console.error("[checkout]", err);
    return fail(500, "Não foi possível iniciar o pagamento. Tente novamente em instantes.");
  }
};

export const config = { path: "/api/checkout" };
