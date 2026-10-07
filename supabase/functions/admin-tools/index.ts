// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ============================================================
// CapyZap — admin-tools (apenas informativo)
// POST { action: "list" } → lista contas (nome, e-mail, visto)
// Não há — e não deve haver — acesso à conta de outro usuário.
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
    .select("id, is_admin")
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

    if (body.action === "list") {
      const { data } = await ctx.admin
        .from("profiles")
        .select("id, email, first_name, last_name, handle, avatar_url, is_admin, created_at, last_seen_at")
        .order("created_at", { ascending: false })
        .limit(200);
      return json({ users: data ?? [] });
    }

    return json({ error: "unknown-action" }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
