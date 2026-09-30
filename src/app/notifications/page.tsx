"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { isPushActive } from "@/lib/push";

/**
 * Tela "Forçar notificações" — checklist de diagnóstico que conserta
 * cada peça do push: service worker, permissão, inscrição e banco.
 * Funciona no navegador e no PWA instalado (Android/iOS 16.4+).
 */
export default function PushFixPage() {
  const router = useRouter();
  const [steps, setSteps] = useState<Record<string, string>>({});
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const set = (k: string, v: string) => setSteps((s) => ({ ...s, [k]: v }));

  const diagnose = useCallback(async () => {
    // 1) navegador suporta?
    const supported =
      typeof Notification !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window;
    set("supported", supported ? "ok" : "fail");
    if (!supported) {
      setResult(
        "Este navegador não suporta notificações web. No iPhone, usa o Safari e instala o app na tela inicial (iOS 16.4+)."
      );
      return false;
    }

    // 2) service worker registrado?
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) set("sw", "ok");
      else {
        const r2 = await navigator.serviceWorker.register("/sw.js");
        set("sw", r2 ? "fixed" : "fail");
      }
    } catch {
      set("sw", "fail");
    }

    // 3) chave VAPID configurada?
    const vapid = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "").trim();
    set("vapid", vapid ? "ok" : "fail");

    // 4) permissão?
    const perm = Notification.permission;
    set("permission", perm === "granted" ? "ok" : perm === "denied" ? "denied" : "pending");

    // 5) inscrição salva no banco?
    if (perm === "granted" && vapid) {
      const active = await isPushActive();
      set("subscription", active ? "ok" : "fail");
    }
    return true;
  }, []);

  useEffect(() => {
    void diagnose();
  }, [diagnose]);

  /** Testa o CAMINHO SERVIDOR (Edge Function + VAPID + push com app fechado). */
  async function testServerPush() {
    setWorking(true);
    setResult(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setResult("Sessão expirada — loga de novo 🦫");
        setWorking(false);
        return;
      }
      const fnUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/notify-push?test=1`;
      const res = await fetch(fnUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim(),
          "Content-Type": "application/json",
        },
      });
      const data = (await res.json()) as Record<string, unknown>;

      // prefixo da chave VAPID que o NAVEGADOR usou ao inscrever
      const browserVapid = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "").trim();
      const serverVapid = typeof data.vapidPubPrefix === "string" ? data.vapidPubPrefix : "";
      const vapidMismatch =
        serverVapid && !browserVapid.startsWith(serverVapid);

      const firstErr =
        Array.isArray(data.errors) && data.errors.length > 0
          ? (data.errors[0] as { statusCode?: number; message: string })
          : null;

      if (res.status === 401) setResult("Sessão inválida — loga de novo.");
      else if (data.error === "no-subscriptions")
        setResult("Nenhum device inscrito no servidor. Clica em \"Forçar ativação\" primeiro 🦫");
      else if (data.error === "vapid-missing")
        setResult("Faltam os secrets VAPID na Edge Function. No terminal: supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... 🦫");
      else if (vapidMismatch)
        setResult(
          "🔑 AS CHAVES NÃO BATEM: a VAPID do navegador é diferente da que está nos secrets do servidor. Roda de novo (uma linha só): supabase secrets set VAPID_PRIVATE_KEY=vqNcbJWWCDKxMdrZB0fPTybYkFfYWN1Mrm4lGx_bRSg VAPID_PUBLIC_KEY=BC6Q6RPb3-jfz7uk9mQOMuvPpsDPwgIb24d_1BxXLyAzoUSYyGkxA_h8QZwvoMrISchKYk5sg_SCtzOXe1sEczY VAPID_SUBJECT=mailto:enzosilva0880@gmail.com — depois \"Forçar ativação\" de novo 🦫"
        );
      else if (typeof data.sent === "number" && data.sent > 0)
        setResult(`✅ Servidor OK! ${data.sent} push enviado(s) — chegou a notificação?`);
      else if (firstErr?.statusCode === 403 || firstErr?.statusCode === 401)
        setResult("🔑 Chave VAPID do servidor errada/expirada — roda o supabase secrets set de novo 🦫");
      else if (firstErr?.statusCode === 410 || firstErr?.statusCode === 404)
        setResult("Inscrição velha no servidor — clica \"Forçar ativação\" pra re-inscrever 🦫");
      else if (firstErr?.statusCode === 400)
        setResult("Inscrição corrompida — clica \"Forçar ativação\" pra re-inscrever 🦫");
      else if (firstErr)
        setResult(`Servidor tentou mas falhou (HTTP ${firstErr.statusCode ?? "?"}): ${firstErr.message.slice(0, 120)}`);
      else setResult("Resposta inesperada: " + JSON.stringify(data).slice(0, 120));
    } catch (e) {
      setResult("Não consegui chamar a função. Ela foi deployada? supabase functions deploy notify-push");
    } finally {
      setWorking(false);
    }
  }

  async function forceEverything() {
    setWorking(true);
    setResult(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }

      // 1) service worker fresquinho
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      set("sw", "ok");

      // 2) permissão (se bloqueada, avisa — navegador só libera nas config)
      if (Notification.permission === "denied") {
        setResult(
          "Notificação está BLOQUEADA no navegador. Libera assim: Chrome/Edge → ícone 🔒 na barra → Notificações → Permitir. No PWA: configurações do app → Notificações."
        );
        setWorking(false);
        return;
      }
      const perm = await Notification.requestPermission();
      set("permission", perm === "granted" ? "ok" : "denied");
      if (perm !== "granted") {
        setWorking(false);
        return;
      }

      // 3) chave VAPID
      const vapid = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "").trim();
      if (!vapid) {
        setResult("Falta a variável NEXT_PUBLIC_VAPID_PUBLIC_KEY na Vercel 🦫");
        setWorking(false);
        return;
      }

      // 4) inscrição nova (joga fora a velha e re-assina)
      const old = await reg.pushManager.getSubscription();
      if (old) {
        await old.unsubscribe();
        await supabase
          .from("push_subscriptions")
          .delete()
          .eq("endpoint", old.endpoint);
      }
      const raw = window.atob(
        vapid.replace(/-/g, "+").replace(/_/g, "/") +
          "=".repeat((4 - (vapid.length % 4)) % 4)
      );
      const arr = new Uint8Array(new ArrayBuffer(raw.length));
      for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: arr,
      });

      // 5) salva no banco
      const payload = {
        user_id: user.id,
        endpoint: sub.endpoint,
        p256dh: (sub.getKey("p256dh") as Buffer | null)?.toString("base64") ?? null,
        auth: (sub.getKey("auth") as Buffer | null)?.toString("base64") ?? null,
        updated_at: new Date().toISOString(),
      };
      const { error: upErr } = await supabase
        .from("push_subscriptions")
        .upsert(payload, { onConflict: "endpoint" });
      if (upErr) {
        if (upErr.code === "42P01") {
          setResult("Quase! Roda o migration-v4.sql no Supabase (cria a tabela de push) 🦫");
        } else {
          setResult("Falha ao salvar: " + upErr.message);
        }
        setWorking(false);
        return;
      }

      // 6) notificação de teste — prova real
      await reg.showNotification("CapyZap 🔔", {
        body: "Notificações ativadas! Esse é o aviso que você vai receber.",
        icon: "/icons/capy-192.png",
        badge: "/icons/capy-192.png",
      });
      setResult("✅ Tudo ativado — essa notificação de teste é a prova!");
      await diagnose();
    } catch (e) {
      setResult("Deu ruim: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setWorking(false);
    }
  }

  const label: Record<string, string> = {
    ok: "✅",
    fixed: "🔧 → ok",
    fail: "❌",
    denied: "🚫 bloqueada",
    pending: "⏳ não decidido",
  };

  const row = (k: string, title: string) => (
    <div className="flex items-center justify-between border-b border-capy-fur/10 py-2.5 text-sm">
      <span className="text-capy-dark/80">{title}</span>
      <span className="font-bold">{label[steps[k] ?? "pending"] ?? "…"}</span>
    </div>
  );

  return (
    <main className="flex min-h-dvh flex-col bg-capy-sand">
      <header className="flex items-center gap-3 bg-capy-dark px-3 py-2.5 text-white">
        <button
          onClick={() => router.push("/chat")}
          className="rounded-lg p-1.5 hover:bg-white/10"
          aria-label="Voltar"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
        </button>
        <h1 className="font-bold">Notificações 🔔</h1>
      </header>

      <div className="mx-auto w-full max-w-md flex-1 p-4">
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-capy-fur/10">
          <p className="mb-1 text-sm font-semibold text-capy-dark">Diagnóstico</p>
          <p className="mb-3 text-xs text-capy-dark/50">
            Checagem de cada peça do push neste dispositivo
          </p>
          {row("supported", "Navegador suporta notificações")}
          {row("sw", "Service Worker registrado")}
          {row("vapid", "Chave VAPID configurada")}
          {row("permission", "Permissão do navegador")}
          {row("subscription", "Inscrição salva no banco")}

          <button
            onClick={() => void forceEverything()}
            disabled={working}
            className="capy-btn mt-5 w-full"
          >
            {working ? "Ativando…" : "🔧 Forçar ativação (repara tudo)"}
          </button>

          <button
            onClick={() => void testServerPush()}
            disabled={working}
            className="capy-btn-secondary mt-2 w-full text-sm"
          >
            📡 Testar notificação pelo SERVIDOR (app fechado)
          </button>

          <p className="mt-2 text-center text-[11px] leading-relaxed text-capy-dark/50">
            O teste local prova o navegador; o teste do servidor prova o caminho
            com app fechado (Edge Function + VAPID + Webhook).
          </p>

          {result && (
            <div className="mt-4 rounded-xl bg-capy-bubble/60 px-4 py-3 text-sm text-capy-deep">
              {result}
            </div>
          )}

          <div className="mt-5 rounded-xl bg-capy-sand/70 p-3 text-[11px] leading-relaxed text-capy-dark/60">
            <b>No iPhone:</b> só funciona com o app instalado na tela inicial
            (Compartilhar → Adicionar à Tela de Início, iOS 16.4+). Depois: Ajustes
            → CapyZap → Notificações → Permitir.
            <br />
            <b>No Android/PWA:</b> se bloqueou uma vez, o app não pode mais pedir —
            libera nas configurações do site (ícone 🔒) ou do app.
          </div>
        </div>
      </div>
    </main>
  );
}
