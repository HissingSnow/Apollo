// GET /api/conta — cadastros/empresas do cliente logado.
// Se um pagamento já foi confirmado e a empresa ainda não existe, tenta criá-la de novo (idempotente).
import { requireUser, json, fail, supabaseAdmin, provisionSignup, publicSignup, apolloLoginUrl } from "../lib/shared.mjs";

const RETRY_STATUSES = ["pago", "falha_temporaria", "provisionando"];

export default async (req) => {
  const user = await requireUser(req);
  if (!user) return fail(401, "Faça login para continuar.");
  const db = supabaseAdmin();

  const load = async () => {
    const { data } = await db.from("signups").select("*").eq("user_id", user.id).neq("status", "expirado").order("created_at", { ascending: false });
    return data || [];
  };

  let signups = await load();
  const pending = signups.find((s) =>
    RETRY_STATUSES.includes(s.status) &&
    // evita duas tentativas simultâneas: "provisionando" só é refeito se ficou parado por mais de 30s
    (s.status !== "provisionando" || Date.now() - new Date(s.updated_at).getTime() > 30_000));
  if (pending) {
    await provisionSignup(pending.id).catch((err) => console.error("[conta] provision", err));
    signups = await load();
  }

  return json(200, {
    ok: true,
    email: user.email,
    apollo_url: apolloLoginUrl(),
    signups: signups.map(publicSignup),
  });
};

export const config = { path: "/api/conta" };
