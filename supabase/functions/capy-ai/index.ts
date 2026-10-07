// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ============================================================
// CapyZap — CapyIA 🦫🤖
// Webhook (INSERT em messages em conversas is_ai) → chama a
// API da NVIDIA (build.nvidia.com) e responde no chat.
// Config: supabase secrets set NVIDIA_API_KEY=nvapi-...
// ============================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const NVIDIA_API_KEY = Deno.env.get("NVIDIA_API_KEY") ?? "";
const BOT_ID = "a1b2c3d4-0000-4000-8000-00000000c0de";

const MODEL = "meta/llama-3.1-8b-instruct"; // grátis no build.nvidia.com
const NVIDIA_URL =
  "https://integrate.api.nvidia.com/v1/chat/completions";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Content-Type": "application/json",
};

const SYSTEM_PROMPT =
  "Você é a CapyIA, a assistente amigável do CapyZap, um app de mensagens brasileiro para jovens. " +
  "Responda em português do Brasil, de forma breve, leve e simpática. Use no máximo 3 frases. " +
  "É proibido dar conselhos médicos, jurídicos ou financeiros sérios — nesses casos, sugira falar com um adulto de confiança.";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    if (!NVIDIA_API_KEY) {
      return new Response(
        JSON.stringify({ error: "nvidia-key-missing" }),
        { status: 500, headers: CORS }
      );
    }

    const payload = await req.json();
    const record = payload.record ?? payload.new ?? payload;
    const { conversation_id, sender_id, kind, body } = record as {
      conversation_id: string;
      sender_id: string;
      kind: string;
      body: string | null;
    };

    // só responde: mensagens de TEXTO de outras pessoas (não do bot)
    if (!conversation_id || kind !== "text" || sender_id === BOT_ID) {
      return new Response(JSON.stringify({ ignored: true }), { headers: CORS });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // confirma que é conversa com a IA
    const { data: convo } = await admin
      .from("conversations")
      .select("is_ai")
      .eq("id", conversation_id)
      .single();
    if (!convo?.is_ai) {
      return new Response(JSON.stringify({ not_ai: true }), { headers: CORS });
    }

    // último~12 turnos de contexto
    const { data: history } = await admin
      .from("messages")
      .select("sender_id, kind, body")
      .eq("conversation_id", conversation_id)
      .order("created_at", { ascending: false })
      .limit(12);

    const turns = (history ?? [])
      .reverse()
      .map((m: any) => ({
        role: m.sender_id === BOT_ID ? "assistant" : "user",
        content: m.kind === "text" ? m.body ?? "" : "[mídia]",
      }))
      .filter((t: any) => t.content.length > 0);

    // chama a NVIDIA (formato OpenAI-compatível)
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
        max_tokens: 300,
        temperature: 0.7,
      }),
    });

    const aiJson: any = await aiRes.json();
    const reply =
      aiJson?.choices?.[0]?.message?.content ??
      "Deu ruim aqui no meu raciocínio 🦫 tenta de novo!";

    // responde no chat como o bot
    await admin.from("messages").insert({
      conversation_id,
      sender_id: BOT_ID,
      kind: "text",
      body: reply.slice(0, 1500),
    });

    return new Response(JSON.stringify({ ok: true }), { headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: CORS,
    });
  }
});
