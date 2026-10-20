// GET /api/disponibilidade?slug=...&username=... — confere código da empresa e usuário ANTES do pagamento
import { requireUser, json, fail, checkAvailability, reservedByOthers, validSlug, validUsername } from "../lib/shared.mjs";

export default async (req) => {
  const user = await requireUser(req);
  if (!user) return fail(401, "Faça login para continuar.");
  const url = new URL(req.url);
  const slug = (url.searchParams.get("slug") || "").toLowerCase();
  const username = url.searchParams.get("username") || "";
  if (!validSlug(slug)) return fail(400, "Código de acesso inválido.");
  if (!validUsername(username)) return fail(400, "Usuário inválido.");
  try {
    const [apollo, local] = await Promise.all([checkAvailability(slug, username), reservedByOthers(user.id, slug, username)]);
    return json(200, {
      ok: true,
      slug_available: apollo.slugAvailable && !local.slugTaken,
      username_available: apollo.usernameAvailable && !local.usernameTaken,
    });
  } catch (err) {
    return fail(503, "Não foi possível verificar agora. O sistema pode estar iniciando; tente de novo em alguns segundos.");
  }
};

export const config = { path: "/api/disponibilidade" };
