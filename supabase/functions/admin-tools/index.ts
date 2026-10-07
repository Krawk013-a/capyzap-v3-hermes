// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ============================================================
// CapyZap — admin-tools
// POST { action: "list" }                       → lista usuários
// POST { action: "impersonate", target_id: "…" } → gera token de acesso
//                                                  como o usuário (com auditoria)
// Requer: quem chama é admin (is_admin) e usa o próprio token.
// ============================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: CORS });

async function getAdmin(req: Request): Promise<{ user: any; admin: any } | null> {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth) return null;
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
  });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return null;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: profile } = await admin
    .from("profiles")
    .select("id, is_admin, first_name")
    .eq("id", user.id)
    .single();
  if (!profile?.is_admin) return null;
  return { user, admin };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const ctx = await getAdmin(req);
    if (!ctx) return json({ error: "not-authorized" }, 403);

    const body = await req.json().catch(() => ({}));

    // ---------- LISTAR CONTAS ----------
    if (body.action === "list") {
      const { data } = await ctx.admin
        .from("profiles")
        .select("id, email, first_name, last_name, handle, avatar_url, is_admin, created_at, last_seen_at")
        .order("created_at", { ascending: false })
        .limit(200);
      return json({ users: data ?? [] });
    }

    // ---------- ENTRAR COMO (impersonate) ----------
    if (body.action === "impersonate" && body.target_id) {
      const targetId = String(body.target_id);

      // auditoria: registra QUEM entrou COMO QUEM
      await ctx.admin.from("admin_audit").insert({
        admin_id: ctx.user.id,
        target_id: targetId,
        action: "impersonate",
      });

      // gera um token de acesso limitado ao usuário alvo
      const { data: link, error } = await ctx.admin.auth.admin.generateLink({
        type: "magiclink",
        email: (await ctx.admin
          .from("profiles")
          .select("email")
          .eq("id", targetId)
          .single()).data?.email ?? "",
      });
      if (error || !link) return json({ error: "link-failed", detail: error?.message }, 500);

      // troca o magic link por uma sessão de verdade (propria API do supabase)
      const verifyRes = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
        method: "POST",
        headers: {
          apikey: ANON_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "magiclink",
          token: link.properties?.hashed_token ?? link.action_link.split("token=")[1]?.split("&")[0],
          redirect_to: `${SUPABASE_URL}/auth/v1/verify`,
        }),
      });
      const verifyJson: any = await verifyRes.json();
      if (!verifyJson?.access_token) {
        return json({ error: "verify-failed", detail: JSON.stringify(verifyJson).slice(0, 300) }, 500);
      }

      return json({
        access_token: verifyJson.access_token,
        refresh_token: verifyJson.refresh_token,
        target: targetId,
      });
    }

    return json({ error: "unknown-action" }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
