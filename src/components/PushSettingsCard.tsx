"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { registerPush, isPushActive } from "@/lib/push";

/**
 * Card de notificações — embutido na tela de perfil.
 * Mostra o estado REAL do push neste device e conserta em 1 toque.
 */
export default function PushSettingsCard() {
  const [state, setState] = useState<"checking" | "on" | "off" | "denied" | "unsupported">("checking");
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const check = useCallback(async () => {
    if (
      typeof Notification === "undefined" ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window)
    ) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    const active = await isPushActive();
    setState(active ? "on" : "off");
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  async function handleEnable() {
    setWorking(true);
    setResult(null);
    try {
      const r = await registerPush();
      if (r === "ok") {
        setState("on");
        setResult("Ativado! 🔔");
      } else if (r === "denied") {
        setState("denied");
        setResult("Bloqueado no navegador — libera pelo ícone 🔒 na barra de endereço.");
      } else if (r === "table-missing") {
        setResult("Falta rodar o migration do push no SQL Editor 🦫");
      } else if (r === "no-vapid-key") {
        setResult("Falta a variável NEXT_PUBLIC_VAPID_PUBLIC_KEY na Vercel 🦫");
      } else {
        setResult("Não deu — tenta o diagnóstico completo abaixo.");
      }
    } finally {
      setWorking(false);
      void check();
    }
  }

  const label = {
    checking: "verificando…",
    on: "✅ ativadas",
    off: "❌ desativadas",
    denied: "🚫 bloqueadas no navegador",
    unsupported: "⚠️ não suportadas aqui",
  }[state];

  const dotColor =
    state === "on"
      ? "bg-capy-green"
      : state === "off" || state === "denied"
      ? "bg-capy-danger"
      : "bg-capy-fur/40";

  return (
    <div className="mt-4 rounded-2xl bg-white p-5 shadow-lg ring-1 ring-capy-fur/10">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-bold text-capy-dark">Notificações 🔔</h2>
        <span className="flex items-center gap-2 text-xs font-semibold text-capy-dark/70">
          <span className={`h-2 w-2 rounded-full ${dotColor} ${state === "checking" ? "animate-pulse" : ""}`} />
          {label}
        </span>
      </div>

      <p className="mb-3 text-xs leading-relaxed text-capy-dark/60">
        Receba aviso de mensagens novas neste aparelho — funciona até com o CapyZap
        fechado (no iPhone, precisa do app instalado na tela inicial).
      </p>

      {state === "on" ? (
        <p className="rounded-lg bg-capy-bubble/60 px-3 py-2 text-xs text-capy-deep">
          Tudo certo por aqui! Para testar o caminho completo (app fechado), use o
          botão abaixo 📡
        </p>
      ) : state === "unsupported" ? (
        <p className="rounded-lg bg-capy-sand px-3 py-2 text-xs text-capy-dark/60">
          Este navegador não suporta notificações web. No iPhone: abra no Safari e
          instale na tela inicial (iOS 16.4+).
        </p>
      ) : state === "denied" ? (
        <p className="rounded-lg bg-capy-danger/10 px-3 py-2 text-xs text-capy-danger">
          O navegador está bloqueando. Libera assim: Chrome/Edge → ícone 🔒 na barra →
          Notificações → Permitir. No PWA: configurações do app → Notificações.
        </p>
      ) : (
        <button onClick={() => void handleEnable()} disabled={working} className="capy-btn w-full text-sm">
          {working ? "Ativando…" : "🔔 Ativar notificações neste aparelho"}
        </button>
      )}

      {result && (
        <p className="mt-2 rounded-lg bg-capy-sand px-3 py-2 text-xs text-capy-dark/80">{result}</p>
      )}

      <Link
        href="/notifications"
        className="mt-3 block text-center text-[11px] font-semibold text-capy-green hover:underline"
      >
        Diagnóstico completo e teste pelo servidor →
      </Link>
    </div>
  );
}
