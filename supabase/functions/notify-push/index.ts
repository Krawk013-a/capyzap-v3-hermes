// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

// ============================================================
// CapyZap — Database Webhook: notifica push os participantes
// da conversa quando chega mensagem nova (texto/áudio/imagem).
// Deploy: supabase functions deploy notify-push
// Trigger no Dashboard: Database → Webhooks (INSERT em messages)
// ============================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:capyzap@example.com";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    // formato do webhook do Supabase: { type, table, record, ... }
    const record = payload.record ?? payload.new ?? payload;
    const {
      conversation_id,
      sender_id,
      kind,
      body,
    } = record as {
      conversation_id: string;
      sender_id: string;
      kind: string;
      body: string | null;
    };

    if (!conversation_id || kind === "system") {
      return new Response("ignored", { status: 200 });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // 1) participantes da conversa (menos o remetente)
    const { data: parts, error: partsErr } = await admin
      .from("participants")
      .select("user_id")
      .eq("conversation_id", conversation_id)
      .neq("user_id", sender_id);
    if (partsErr || !parts || parts.length === 0) {
      return new Response("no recipients", { status: 200 });
    }

    // 2) dados da conversa + nome do remetente (p/ título)
    const { data: convo } = await admin
      .from("conversations")
      .select("is_group, name")
      .eq("id", conversation_id)
      .single();

    const { data: sender } = await admin
      .from("profiles")
      .select("first_name, last_name")
      .eq("id", sender_id)
      .single();

    const senderName = sender
      ? `${sender.first_name} ${sender.last_name}`.trim()
      : "Alguém";

    let title: string;
    let messageBody: string;
    if (convo?.is_group) {
      title = `${convo.name ?? "Grupo"} • ${senderName}`;
    } else {
      title = senderName;
    }
    if (kind === "audio") messageBody = "🎤 Áudio";
    else if (kind === "image") messageBody = "📷 Foto";
    else messageBody = (body ?? "").slice(0, 120);

    // 3) inscrições push desses participantes
    const ids = parts.map((p: any) => p.user_id);
    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .in("user_id", ids);
    if (!subs || subs.length === 0) {
      return new Response("no subscriptions", { status: 200 });
    }

    // 4) dispara pra cada device (erros individuais não derrubam os demais)
    const results = await Promise.allSettled(
      (subs as any[]).map((s) =>
        webpush.sendNotification(
          {
            endpoint: s.endpoint,
            keys: { p256dh: s.p256dh, auth: s.auth },
          },
          JSON.stringify({
            title,
            body: messageBody,
            url: `/chat/${conversation_id}`,
            tag: conversation_id,
          })
        )
      )
    );

    // 5) limpa inscrições mortas (410 Gone) — mantenho a tabela saudável
    const dead = results
      .map((r, i) => (r.status === "rejected" && subs[i] ? subs[i].endpoint : null))
      .filter(Boolean) as string[];

    // só remove se de fato for gone/expired (não por falha de rede)
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === "rejected") {
        const statusCode = (r.reason as any)?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await admin
            .from("push_subscriptions")
            .delete()
            .eq("endpoint", dead[i]);
        }
      }
    }

    const sent = results.filter((r) => r.status === "fulfilled").length;
    return new Response(JSON.stringify({ sent }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
