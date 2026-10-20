// GET /api/config — dados públicos para o navegador (chave pública do Supabase e planos)
import { env, json, PLANS } from "../lib/shared.mjs";

export default async () => {
  try {
    return json(200, {
      ok: true,
      supabaseUrl: env("SUPABASE_URL"),
      supabaseAnonKey: env("SUPABASE_ANON_KEY"),
      plans: Object.values(PLANS).map(({ key, name, monthly, userLimit, storageMb }) => ({ key, name, monthly, userLimit, storageMb })),
    });
  } catch (err) {
    return json(503, { ok: false, error: "Área do Cliente ainda não configurada." });
  }
};

export const config = { path: "/api/config" };
