// POST /api/stripe-webhook — confirmações enviadas pela Stripe (assinatura verificada).
// Eventos usados: checkout.session.completed, invoice.paid, invoice.payment_failed, customer.subscription.deleted
import { env, json, fail, supabaseAdmin, stripe, provisionSignup } from "../lib/shared.mjs";

const isoDate = (unix) => (unix ? new Date(unix * 1000).toISOString().slice(0, 10) : null);

// A data do próximo vencimento fica no item da assinatura nas versões novas da API da Stripe
function periodEnd(sub) {
  return sub?.current_period_end ?? sub?.items?.data?.[0]?.current_period_end ?? null;
}

async function bySubscription(subscriptionId) {
  if (!subscriptionId) return null;
  const { data } = await supabaseAdmin().from("signups").select("*").eq("stripe_subscription_id", subscriptionId).maybeSingle();
  return data;
}

export default async (req) => {
  if (req.method !== "POST") return fail(405, "Método não permitido.");
  const raw = await req.text();
  let event;
  try {
    event = stripe().webhooks.constructEvent(raw, req.headers.get("stripe-signature") || "", env("STRIPE_WEBHOOK_SECRET"));
  } catch (err) {
    return fail(400, "Assinatura do webhook inválida.");
  }

  const db = supabaseAdmin();
  const now = new Date().toISOString();

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const signupId = session.metadata?.signup_id || session.client_reference_id;
        if (!signupId || session.mode !== "subscription") break;
        if (session.payment_status !== "paid") break; // cartão: normalmente já vem "paid"

        const sub = session.subscription ? await stripe().subscriptions.retrieve(session.subscription) : null;
        await db.from("signups").update({
          status: "pago",
          stripe_customer_id: session.customer,
          stripe_subscription_id: session.subscription,
          next_due_on: isoDate(periodEnd(sub)),
          paid_at: now,
          updated_at: now,
        }).eq("id", signupId).eq("status", "aguardando_pagamento");

        const result = await provisionSignup(signupId);
        // Falha temporária (ex.: Render acordando): responde 500 para a Stripe reenviar mais tarde.
        if (!result.done && result.transient) return fail(500, "Provisionamento será tentado novamente.");
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object;
        const subId = invoice.subscription || invoice.parent?.subscription_details?.subscription;
        const s = await bySubscription(subId);
        if (!s) break;
        const sub = await stripe().subscriptions.retrieve(subId);
        const patch = { next_due_on: isoDate(periodEnd(sub)), updated_at: now };
        if (s.status === "pagamento_pendente") patch.status = "ativo";
        await db.from("signups").update(patch).eq("id", s.id);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object;
        const s = await bySubscription(invoice.subscription || invoice.parent?.subscription_details?.subscription);
        if (s && s.status === "ativo") await db.from("signups").update({ status: "pagamento_pendente", updated_at: now }).eq("id", s.id);
        break;
      }

      case "customer.subscription.deleted": {
        const s = await bySubscription(event.data.object.id);
        if (s) await db.from("signups").update({ status: "cancelado", updated_at: now }).eq("id", s.id);
        break;
      }
    }
  } catch (err) {
    console.error("[stripe-webhook]", event.type, err);
    return fail(500, "Erro ao processar o evento.");
  }

  return json(200, { ok: true });
};

export const config = { path: "/api/stripe-webhook" };
