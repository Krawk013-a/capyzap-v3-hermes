// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

// ============================================================
// CapyZap — notify-push v2
// 1) Webhook (INSERT em messages) → push pros participantes
// 2) MODO TESTE: POST /notify-push?test=1 com Authorization do
//    usuário logado → push de teste pra TODOS os devices dele.
//    Usado pela tela /notifications p/ diagnosticar o caminho.
// ============================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:capyzap@example.com";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Content-Type": "application/json",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: CORS });

function vapidStatus(): { ok: boolean; reason?: string } {
  if (!VAPID_PUBLIC) return { ok: false, reason: "VAPID_PUBLIC_KEY missing" };
  if (!VAPID_PRIVATE) return { ok: false, reason: "VAPID_PRIVATE_KEY missing" };
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `invalid VAPID configuration: ${String(e).slice(0, 180)}` };
  }
}

function vapidReady(): boolean {
  return vapidStatus().ok;
}

type SendError = { statusCode?: number; message: string };

async function sendTo(
  admin: ReturnType<typeof createClient>,
  subs: any[],
  payload: Record<string, unknown>
): Promise<{ sent: number; failed: number; errors: SendError[]; deadEndpoints: string[] }> {
  const dead: string[] = [];
  const errors: SendError[] = [];
  let sent = 0;
  let failed = 0;
  await Promise.allSettled(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload)
        );
        sent += 1;
      } catch (err: any) {
        failed += 1;
        errors.push({
          statusCode: err?.statusCode,
          message: String(err?.body ?? err?.message ?? "unknown").slice(0, 200),
        });
        const code = err?.statusCode;
        if (code === 404 || code === 410) dead.push(s.endpoint);
      }
    })
  );
  for (const e of dead) {
    await admin.from("push_subscriptions").delete().eq("endpoint", e);
  }
  return { sent, failed, errors, deadEndpoints: dead };
}

Deno.serve(async (req) => {
  // CORS preflight (o browser manda OPTIONS antes do POST de teste)
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const url = new URL(req.url);
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // ============ MODO TESTE (?test=1) ============
    if (url.searchParams.get("test") === "1") {
      const authHeader = req.headers.get("Authorization") ?? "";
      if (!authHeader) return json({ error: "missing-token" }, 401);

      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: userErr } = await userClient.auth.getUser();
      if (userErr || !user) return json({ error: "invalid-session" }, 401);

      const { data: subs, error: subsErr } = await admin
        .from("push_subscriptions")
        .select("endpoint, p256dh, auth")
        .eq("user_id", user.id);

      if (subsErr) {
        return json({ error: "subscription-query-failed", detail: subsErr.message }, 500);
      }

      if (!subs || subs.length === 0) {
        return json({ error: "no-subscriptions" }, 400);
      }
      const vapid = vapidStatus();
      if (!vapid.ok) {
        return json({
          error: "vapid-missing",
          detail: vapid.reason,
          hint: "Configure VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in Supabase Edge Function Secrets.",
        }, 500);
      }

      const r = await sendTo(admin, subs as any[], {
        title: "CapyZap — teste do servidor 🔔",
        body: "Se você está vendo isso, o push funciona até com o app fechado!",
        url: "/chat",
        tag: "capyzap-test",
      });
      // vapidPubPrefix: p/ o app comparar com a chave que o NAVEGADOR usou
      return json({ ...r, subs: subs.length, vapidPubPrefix: VAPID_PUBLIC.slice(0, 16) });
    }

    // ============ WEBHOOK (INSERT em messages) ============
    const vapid = vapidStatus();
    if (!vapid.ok) {
      console.error("[notify-push] VAPID configuration error:", vapid.reason);
      return json({ error: "vapid-missing", detail: vapid.reason }, 500);
    }

    const payload = await req.json();
    const record = payload.record ?? payload.new ?? payload;
    const { conversation_id, sender_id, kind, body } = record as {
      conversation_id: string;
      sender_id: string;
      kind: string;
      body: string | null;
    };

    if (!conversation_id || kind === "system") {
      return json({ ignored: true });
    }

    const { data: parts, error: partsErr } = await admin
      .from("participants")
      .select("user_id")
      .eq("conversation_id", conversation_id)
      .neq("user_id", sender_id);
    if (partsErr || !parts || parts.length === 0) return json({ no_recipients: true });

    const [{ data: convo }, { data: sender }] = await Promise.all([
      admin.from("conversations").select("is_group, name").eq("id", conversation_id).single(),
      admin.from("profiles").select("first_name, last_name").eq("id", sender_id).single(),
    ]);

    const senderName = sender
      ? `${sender.first_name} ${sender.last_name}`.trim()
      : "Alguém";
    const title = convo?.is_group ? `${convo.name ?? "Grupo"} • ${senderName}` : senderName;
    const messageBody =
      kind === "audio" ? "🎤 Áudio" : kind === "image" ? "📷 Foto" : (body ?? "").slice(0, 120);

    const ids = (parts as any[]).map((p) => p.user_id);
    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .in("user_id", ids);
    if (!subs || subs.length === 0) return json({ no_subscriptions: true });

    const r = await sendTo(admin, subs as any[], {
      title,
      body: messageBody,
      url: `/chat/${conversation_id}`,
      tag: conversation_id,
    });
    return json(r);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
