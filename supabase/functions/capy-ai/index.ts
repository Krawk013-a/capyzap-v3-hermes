// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ============================================================
// CapyZap — CapyIA 🦫🤖 (GLM 5.3 via NVIDIA)
// Webhook (INSERT em messages em conversas is_ai) → responde no chat.
// Config: supabase secrets set NVIDIA_API_KEY=nvapi-...
// ============================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const NVIDIA_API_KEY = Deno.env.get("NVIDIA_API_KEY") ?? "";
const BOT_ID = "a1b2c3d4-0000-4000-8000-00000000c0de";

const MODEL = "z-ai/glm-5.3";
const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

const SYSTEM_PROMPT =
  "Você é a CapyIA, a assistente amigável do CapyZap, um app de mensagens brasileiro para jovens. " +
  "Responda em português do Brasil, de forma breve, leve e simpática. Use no máximo 3 frases. " +
  "É proibido dar conselhos médicos, jurídicos ou financeiros sérios — nesses casos, sugira falar com um adulto de confiança.";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Content-Type": "application/json",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const payload = await req.json();
    const record = payload.record ?? payload.new ?? payload;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { conversation_id, sender_id, kind, body } = record as {
      conversation_id: string;
      sender_id: string;
      kind: string;
      body: string | null;
    };

    if (!conversation_id || kind !== "text" || sender_id === BOT_ID) {
      return new Response(JSON.stringify({ ignored: true }), { headers: CORS });
    }
    console.log("[capy-ai] msg recebida", { conversation_id, sender_id });

    if (!NVIDIA_API_KEY) {
      await admin.from("messages").insert({
        conversation_id,
        sender_id: BOT_ID,
        kind: "text",
        body: "⚙️ Falta a chave da NVIDIA. Configure NVIDIA_API_KEY nos Secrets da Edge Function. 🦫",
      });
      return new Response(JSON.stringify({ error: "nvidia-key-missing" }), {
        status: 500,
        headers: CORS,
      });
    }

    const { data: convo } = await admin
      .from("conversations")
      .select("is_ai")
      .eq("id", conversation_id)
      .single();

    if (!convo?.is_ai) {
      return new Response(JSON.stringify({ not_ai: true }), { headers: CORS });
    }

    const { data: history } = await admin
      .from("messages")
      .select("sender_id, kind, body")
      .eq("conversation_id", conversation_id)
      .order("created_at", { ascending: false })
      .limit(12);

    const turns = ((history ?? []) as any[])
      .reverse()
      .map((m) => ({
        role: m.sender_id === BOT_ID ? "assistant" : "user",
        content: m.kind === "text" ? m.body ?? "" : "[mídia]",
      }))
      .filter((t) => t.content.length > 0);

    const aiRes = await fetch(NVIDIA_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${NVIDIA_API_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...turns],
        max_tokens: 400,
        temperature: 0.7,
        reasoning_effort: "low",
        stream: false,
      }),
    });

    if (!aiRes.ok) {
      const errText = (await aiRes.text()).slice(0, 1000);
      console.error("[capy-ai] NVIDIA HTTP", aiRes.status, errText);
      await admin.from("messages").insert({
        conversation_id,
        sender_id: BOT_ID,
        kind: "text",
        body: `⚙️ CapyIA engasgou (${aiRes.status}). ${errText.slice(0, 500)} 🦫`,
      });
      return new Response(
        JSON.stringify({ nvidia_error: aiRes.status, details: errText }),
        { status: 502, headers: CORS },
      );
    }

    const aiJson: any = await aiRes.json();
    const reply: string =
      aiJson?.choices?.[0]?.message?.content ??
      "Deu ruim aqui no meu raciocínio 🦫 tenta de novo!";

    await admin.from("messages").insert({
      conversation_id,
      sender_id: BOT_ID,
      kind: "text",
      body: reply.slice(0, 1500),
    });

    return new Response(JSON.stringify({ ok: true }), { headers: CORS });
  } catch (e) {
    console.error("[capy-ai] erro:", String(e));
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: CORS,
    });
  }
});
