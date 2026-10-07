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
const BRAVE_SEARCH_API_KEY = Deno.env.get("BRAVE_SEARCH_API_KEY") ?? "";
const BOT_ID = "a1b2c3d4-0000-4000-8000-00000000c0de";

const MODEL = "z-ai/glm-5.3";
const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";

const SYSTEM_PROMPT =
  "Você é a CapyIA, a assistente amigável do CapyZap, um app de mensagens brasileiro para jovens. " +
  "Responda em português do Brasil, de forma breve, leve e simpática. Use no máximo 3 frases. " +
  "É proibido dar conselhos médicos, jurídicos ou financeiros sérios — nesses casos, sugira falar com um adulto de confiança.";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Content-Type": "application/json",
};

async function broadcastTyping(
  admin: ReturnType<typeof createClient>,
  conversationId: string,
  typing: boolean,
) {
  try {
    const channel = admin.channel(`capy-presence-${conversationId}`);

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      channel.subscribe((status) => {
        if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          finish();
        }
      });
    });

    if (typing) {
      await channel.send({
        type: "broadcast",
        event: "typing",
        payload: {
          user_id: BOT_ID,
          name: "CapyIA",
          typing: true,
        },
      });
    } else {
      await channel.send({
        type: "broadcast",
        event: "typing",
        payload: {
          user_id: BOT_ID,
          name: "CapyIA",
          typing: false,
        },
      });
    }

    await admin.removeChannel(channel);
  } catch (error) {
    console.warn("[capy-ai] typing broadcast:", String(error));
  }
}


async function webSearch(query: string) {
  if (!BRAVE_SEARCH_API_KEY) {
    return {
      ok: false,
      error: "BRAVE_SEARCH_API_KEY não configurada",
      results: [],
    };
  }

  const url = new URL(BRAVE_SEARCH_URL);
  url.searchParams.set("q", query.slice(0, 600));
  url.searchParams.set("count", "6");
  url.searchParams.set("country", "BR");
  url.searchParams.set("search_lang", "pt-br");
  url.searchParams.set("safesearch", "moderate");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": BRAVE_SEARCH_API_KEY,
    },
  });

  if (!response.ok) {
    const error = (await response.text()).slice(0, 500);
    console.error("[capy-ai] Brave Search HTTP", response.status, error);
    return {
      ok: false,
      error: `Busca indisponível (${response.status})`,
      results: [],
    };
  }

  const data = await response.json();
  const results = (data?.web?.results ?? []).slice(0, 6).map((item: any) => ({
    title: String(item?.title ?? ""),
    url: String(item?.url ?? ""),
    snippet: String(item?.description ?? ""),
  }));

  return { ok: true, results };
}

const WEB_SEARCH_TOOL = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Pesquisa a internet em tempo real. Use para informações atuais ou que possam ter mudado desde o conhecimento do modelo, como notícias, preços, lançamentos, eventos, pessoas, resultados esportivos, versões de software e fatos recentes. Não use para perguntas simples e atemporais que você já sabe responder.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Consulta objetiva para pesquisar na web, em português ou no idioma mais adequado.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
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

    await broadcastTyping(admin, conversation_id, true);

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

    const messages: any[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...turns,
    ];

    // Primeira chamada: o GLM decide sozinho se precisa pesquisar.
    const tools = BRAVE_SEARCH_API_KEY ? [WEB_SEARCH_TOOL] : undefined;
    const firstRes = await fetch(NVIDIA_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${NVIDIA_API_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        tools,
        tool_choice: tools ? "auto" : undefined,
        max_tokens: 400,
        temperature: 0.7,
        reasoning_effort: "low",
        stream: false,
      }),
    });

    if (!firstRes.ok) {
      const errText = (await firstRes.text()).slice(0, 1000);
      console.error("[capy-ai] NVIDIA HTTP", firstRes.status, errText);
      await admin.from("messages").insert({
        conversation_id,
        sender_id: BOT_ID,
        kind: "text",
        body: `⚙️ CapyIA engasgou (${firstRes.status}). ${errText.slice(0, 500)} 🦫`,
      });
      await broadcastTyping(admin, conversation_id, false);
      return new Response(
        JSON.stringify({ nvidia_error: firstRes.status, details: errText }),
        { status: 502, headers: CORS },
      );
    }

    const firstJson: any = await firstRes.json();
    const firstMessage = firstJson?.choices?.[0]?.message;

    // Se o modelo pediu pesquisa, executa a ferramenta e dá os resultados de volta ao GLM.
    const toolCalls = firstMessage?.tool_calls ?? [];
    const processedToolCalls = toolCalls.slice(0, 2);
    if (processedToolCalls.length > 0) {
      messages.push({
        ...firstMessage,
        tool_calls: processedToolCalls,
      });

      for (const toolCall of processedToolCalls) {
        if (toolCall?.function?.name !== "web_search") continue;

        let args: any = {};
        try {
          args = JSON.parse(toolCall.function.arguments ?? "{}");
        } catch {
          args = {};
        }

        const query = String(args?.query ?? "").trim();
        const searchResult = query
          ? await webSearch(query)
          : { ok: false, error: "Consulta de busca vazia", results: [] };

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(searchResult),
        });
      }
    }

    // Segunda chamada somente quando houve uso da ferramenta.
    // Se não houve busca, reutilizamos a primeira resposta sem fazer outra chamada.
    let aiJson: any = firstJson;

    if (processedToolCalls.length > 0) {
      const finalRes = await fetch(NVIDIA_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${NVIDIA_API_KEY}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          messages,
          max_tokens: 500,
          temperature: 0.7,
          reasoning_effort: "low",
          stream: false,
        }),
      });

      if (!finalRes.ok) {
        const errText = (await finalRes.text()).slice(0, 1000);
        console.error("[capy-ai] NVIDIA HTTP", finalRes.status, errText);
        await admin.from("messages").insert({
          conversation_id,
          sender_id: BOT_ID,
          kind: "text",
          body: `⚙️ CapyIA engasgou (${finalRes.status}). ${errText.slice(0, 500)} 🦫`,
        });
        await broadcastTyping(admin, conversation_id, false);
        return new Response(
          JSON.stringify({ nvidia_error: finalRes.status, details: errText }),
          { status: 502, headers: CORS },
        );
      }

      aiJson = await finalRes.json();
    }

    const reply: string =
      aiJson?.choices?.[0]?.message?.content ??
      "Deu ruim aqui no meu raciocínio 🦫 tenta de novo!";

    await admin.from("messages").insert({
      conversation_id,
      sender_id: BOT_ID,
      kind: "text",
      body: reply.slice(0, 1500),
    });

    await broadcastTyping(admin, conversation_id, false);

    return new Response(JSON.stringify({ ok: true }), { headers: CORS });
  } catch (e) {
    console.error("[capy-ai] erro:", String(e));
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: CORS,
    });
  }
});
