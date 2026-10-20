// POST /api/portal — abre o portal da Stripe para o cliente trocar cartão, ver faturas ou cancelar
import { requireUser, json, fail, supabaseAdmin, stripe, siteUrl } from "../lib/shared.mjs";

export default async (req) => {
  if (req.method !== "POST") return fail(405, "Método não permitido.");
  const user = await requireUser(req);
  if (!user) return fail(401, "Faça login para continuar.");
  const { data } = await supabaseAdmin().from("signups").select("stripe_customer_id")
    .eq("user_id", user.id).not("stripe_subscription_id", "is", null).order("created_at", { ascending: false }).limit(1);
  const customer = data?.[0]?.stripe_customer_id;
  if (!customer) return fail(404, "Nenhuma assinatura encontrada.");
  try {
    const session = await stripe().billingPortal.sessions.create({ customer, return_url: `${siteUrl()}/area-cliente.html`, locale: "pt-BR" });
    return json(200, { ok: true, url: session.url });
  } catch (err) {
    console.error("[portal]", err);
    return fail(500, "Não foi possível abrir o portal de pagamentos.");
  }
};

export const config = { path: "/api/portal" };
